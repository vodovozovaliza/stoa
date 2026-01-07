import React, { useEffect, useMemo, useState } from "react";
import { Delaunay } from "d3-delaunay";
import "./AssetWheel.css";

const CHAIN_COLORS: Record<string, string> = {
  Solana: "rgba(99, 99, 53, 0.30)", 
  Arbitrum: "rgba(39, 92, 101, 0.30)",
  "Soneium Minato": "rgba(101, 41, 39, 0.30)", 
  Soneium: "rgba(39, 49, 101, 0.30)", 
  Ethereum: "rgba(39, 101, 84, 0.30)", 
};

const CHAIN_LOGOS: Record<string, string> = {
  Ethereum: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=026",
  Solana: "https://cryptologos.cc/logos/solana-sol-logo.png?v=026",
  Arbitrum: "https://cryptologos.cc/logos/arbitrum-arb-logo.png?v=026",
  Soneium: "https://raw.githubusercontent.com/Soneium/soneium-examples/main/apps/dapp-wagmi-rainbowkit/public/symbol-full-color.svg",
  "Soneium Minato": "https://raw.githubusercontent.com/Soneium/soneium-examples/main/apps/dapp-wagmi-rainbowkit/public/symbol-full-color.svg",
};

export type WalletData = { [chain: string]: Record<string, number> };
export type WalletMeta = { [chain: string]: { [symbol: string]: { logoUrl?: string; name?: string; }; }; };
export type WalletUsd = { [chain: string]: Record<string, number> };

const RADIUS = 200;
const INNER_HUB_RADIUS = 45;
const OUT_LINE_LEN = 14; 
const OUT_LOGO_GAP = 18; 
const CHAIN_LOGO_SIZE = 40; 

function fmtUsdCompact(v: number): string {
  return `$${v.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })}`;
}

function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function normalizeTint(color: string, alphaIfNoAlpha: number): string {
  const c = (color || "").trim();
  if (/^rgba\(/i.test(c)) return c;
  if (c.startsWith("#")) return hexToRgba(c, alphaIfNoAlpha);
  return c || `rgba(153,153,153,${alphaIfNoAlpha})`;
}

// -------------------------------
// Geometry Helpers
// -------------------------------
type Pt = [number, number];

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randNormal(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function samplePointInCircle(rng: () => number, r: number, inset: number = 0): Pt {
  const rr = Math.max(1e-6, r - inset);
  const theta = rng() * 2 * Math.PI;
  const rad = rr * Math.sqrt(rng());
  return [rad * Math.cos(theta), rad * Math.sin(theta)];
}

function polygonArea(poly: Pt[]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function ensureCCW(poly: Pt[]): Pt[] {
  return polygonArea(poly) < 0 ? [...poly].reverse() : poly;
}

function polygonCentroid(poly: Pt[]): Pt {
  const n = poly.length;
  if (n === 0) return [0, 0];
  const a = polygonArea(poly);
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function polygonToPath(poly: Pt[]): string {
  if (poly.length < 3) return "";
  const [x0, y0] = poly[0];
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < poly.length; i++) d += ` L ${poly[i][0]} ${poly[i][1]}`;
  return d + " Z";
}

function makeCirclePolygon(r: number, segments: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function cross(ax: number, ay: number, bx: number, by: number) { return ax * by - ay * bx; }

function isInsideClip(p: Pt, a: Pt, b: Pt) { return cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) >= 0; }

function lineIntersection(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  const px = p[0], py = p[1], qx = q[0], qy = q[1];
  const ax = a[0], ay = a[1], bx = b[0], by = b[1];
  const r1x = qx - px, r1y = qy - py;
  const r2x = bx - ax, r2y = by - ay;
  const denom = cross(r1x, r1y, r2x, r2y);
  if (Math.abs(denom) < 1e-12) return q;
  const t = cross(ax - px, ay - py, r2x, r2y) / denom;
  return [px + t * r1x, py + t * r1y];
}

function clipConvexPolygon(subjectIn: Pt[], clipperIn: Pt[]): Pt[] {
  let subject = subjectIn.slice();
  const clipper = ensureCCW(clipperIn.slice());
  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length];
    const output: Pt[] = [];
    for (let j = 0; j < subject.length; j++) {
      const p = subject[j], q = subject[(j + 1) % subject.length];
      const pin = isInsideClip(p, a, b), qin = isInsideClip(q, a, b);
      if (pin && qin) output.push(q);
      else if (pin && !qin) output.push(lineIntersection(p, q, a, b));
      else if (!pin && qin) { output.push(lineIntersection(p, q, a, b)); output.push(q); }
    }
    subject = output;
  }
  return subject;
}

function pointInConvex(polyCCW: Pt[], p: Pt): boolean {
  for (let i = 0; i < polyCCW.length; i++) {
    const a = polyCCW[i], b = polyCCW[(i + 1) % polyCCW.length];
    if (!isInsideClip(p, a, b)) return false;
  }
  return true;
}

function toPtArray(poly: any): Pt[] {
  if (!poly || poly.length < 3) return [];
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) out.push([poly[i][0], poly[i][1]]);
  return out;
}

