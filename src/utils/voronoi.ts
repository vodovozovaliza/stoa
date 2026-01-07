import { Delaunay } from 'd3-delaunay';
import { polygonArea, polygonCentroid, polygonContains } from 'd3-polygon';

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------

export interface Token {
  id: string;
  weight: number; // Used for relative sizing logic if needed later
}

export interface Chain {
  id: string;
  tokens: Token[];
  color?: string;
}

export interface VoronoiCell {
  path: string;       // SVG 'd' attribute
  centroid: [number, number];
  data: Token | Chain;
  color?: string;
}

type Point = [number, number];
type Polygon = Point[];

// ------------------------------------------------------------------
// GEOMETRY MATH HELPERS (Sutherland-Hodgman Clipping)
// ------------------------------------------------------------------

/**
 * Clips a subject polygon against a clip polygon using Sutherland-Hodgman algorithm.
 * Note: Both polygons must be convex (Voronoi cells are always convex).
 */
function clipPolygon(subjectPoly: Polygon, clipPoly: Polygon): Polygon {
  let outputList = subjectPoly;

  const cpLen = clipPoly.length;
  for (let j = 0; j < cpLen; j++) {
    const edgeStart = clipPoly[j];
    const edgeEnd = clipPoly[(j + 1) % cpLen];
    const inputList = outputList;
    outputList = [];

    if (inputList.length === 0) break;

    let S = inputList[inputList.length - 1];

    for (let i = 0; i < inputList.length; i++) {
      const E = inputList[i];

      if (isInside(edgeStart, edgeEnd, E)) {
        if (!isInside(edgeStart, edgeEnd, S)) {
          outputList.push(computeIntersection(edgeStart, edgeEnd, S, E));
        }
        outputList.push(E);
      } else if (isInside(edgeStart, edgeEnd, S)) {
        outputList.push(computeIntersection(edgeStart, edgeEnd, S, E));
      }
      S = E;
    }
  }

  return outputList;
}

/** Determines if point P is inside the edge defined by A->B (assuming counter-clockwise winding) */
function isInside(a: Point, b: Point, p: Point): boolean {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

/** Computes intersection point of line AB and line SE */
function computeIntersection(a: Point, b: Point, s: Point, e: Point): Point {
  const dc = [a[0] - b[0], a[1] - b[1]];
  const dp = [s[0] - e[0], s[1] - e[1]];
  const n1 = a[0] * b[1] - a[1] * b[0];
  const n2 = s[0] * e[1] - s[1] * e[0];
  const n3 = 1.0 / (dc[0] * dp[1] - dc[1] * dp[0]);
  return [
    (n1 * dp[0] - n2 * dc[0]) * n3,
    (n1 * dp[1] - n2 * dc[1]) * n3,
  ];
}

/** Generates a circle approximated as a polygon */
function generateCirclePolygon(radius: number, steps: number = 64): Polygon {
  const points: Polygon = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points; // Counter-clockwise
}

/** Converts a Polygon (array of points) to an SVG path string */
function polygonToPath(poly: Polygon): string {
  if (!poly || poly.length === 0) return "";
  return "M" + poly.map(p => p.join(",")).join("L") + "Z";
}

/** Rejection sampling to find a point inside a polygon */
function samplePointInPolygon(poly: Polygon, bounds: [number, number, number, number]): Point {
  let tries = 0;
  const [minX, minY, maxX, maxY] = bounds;
  
  while (tries < 1000) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    // polygonContains comes from d3-polygon
    if (polygonContains(poly, [x, y])) {
      return [x, y];
    }
    tries++;
  }
  return polygonCentroid(poly); // Fallback
}

// ------------------------------------------------------------------
// MAIN LOGIC
// ------------------------------------------------------------------

