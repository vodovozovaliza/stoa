// src/utils/geom.ts
export type Pt = [number, number];

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function randNormal(rng: () => number): number {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function samplePointInCircle(
  rng: () => number,
  r: number,
  inset: number = 0
): Pt {
  const rr = Math.max(1e-6, r - inset);
  const theta = rng() * 2 * Math.PI;
  const rad = rr * Math.sqrt(rng());
  return [rad * Math.cos(theta), rad * Math.sin(theta)];
}

export function polygonArea(poly: Pt[]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function ensureCCW(poly: Pt[]): Pt[] {
  return polygonArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function polygonCentroid(poly: Pt[]): Pt {
  const n = poly.length;
  if (n === 0) return [0, 0];
  if (n === 1) return poly[0];

  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-9) {
    // fallback: average vertices
    const sx = poly.reduce((s, p) => s + p[0], 0);
    const sy = poly.reduce((s, p) => s + p[1], 0);
    return [sx / n, sy / n];
  }

  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  cx /= 6 * a;
  cy /= 6 * a;
  return [cx, cy];
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

function isInside(p: Pt, a: Pt, b: Pt) {
  // inside if on the left of edge a->b (for CCW clip polygon)
  return cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) >= 0;
}

function lineIntersection(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  // intersection of lines p->q and a->b
  const px = p[0], py = p[1];
  const qx = q[0], qy = q[1];
  const ax = a[0], ay = a[1];
  const bx = b[0], by = b[1];

  const r1x = qx - px, r1y = qy - py;
  const r2x = bx - ax, r2y = by - ay;

  const denom = cross(r1x, r1y, r2x, r2y);
  if (Math.abs(denom) < 1e-12) return q; // parallel-ish fallback

  const t = cross(ax - px, ay - py, r2x, r2y) / denom;
  return [px + t * r1x, py + t * r1y];
}

/**
 * Sutherland–Hodgman polygon clipping
 * Works well here because:
 * - Voronoi cells are convex
 * - Circle polygon is convex
 * - Intersection of convex polygons remains convex
 */
export function clipConvexPolygon(subjectIn: Pt[], clipperIn: Pt[]): Pt[] {
  let subject = subjectIn.slice();
  let clipper = ensureCCW(clipperIn.slice());
  if (subject.length < 3) return [];

  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    const output: Pt[] = [];

    for (let j = 0; j < subject.length; j++) {
      const p = subject[j];
      const q = subject[(j + 1) % subject.length];
      const pin = isInside(p, a, b);
      const qin = isInside(q, a, b);

      if (pin && qin) {
        output.push(q);
      } else if (pin && !qin) {
        output.push(lineIntersection(p, q, a, b));
      } else if (!pin && qin) {
        output.push(lineIntersection(p, q, a, b));
        output.push(q);
      }
    }

    subject = output;
    if (subject.length < 3) return [];
  }

  return subject;
}

export function polygonToPath(poly: Pt[]): string {
  if (poly.length < 3) return '';
  const [x0, y0] = poly[0];
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < poly.length; i++) {
    d += ` L ${poly[i][0]} ${poly[i][1]}`;
  }
  d += ' Z';
  return d;
}

export function makeCirclePolygon(r: number, segments: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts; // CCW
}

export function pointInConvex(poly: Pt[], p: Pt): boolean {
  // assumes poly is CCW and convex
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!isInside(p, a, b)) return false;
  }
  return true;
}