function norm(x: number, y: number) {
  const d = Math.hypot(x, y);
  return d < 1e-9 ? [1, 0] as const : [x / d, y / d] as const;
}

// -------------------------------
// Voronoi Builder
// -------------------------------
type TokenShard = { chainName: string; label: string; amount: number; color: string; poly: Pt[]; centroid: Pt; };
type ChainLabel = { name: string; x: number; y: number };
type TokenEntry = { sym: string; amt: number; weight: number };

function computeSmartWeights(chainName: string, tokens: [string, number][], walletUsd?: WalletUsd): TokenEntry[] {
  // 1. First pass: separate priced vs unpriced
  const priced: number[] = [];
  
  const temp = tokens.map(([sym, amt]) => {
    const usd = walletUsd?.[chainName]?.[sym];
    const hasPrice = typeof usd === "number" && Number.isFinite(usd) && usd > 0;
    if (hasPrice) priced.push(usd);
    return { sym, amt, usd: hasPrice ? usd : 0, hasPrice };
  });

  // 2. Calculate fallback weight (Median of priced assets, or a solid default if none exist)
  let fallbackWeight = 25; // Increased default weight for visibility
  if (priced.length > 0) {
    priced.sort((a, b) => a - b);
    fallbackWeight = priced[Math.floor(priced.length / 2)]; 
    // Don't let fallback be too tiny if median is tiny
    if (fallbackWeight < 5) fallbackWeight = 5; 
  }

  // 3. Assign weights
  return temp.map(t => ({
    sym: t.sym,
    amt: t.amt,
    // If it has a price, use it. If not, use the fallback visual weight.
    weight: t.hasPrice ? t.usd : fallbackWeight 
  }));
}