export function generateNestedVoronoi(chains: Chain[], radius: number = 1): { 
  cells: VoronoiCell[], 
  chains: VoronoiCell[] // Returning chain cells too for debugging/borders
} {
  // 1. Setup Geometry
  const VIEWBOX_SIZE = radius * 4; // Large enough bounding box for infinite Voronoi
  const BOUNDS: [number, number, number, number] = [-VIEWBOX_SIZE, -VIEWBOX_SIZE, VIEWBOX_SIZE, VIEWBOX_SIZE];
  
  // Create the master clipping circle
  const circlePoly = generateCirclePolygon(radius, 128); 

  // -------------------------
  // LEVEL 1: CHAIN VORONOI
  // -------------------------
  
  // Generate seeds radially for chains (matches Python logic)
  const chainSeeds = chains.map((_, i) => {
    const angle = (2 * Math.PI * i) / chains.length;
    // 0.45 * radius to keep centroids somewhat central but spread out
    return [Math.cos(angle) * (radius * 0.45), Math.sin(angle) * (radius * 0.45)] as Point;
  });

  const chainDelaunay = Delaunay.from(chainSeeds);
  const chainVoronoi = chainDelaunay.voronoi(BOUNDS);

  const chainCells: VoronoiCell[] = [];

  // Process each chain
  for (let i = 0; i < chains.length; i++) {
    const rawPoly = chainVoronoi.cellPolygon(i) as Polygon;
    if (!rawPoly) continue;

    // Clip Chain Cell to Circle
    const clippedPoly = clipPolygon(rawPoly, circlePoly);
    
    if (clippedPoly.length < 3 || Math.abs(polygonArea(clippedPoly)) < 0.001) continue;

    chainCells.push({
      path: polygonToPath(clippedPoly),
      centroid: polygonCentroid(clippedPoly),
      data: chains[i],
      color: chains[i].color
    });
  }

  // -------------------------
  // LEVEL 2: TOKEN VORONOI
  // -------------------------

  const tokenCells: VoronoiCell[] = [];

  // Iterate over calculated chain polygons
  chainCells.forEach((chainCell, _chainIndex) => {
    const chainData = chainCell.data as Chain;
    const parentPoly = parsePathToPolygon(chainCell.path); // Reconstruct polygon points
    
    if (chainData.tokens.length === 0) return;

    // Calculate bounds for random sampling
    const xs = parentPoly.map(p => p[0]);
    const ys = parentPoly.map(p => p[1]);
    const bounds: [number, number, number, number] = [
      Math.min(...xs), Math.min(...ys),
      Math.max(...xs), Math.max(...ys)
    ];

    // Deterministic token seeds near centroid (prevents tiny cells being clipped away)
    const [cx, cy] = polygonCentroid(parentPoly) as Point;

    // spread points in a small spiral around centroid
    const tokenSeeds: Point[] = chainData.tokens.map((_, idx) => {
      const golden = 2.399963229728653; // golden angle
      const r = Math.min(0.35, 0.12 + idx * 0.06) * radius; // grow slowly
      const a = idx * golden;
      let p: Point = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];

      // if outside polygon (rare), fallback to sampler
      if (!polygonContains(parentPoly, p)) {
        p = samplePointInPolygon(parentPoly, bounds);
      }
      return p;
    });


    const tokenDelaunay = Delaunay.from(tokenSeeds);
    const tokenVoronoi = tokenDelaunay.voronoi(BOUNDS);

    for (let k = 0; k < chainData.tokens.length; k++) {
      const rawTokenPoly = tokenVoronoi.cellPolygon(k) as Polygon;
      if (!rawTokenPoly) continue;

      // Clip Token Cell to Parent Chain Cell
      const clippedTokenPoly = clipPolygon(rawTokenPoly, parentPoly);

      if (clippedTokenPoly.length < 3 || Math.abs(polygonArea(clippedTokenPoly)) < 0.000001) continue;

      tokenCells.push({
        path: polygonToPath(clippedTokenPoly),
        centroid: polygonCentroid(clippedTokenPoly),
        data: chainData.tokens[k],
        color: chainData.color // Inherit color for now
      });
    }
  });

  return { cells: tokenCells, chains: chainCells };
}

// Helper to parse the SVG path back to points for the next clipping stage
// (Since we stored it as string in Step 1)
function parsePathToPolygon(pathD: string): Polygon {
  const clean = pathD.replace("M", "").replace("Z", "");
  return clean.split("L").map(pair => {
    const [x, y] = pair.split(",").map(Number);
    return [x, y];
  });
}