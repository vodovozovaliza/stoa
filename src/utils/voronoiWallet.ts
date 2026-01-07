// src/utils/voronoiWallet.ts
import { Delaunay } from 'd3-delaunay';
import type { Pt } from './geom';
import {
  clipConvexPolygon,
  makeCirclePolygon,
  mulberry32,
  pointInConvex,
  polygonArea,
  polygonCentroid,
  polygonToPath,
  randNormal,
  samplePointInCircle,
} from './geom';

export type WalletData = { [chain: string]: Record<string, number> };

export type TokenShard = {
  chainName: string;
  label: string;
  amount: number;
  color: string;
  polygon: Pt[];
  path: string;
  centroid: Pt;
};

export type ChainLabel = { name: string; x: number; y: number };

type Params = {
  radius: number;

  // “Python-like” knobs (scaled to your SVG radius)
  chainInsetRel: number;     // ~0.06
  chainMinDistRel: number;   // ~0.42
  coinSigmaRel: number;      // ~0.10

  circleSegments: number;    // ~128-256
  seedBase: number;          // deterministic layout
  maxSeedSearch: number;     // try multiple seeds for best coverage
};

const DEFAULT_PARAMS: Params = {
  radius: 200,
  chainInsetRel: 0.06,
  chainMinDistRel: 0.42,
  coinSigmaRel: 0.10,
  circleSegments: 160,
  seedBase: 0,
  maxSeedSearch: 80,
};

function toPtArray(poly: any): Pt[] {
  if (!poly || poly.length < 3) return [];
  const out: Pt[] = [];
  // d3 returns a closed ring (last == first). We want open ring.
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    out.push([p[0], p[1]]);
  }
  // remove duplicate closing point if present
  const n = out.length;
  if (n >= 2) {
    const [x0, y0] = out[0];
    const [xL, yL] = out[n - 1];
    if (Math.hypot(x0 - xL, y0 - yL) < 1e-9) out.pop();
  }
  return out;
}

export function buildVoronoiWalletDiagram(
  walletData: WalletData,
  chainColors: Record<string, string>,
  paramsIn?: Partial<Params>
): { tokenShards: TokenShard[]; chainLabels: ChainLabel[] } {
  const P: Params = { ...DEFAULT_PARAMS, ...paramsIn };
  const R = P.radius;

  const activeChains = Object.entries(walletData)
    .map(([chain, tokens]) => ({
      chain,
      tokens: Object.entries(tokens).filter(([, amt]) => amt > 0),
    }))
    .filter((x) => x.tokens.length > 0);

  const nChains = activeChains.length;
  if (nChains === 0) return { tokenShards: [], chainLabels: [] };

  const circlePoly = makeCirclePolygon(R, P.circleSegments);
  const circleArea = Math.PI * R * R;

  const extent: [number, number, number, number] = [-R * 2, -R * 2, R * 2, R * 2];

  // --- Search seeds (like your Python loop) using coverage = sum(chain cell areas)/circle area
  let best = {
    coverage: -1,
    chainSeeds: [] as Pt[],
    chainCells: new Map<string, Pt[]>(),
  };

  for (let s = 0; s < P.maxSeedSearch; s++) {
    const rng = mulberry32(P.seedBase + s);

    // rejection-sample chain seeds in the circle
    const inset = R * P.chainInsetRel;
    const minDist = R * P.chainMinDistRel;

    const seeds: Pt[] = [];
    let tries = 0;

    while (seeds.length < nChains && tries < 200000) {
      tries++;
      const p = samplePointInCircle(rng, R, inset);
      let ok = true;
      for (const q of seeds) {
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < minDist) {
          ok = false;
          break;
        }
      }
      if (ok) seeds.push(p);
    }

    // fallback if rejection sampling fails
    while (seeds.length < nChains) {
      seeds.push(samplePointInCircle(rng, R, inset));
    }

    const delaunay = Delaunay.from(seeds);
    const vor = delaunay.voronoi(extent);

    const chainCells = new Map<string, Pt[]>();
    let sumAreas = 0;

    for (let i = 0; i < nChains; i++) {
      const chainName = activeChains[i].chain;
      const cellPolyRaw = toPtArray(vor.cellPolygon(i));
      if (cellPolyRaw.length < 3) continue;

      // clip chain cell to circle
      const clipped = clipConvexPolygon(cellPolyRaw, circlePoly);
      if (clipped.length < 3) continue;

      chainCells.set(chainName, clipped);
      sumAreas += Math.abs(polygonArea(clipped));
    }

    const coverage = circleArea > 0 ? sumAreas / circleArea : 0;

    if (coverage > best.coverage) {
      best = { coverage, chainSeeds: seeds, chainCells };
      if (coverage >= 0.995) break;
    }
  }

  const tokenShards: TokenShard[] = [];
  const chainLabels: ChainLabel[] = [];

  // --- Build coins inside each chain cell
  for (let i = 0; i < nChains; i++) {
    const chainName = activeChains[i].chain;
    const tokenEntries = activeChains[i].tokens;
    const cell = best.chainCells.get(chainName);
    if (!cell || cell.length < 3) continue;

    // chain label at centroid
    const [cx, cy] = polygonCentroid(cell);
    chainLabels.push({ name: chainName, x: cx, y: cy });

    const rng = mulberry32(P.seedBase + 10_000 + i); // stable per chain
    const center = best.chainSeeds[i];
    const sigma = R * P.coinSigmaRel;

    // sample one seed per token, clustered around chain seed, forced inside cell
    const coinPts: Pt[] = [];
    for (let k = 0; k < tokenEntries.length; k++) {
      let pt: Pt | null = null;

      for (let t = 0; t < 5000; t++) {
        const x = center[0] + randNormal(rng) * sigma;
        const y = center[1] + randNormal(rng) * sigma;
        const cand: Pt = [x, y];
        if (pointInConvex(cell, cand)) {
          pt = cand;
          break;
        }
      }

      // fallback: random in bounding box until inside
      if (!pt) {
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const [x, y] of cell) {
          minx = Math.min(minx, x); miny = Math.min(miny, y);
          maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
        }
        while (true) {
          const cand: Pt = [minx + (maxx - minx) * rng(), miny + (maxy - miny) * rng()];
          if (pointInConvex(cell, cand)) {
            pt = cand;
            break;
          }
        }
      }

      coinPts.push(pt);
    }

    const coinVor = Delaunay.from(coinPts).voronoi(extent);

    for (let k = 0; k < tokenEntries.length; k++) {
      const [sym, amt] = tokenEntries[k];
      const raw = toPtArray(coinVor.cellPolygon(k));
      if (raw.length < 3) continue;

      const clipped = clipConvexPolygon(raw, cell);
      if (clipped.length < 3) continue;

      tokenShards.push({
        chainName,
        label: sym,
        amount: amt,
        color: chainColors[chainName] ?? '#999999',
        polygon: clipped,
        path: polygonToPath(clipped),
        centroid: polygonCentroid(clipped),
      });
    }
  }

  return { tokenShards, chainLabels };
}
