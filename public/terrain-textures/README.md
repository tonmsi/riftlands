# Riftlands — texture illustrate

Asset generati con lo strumento integrato ImageGen il 12 ottobre 2026, per la soluzione ibrida. I PNG originali sono opachi; il renderer ne usa la luminosità con una tinta climatica e un pattern ancorato alle coordinate del mondo. Non sono screenshot del gioco. Le rotazioni non vengono applicate alla muratura.

Prompt comune finale: “Use case: stylized-concept. Asset type: seamless repeating game material texture for Riftlands, soft hand-painted cel-shaded 2D fantasy, non-pixel art. Generate ONE square edge-to-edge texture of [material description]. Materials only, orthographic flat material swatch, no scene, no objects, no perspective, no borders, no text, no vignette, no dominant directional illumination, no cast shadows, fully opaque. Tileable seamless matching left/right and top/bottom edges; continuous across edges. Calm readable low-contrast details to keep characters prominent. Palette consistent with sage green grass #91ad69, ochre paths #cfb47e and stone #8fa2ba. Uniform scale and visual density, illustration like game terrain rather than photorealism. This is the '[material]' material asset.”

Descrizioni sostituite nel prompt, una generazione per file:

- `grass.png`: “muted sage-green short meadow grass. Extremely subtle broad painted color patches, sparse tiny grass blade marks, no flowers, no rocks”.
- `path.png`: “warm ochre compacted dirt path surface. Fine painted earth grain, sparse tiny embedded pebbles, calm center, no edge border”.
- `stone.png`: “muted warm-gray stone dungeon paving, irregular rectangular flat stone slabs, restrained thin dark joints, subtle wear, no plants”.
- `brick.png`: “muted warm gray-beige weathered masonry brick wall texture, horizontal rows of small blocks, restrained mortar seams, soft flat shading”.
- `rock.png`: “muted cool warm-gray natural rock face texture, broad angular facets and sparse subtle cracks, flat cel shading, no grass”.

Le texture di terreno vengono ripetute su otto celle (384 unità), per mantenere leggibili i dettagli a zoom normale. Le texture neve/ghiaccio e terra/fango/sabbia riutilizzano la grana con tinte appropriate; legno e piccoli dettagli dei bordi rimangono procedurali. Le versioni mancanti hanno un riempimento di fallback. I riempimenti climatici molto simili condividono il bitmap, con una differenza massima di due unità RGB, per evitare rigenerazioni continue della cache.

## Cespugli illustrati

`shrubs.png` è un atlas trasparente 2 × 2 con quattro sagome. Generato con lo strumento integrato `image_gen`, usando la colonna B della comparazione fornita come riferimento di stile. Il renderer conserva l’alfa originale, campiona i quadranti e aggiunge variazioni stabili; le collisioni restano quelle dei tile.

Prompt finale:

```text
Use case: stylized-concept
Asset type: transparent shrub sprite atlas for a top-down Canvas RPG, one foliage asset in four animation-free visual variants.
Input images: Image 1 is style reference only. Match the shrubs in its middle column B (Ibrido), not its whole scene.
Primary request: create a square 2 by 2 sprite atlas on a fully transparent background: exactly four separate hand-painted leafy shrubs, one centered in each quadrant. No scene or ground.
Composition: each shrub occupies the central 74 percent of its quadrant leaving clear transparent margins on all sides, no contact between quadrants. Consistent top-down slightly raised RPG viewpoint. Dense rounded leafy mass with irregular lobed edges, visible individual oval leaves and short leaf clusters, a dark subtle contact shadow immediately below.
Variations: naturally distinct silhouette and arrangement of the same shrub species, varying slightly in width, height and bright leaf clusters. Olive lime and sage upper leaves, forest teal lower foliage, warm gentle sunlight upper-left. Painterly gouache with readable larger forms at 48px, soft irregular ink contours, 3 clear shade levels, no noisy speckling.
Constraints: transparent alpha background, no checkerboard baked into image, no text, no grid lines, no labels, no frame, no rocks, no flowers, no grass carpet. Avoid flat polygon disks and pixel art. This is a game sprite sheet, not an illustration of a sheet.
```

## Acqua dipinta

`water.png` è una texture opaca generata con lo strumento integrato `image_gen` dalla stessa colonna B di riferimento. Il renderer mantiene la palette dell’acqua, unisce i bordi del pattern e campiona una ripetizione ancorata al mondo su 384 unità. I bordi della riva restano gestiti dal materiale vicino; i riflessi sono statici.

Prompt finale:

```text
Use case: stylized-concept
Asset type: seamlessly repeating turquoise water material texture for a top-down hand-painted RPG.
Input images: Image1 is style reference only, match the water rendering in its middle column B (Ibrido).
Primary request: ONE square opaque edge-to-edge texture of clear teal/turquoise pond water, no land, no bank, no objects. Fine organic rounded facets below the surface, dense gently curved irregular ripple highlights forming loosely interlocking shapes. A painterly watercolor/gouache treatment, 2D overhead flat tile material, same scale everywhere. Soft blue-teal darker pools and translucent mint turquoise highlights. Calm but clearly drawn surface detail visible when reduced to384px. Colors near #459daa with natural variation, avoid pure white, keep highlight contrast moderate and distribute detail uniformly.
Constraints: seamless tileable matching opposite edges, no border, no scene perspective, no lily pads, no rocks, no foam band, no text, no directional light gradient, no shadows, no vignette, no flat polygon strips, no pixel art, fully opaque background.
```
