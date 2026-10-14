param(
  [string]$Source = (Join-Path $PSScriptRoot '../artifacts/cliff-analysis/cliff-grid.png'),
  [string]$Destination = (Join-Path $PSScriptRoot '../public/terrain-walls/wall-roccia-grid')
)

# Exact sprite-sheet extraction, without scaling, alpha trimming or generated artwork.
Add-Type -AssemblyName System.Drawing
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$null = New-Item -ItemType Directory -Path $destinationPath -Force

function Get-CliffPngChunks([byte[]]$Bytes) {
  for ($offset = 8; $offset -lt $Bytes.Length;) {
    $length = [int]($Bytes[$offset] * 16777216 + $Bytes[$offset + 1] * 65536 + $Bytes[$offset + 2] * 256 + $Bytes[$offset + 3])
    $chunkBytes = [byte[]]::new($length + 12)
    [Array]::Copy($Bytes, $offset, $chunkBytes, 0, $chunkBytes.Length)
    [pscustomobject]@{ Kind = [System.Text.Encoding]::ASCII.GetString($Bytes, $offset + 4, 4); Bytes = $chunkBytes }
    $offset += $chunkBytes.Length
  }
}

# GDI preserves pixels but replaces the ICC profile with sRGB. Keep the original
# color interpretation too, so browsers display every crop like the source.
$appearanceKinds = @('iCCP', 'cHRM', 'gAMA', 'sRGB', 'cICP', 'sBIT', 'mDCv', 'cLLi', 'pHYs')
$sourcePngBytes = [System.IO.File]::ReadAllBytes($sourcePath)
$sourceAppearance = @(Get-CliffPngChunks $sourcePngBytes | Where-Object { $_.Kind -in $appearanceKinds })
function Restore-CliffPngAppearance([string]$Path) {
  $croppedPngBytes = [System.IO.File]::ReadAllBytes($Path)
  $stream = [System.IO.MemoryStream]::new()
  try {
    $stream.Write($croppedPngBytes, 0, 8)
    foreach ($chunk in (Get-CliffPngChunks $croppedPngBytes)) {
      if ($chunk.Kind -in $appearanceKinds) { continue }
      $stream.Write($chunk.Bytes, 0, $chunk.Bytes.Length)
      if ($chunk.Kind -eq 'IHDR') {
        foreach ($appearance in $sourceAppearance) { $stream.Write($appearance.Bytes, 0, $appearance.Bytes.Length) }
      }
    }
    [System.IO.File]::WriteAllBytes($Path, $stream.ToArray())
  }
  finally { $stream.Dispose() }
}

$bitmap = [System.Drawing.Bitmap]::new($sourcePath)
try {
  $columns = @(0, [int][Math]::Round($bitmap.Width / 3), [int][Math]::Round(2 * $bitmap.Width / 3), $bitmap.Width)
  $rows = @(0, [int][Math]::Round($bitmap.Height / 3), [int][Math]::Round(2 * $bitmap.Height / 3), $bitmap.Height)
  $names = @('back-left', 'back', 'back-right', 'side-left', 'center', 'side-right', 'corner-left', 'front', 'corner-right')
  $parts = @()
  for ($row = 0; $row -lt 3; $row++) {
    for ($column = 0; $column -lt 3; $column++) {
      $name = $names[$row * 3 + $column]
      $rectangle = [System.Drawing.Rectangle]::new($columns[$column], $rows[$row],
        $columns[$column + 1] - $columns[$column], $rows[$row + 1] - $rows[$row])
      $piece = $bitmap.Clone($rectangle, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $piecePath = Join-Path $destinationPath "$name.png"
      try { $piece.Save($piecePath, [System.Drawing.Imaging.ImageFormat]::Png) }
      finally { $piece.Dispose() }
      Restore-CliffPngAppearance $piecePath
      $parts += [ordered]@{ part = $name; row = $row; column = $column; x = $rectangle.X; y = $rectangle.Y;
        width = $rectangle.Width; height = $rectangle.Height }
    }
  }
  $savedSource = Join-Path $destinationPath 'cliff-grid-source.png'
  if (![string]::Equals($sourcePath, $savedSource, [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $sourcePath -Destination $savedSource
  }
  [ordered]@{ name = 'Roccia · griglia 3×3'; material = 'rock'; tileSize = $columns[1];
    levelHeight = $columns[1] / 3; pixelated = $false; layout = 'grid-3x3' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destinationPath 'kit.json') -Encoding utf8
  [ordered]@{ source = 'cliff-grid-source.png'; width = $bitmap.Width; height = $bitmap.Height;
    columns = $columns; rows = $rows; parts = $parts } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destinationPath 'grid.json') -Encoding utf8
  Write-Output "Imported 9 original PNG slices into $destinationPath"
}
finally { $bitmap.Dispose() }