function buildVoronoiWalletDiagram(
  walletData: WalletData,
  chainColors: Record<string, string>,
  walletUsd?: WalletUsd
): { tokenShards: TokenShard[]; chainLabels: ChainLabel[] } {
  const seedBase = 0, maxSeedSearch = 80, circleSegments = 160;
  const R = RADIUS;
  const circlePoly = makeCirclePolygon(R, circleSegments);
  const circleArea = Math.PI * R * R;
  const extent: [number, number, number, number] = [-R * 2, -R * 2, R * 2, R * 2];

  const activeChains = Object.entries(walletData)
    .map(([chain, tokens]) => ({
      chain,
      tokens: Object.entries(tokens).filter(([, amt]) => amt > 0),
    }))
    .filter((x) => x.tokens.length > 0);

  const nChains = activeChains.length;
  if (nChains === 0) return { tokenShards: [], chainLabels: [] };

  // --- 1. Chain Cells ---
  let bestCoverage = -1, bestSeeds: Pt[] = [], bestCells = new Map<string, Pt[]>();
  for (let s = 0; s < maxSeedSearch; s++) {
    const rng = mulberry32(seedBase + s);
    const seeds: Pt[] = [];
    while (seeds.length < nChains) seeds.push(samplePointInCircle(rng, R, R * 0.06));

    const vor = Delaunay.from(seeds).voronoi(extent);
    const cells = new Map<string, Pt[]>();
    let sumArea = 0;

    for (let i = 0; i < nChains; i++) {
      const raw = toPtArray(vor.cellPolygon(i));
      const clipped = clipConvexPolygon(raw, circlePoly);
      if (clipped.length > 2) {
        cells.set(activeChains[i].chain, ensureCCW(clipped));
        sumArea += Math.abs(polygonArea(clipped));
      }
    }
    if (sumArea / circleArea > bestCoverage) {
      bestCoverage = sumArea / circleArea;
      bestSeeds = seeds;
      bestCells = cells;
      if (bestCoverage >= 0.995) break;
    }
  }

  const tokenShards: TokenShard[] = [];
  const chainLabels: ChainLabel[] = [];

  // --- 2. Token Cells ---
  for (let i = 0; i < nChains; i++) {
    const chainName = activeChains[i].chain;
    const rawTokens = activeChains[i].tokens;
    const cell = bestCells.get(chainName);
    if (!cell) continue;

    const chainCentroid = polygonCentroid(cell);
    chainLabels.push({ name: chainName, x: chainCentroid[0], y: chainCentroid[1] });

    // Generate Points inside Chain Cell
    const rng = mulberry32(seedBase + 10000 + i);
    const coinPts: Pt[] = [];
    
    // Generate exactly as many points as we have tokens
    for (let k = 0; k < rawTokens.length; k++) {
      let pt: Pt | null = null;
      // Random sampling within bounding box until inside poly
      let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (const [x, y] of cell) {
        minx = Math.min(minx, x); miny = Math.min(miny, y);
        maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
      }
      let safety = 0;
      while (!pt && safety++ < 1000) {
        const cand: Pt = [minx + (maxx - minx) * rng(), miny + (maxy - miny) * rng()];
        if (pointInConvex(cell, cand)) pt = cand;
      }
      
      if (!pt) {
        // CRITICAL FIX: Add jitter to fallback.
        // If we use the exact centroid for multiple failures, Delaunay creates degenerate/missing cells.
        const jitterAngle = rng() * Math.PI * 2;
        const jitterDist = 0.5 + rng() * 2.0; 
        pt = [
            chainCentroid[0] + Math.cos(jitterAngle) * jitterDist,
            chainCentroid[1] + Math.sin(jitterAngle) * jitterDist
        ];
      }
      
      coinPts.push(pt);
    }

    const coinVor = Delaunay.from(coinPts).voronoi(extent);
    const shardCells: { poly: Pt[]; centroid: Pt; areaAbs: number }[] = [];

    for (let k = 0; k < rawTokens.length; k++) {
      const raw = toPtArray(coinVor.cellPolygon(k));
      const clipped = clipConvexPolygon(raw, cell);
      // We accept even smaller polygons now
      if (clipped.length > 2) {
        shardCells.push({
          poly: clipped,
          centroid: polygonCentroid(clipped),
          areaAbs: Math.abs(polygonArea(clipped)),
        });
      }
    }

    // Sort by area to assign largest cells to largest weighted tokens
    shardCells.sort((a, b) => b.areaAbs - a.areaAbs);

    const tokensSorted = computeSmartWeights(chainName, rawTokens, walletUsd)
      .sort((a, b) => b.weight - a.weight);

    const nAssign = Math.min(tokensSorted.length, shardCells.length);
    const color = chainColors[chainName] ?? "rgba(153,153,153,0.30)";

    for (let idx = 0; idx < nAssign; idx++) {
      tokenShards.push({
        chainName,
        label: tokensSorted[idx].sym,
        amount: tokensSorted[idx].amt,
        color,
        poly: shardCells[idx].poly,
        centroid: shardCells[idx].centroid,
      });
    }
  }

  return { tokenShards, chainLabels };
}

// -------------------------------
// Components
// -------------------------------
function TokenIcon({ symbol, logoUrl }: { symbol: string; logoUrl?: string }) {
  const letter = (symbol?.trim?.()?.[0] ?? "?").toUpperCase();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl, symbol]);
  if (!logoUrl || failed) return <div className="icon-fallback">{letter}</div>;
  return <img src={logoUrl} className="icon-img" onError={() => setFailed(true)} />;
}

function ChainPointerIcon({ chainName, logoUrl, size }: { chainName: string; logoUrl?: string; size: number; }) {
  const letter = (chainName?.trim?.()?.[0] ?? "?").toUpperCase();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl, chainName]);
  if (!logoUrl || failed) return <div className="chain-pointer-fallback" style={{ width: size, height: size }}>{letter}</div>;
  return <img src={logoUrl} className="chain-pointer-img" style={{ width: size, height: size }} onError={() => setFailed(true)} />;
}

interface AssetWheelProps {
  walletData: WalletData;
  walletMeta?: WalletMeta;
  walletUsd?: WalletUsd;
  onTokenClick: (chainName: string, tokenSymbol: string) => void;
  onHubClick: () => void;
}

