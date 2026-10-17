import type { MaskPoint, MaskShape, WorldPainting } from '../../shared/world-painting';
export function maskContours(mask: number, curve: number, editable=true): { start: MaskPoint; end: MaskPoint; point: MaskPoint }[] {
  const c = Math.max(editable ? .03 : 0, .25*(1-curve));
  const corners = [
    {start:{x:.5,y:0},end:{x:0,y:.5},point:{x:c,y:c}},
    {start:{x:1,y:.5},end:{x:.5,y:0},point:{x:1-c,y:c}},
    {start:{x:.5,y:1},end:{x:1,y:.5},point:{x:1-c,y:1-c}},
    {start:{x:0,y:.5},end:{x:.5,y:1},point:{x:c,y:1-c}},
  ];
  const indices: Record<number, number[]> = {1:[0],2:[1],4:[2],8:[3],14:[0],13:[1],11:[2],7:[3],5:[1,3],10:[0,2]};
  if (indices[mask]) return indices[mask].map(i=>corners[i]);
  const endpoints: Record<number, [MaskPoint,MaskPoint]> = {
    3:[{x:1,y:.5},{x:0,y:.5}],6:[{x:.5,y:1},{x:.5,y:0}],
    12:[{x:0,y:.5},{x:1,y:.5}],9:[{x:.5,y:0},{x:.5,y:1}],
  };
  return endpoints[mask] ? [{start:endpoints[mask][0],end:endpoints[mask][1],point:{x:.5,y:.5}}] : [];
}
/** TL/TR/BR/BL bits. Shared edge midpoints guarantee matching contours.
 * Diagonal saddles connect the overlaid material; its complement is disconnected.
 * Coordinates are local world units, so paths are reused at every zoom and position. */
export function terrainMaskCommands(mask: number, size: number, curve: number, shape?: MaskShape): string {
  const h = size / 2, c = h * .5 * (1 - curve);
  const contour = (start: MaskPoint, end: MaskPoint, points: MaskPoint[]): string => {
    const xy = (p: MaskPoint) => (p.x*size) + ' ' + (p.y*size);
    if (!shape!.smooth) return points.map(p => 'L'+xy(p)).join(' ') + ' L'+xy(end);
    return points.map((p,i) => 'Q'+xy(p)+' '+xy(i+1<points.length ? {x:(p.x+points[i+1].x)/2,y:(p.y+points[i+1].y)/2} : end)).join(' ');
  };
  const custom = (index: number, start: MaskPoint, end: MaskPoint, fallback: string) => shape ? contour(start,end,shape.curves[index]) : fallback;
  const corner = (i: number): string => {
    const paths = [
      `M0 0 H${h} ${custom(0, {x:.5,y:0},{x:0,y:.5}, `Q${c} ${c} 0 ${h}`)} Z`,
      `M${size} 0 V${h} ${custom(0,{x:1,y:.5},{x:.5,y:0},`Q${size-c} ${c} ${h} 0`)} Z`,
      `M${size} ${size} H${h} ${custom(mask === 10 ? 1 : 0,{x:.5,y:1},{x:1,y:.5},`Q${size-c} ${size-c} ${size} ${h}`)} Z`,
      `M0 ${size} V${h} ${custom(mask === 5 ? 1 : 0,{x:0,y:.5},{x:.5,y:1},`Q${c} ${size-c} ${h} ${size}`)} Z`,
    ];
    return paths[i];
  };
  const full = `M0 0 H${size} V${size} H0 Z`;
  switch (mask) {
    case 0: return '';
    case 15: return full;
    case 1: return corner(0);
    case 2: return corner(1);
    case 4: return corner(2);
    case 8: return corner(3);
    case 3: return `M0 0 H${size} V${h} ${custom(0,{x:1,y:.5},{x:0,y:.5},'H0')} Z`;
    case 6: return `M${h} 0 H${size} V${size} H${h} ${custom(0,{x:.5,y:1},{x:.5,y:0},`V0`)} Z`;
    case 12: return `M0 ${h} ${custom(0,{x:0,y:.5},{x:1,y:.5},`H${size}`)} V${size} H0 Z`;
    case 9: return `M0 0 H${h} ${custom(0,{x:.5,y:0},{x:.5,y:1},`V${size}`)} H0 Z`;
    // Even-odd fill also handles all complementary and saddle geometries.
    case 14: return full + corner(0);
    case 13: return full + corner(1);
    case 11: return full + corner(2);
    case 7: return full + corner(3);
    case 5: return full + corner(1) + corner(3);
    case 10: return full + corner(0) + corner(2);
    default: throw new Error('Invalid terrain mask');
  }
}
export class TerrainMasks {
  get pathCount():number { return this.paths.length; }
  private curve = -1;
  private shapes?: WorldPainting['maskShapes'];
  private size = -1;
  private paths: Path2D[] = [];
  get(mask: number, size: number, curve: number, shapes?: WorldPainting['maskShapes']): Path2D {
    if (this.curve !== curve || this.size !== size || this.shapes !== shapes) {
      this.curve = curve;
      this.size = size;
      this.shapes = shapes;
      this.paths = Array.from({ length: 16 }, (_, bits) => new Path2D(terrainMaskCommands(bits, size, curve, shapes?.[bits])));
    }
    return this.paths[mask];
  }
}