export const AssetWheel: React.FC<AssetWheelProps> = ({ walletData, walletMeta, walletUsd, onTokenClick, onHubClick }) => {
  const globalSymbolLogo = useMemo(() => {
    const g: Record<string, string> = {};
    if (!walletMeta) return g;
    for (const chain of Object.keys(walletMeta)) {
      for (const sym of Object.keys(walletMeta[chain] || {})) {
        const url = walletMeta[chain]?.[sym]?.logoUrl;
        if (url && !g[sym]) g[sym] = url;
      }
    }
    return g;
  }, [walletMeta]);

  const resolveLogoUrl = (chainName: string, symbol: string) => 
    walletMeta?.[chainName]?.[symbol]?.logoUrl ?? globalSymbolLogo[symbol];

  const { tokenShards, chainLabels } = useMemo(() => 
    buildVoronoiWalletDiagram(walletData, CHAIN_COLORS, walletUsd), 
    [walletData, walletUsd]
  );

  const outerChainLogoPointers = useMemo(() => chainLabels.map((l) => {
    const [ux, uy] = norm(l.x, l.y);
    return {
      name: l.name,
      x1: ux * (RADIUS - 2), y1: uy * (RADIUS - 2),
      x2: ux * (RADIUS + OUT_LINE_LEN), y2: uy * (RADIUS + OUT_LINE_LEN),
      x: ux * (RADIUS + OUT_LINE_LEN + OUT_LOGO_GAP) - uy * 8, // slight nudge
      y: uy * (RADIUS + OUT_LINE_LEN + OUT_LOGO_GAP) + ux * 8,
      url: CHAIN_LOGOS[l.name],
    };
  }), [chainLabels]);

  return (
    <div className="asset-wheel-container">
      <svg viewBox={`-${RADIUS} -${RADIUS} ${RADIUS * 2} ${RADIUS * 2}`} className="asset-wheel-svg">
        <defs>
          <clipPath id="wheelClip"><circle r={RADIUS - 1.2} /></clipPath>
          <radialGradient id="glassHighlight" cx="13.35%" cy="16.4%" r="57.2%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
          </radialGradient>
          <filter id="liquidShard" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="b1" />
            <feOffset in="b1" dx="2.2" dy="2.2" result="o1" />
            <feComposite in="o1" in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" result="i1" />
            <feFlood floodColor="rgba(255,255,255,0.38)" result="c1" />
            <feComposite in="c1" in2="i1" operator="in" result="s1" />
            <feBlend in="SourceGraphic" in2="s1" mode="normal" />
          </filter>
        </defs>

        <g clipPath="url(#wheelClip)">
          <circle r={RADIUS - 0.2} fill="rgba(255,255,255,0.01)" />
          <circle r={RADIUS - 0.2} fill="url(#glassHighlight)" style={{ mixBlendMode: "plus-lighter" as any }} />
        </g>

        <circle r={RADIUS - 1.2} fill="none" stroke="rgba(255, 250, 250, 0.47)" strokeWidth="1" pointerEvents="none" />

        <g>
          {tokenShards.map((s, i) => (
            <g key={`sh-${i}`}>
              <path
                d={polygonToPath(s.poly)}
                fill={normalizeTint(s.color, 0.3)}
                stroke="rgba(255, 250, 250, 0.47)"
                strokeWidth={1}
                filter="url(#liquidShard)"
                className="token-path"
                onClick={(e) => { e.stopPropagation(); onTokenClick(s.chainName, s.label); }}
              />
            </g>
          ))}
        </g>

        <g pointerEvents="none">
          {outerChainLogoPointers.map((c) => (
            <g key={`chain-pointer-${c.name}`}>
              <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="rgba(255,255,255,0.35)" strokeWidth={1.2} strokeLinecap="round" />
              <foreignObject x={c.x - CHAIN_LOGO_SIZE / 2} y={c.y - CHAIN_LOGO_SIZE / 2} width={CHAIN_LOGO_SIZE} height={CHAIN_LOGO_SIZE} style={{ overflow: "visible" }}>
                <ChainPointerIcon chainName={c.name} logoUrl={c.url} size={CHAIN_LOGO_SIZE} />
              </foreignObject>
            </g>
          ))}
        </g>

        {tokenShards.map((s, i) => {
          const usd = walletUsd?.[s.chainName]?.[s.label];
          // Always show something, even if price is missing
          const usdText = (typeof usd === "number" && Number.isFinite(usd)) ? fmtUsdCompact(usd) : "$—";
          return (
            <foreignObject key={`fo-${i}`} x={s.centroid[0] - 28} y={s.centroid[1] - 33} width={56} height={66} style={{ overflow: "visible", pointerEvents: "none" }}>
              <div className="token-display-center">
                <TokenIcon symbol={s.label} logoUrl={resolveLogoUrl(s.chainName, s.label)} />
                <div className="sym-text">{s.label}</div>
                <div className="amt-text">{usdText}</div>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
};