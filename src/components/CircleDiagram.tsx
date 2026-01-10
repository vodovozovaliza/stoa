import React, { useEffect, useMemo, useRef, useState } from "react";
import "./CircleDiagram.css";

/**
 * Keep types compatible with AssetWheel so you can swap views easily.
 */
export type WalletData = { [chain: string]: Record<string, number> };
export type WalletMeta = {
  [chain: string]: { [symbol: string]: { logoUrl?: string; name?: string } };
};
export type WalletUsd = { [chain: string]: Record<string, number> };

const RADIUS = 200;

// Same idea as AssetWheel CHAIN_COLORS
const CHAIN_COLORS: Record<string, string> = {
  Solana: "rgba(99, 99, 53, 0.30)",
  Arbitrum: "rgba(39, 92, 101, 0.30)",
  "Soneium Minato": "rgba(101, 41, 39, 0.30)",
  Soneium: "rgba(39, 49, 101, 0.30)",
  Ethereum: "rgba(39, 101, 84, 0.30)",
};

// Same chain logos as AssetWheel (so pointers match)
const CHAIN_LOGOS: Record<string, string> = {
  Ethereum: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=026",
  Solana: "https://cryptologos.cc/logos/solana-sol-logo.png?v=026",
  Arbitrum: "https://cryptologos.cc/logos/arbitrum-arb-logo.png?v=026",
  Soneium:
    "https://raw.githubusercontent.com/Soneium/soneium-examples/main/apps/dapp-wagmi-rainbowkit/public/symbol-full-color.svg",
  "Soneium Minato":
    "https://raw.githubusercontent.com/Soneium/soneium-examples/main/apps/dapp-wagmi-rainbowkit/public/symbol-full-color.svg",
};

const OUT_LINE_LEN = 14;
const OUT_LOGO_GAP = 14;
const CHAIN_LOGO_SIZE = 34;

type CircleNode = {
  id: string;
  chain: string;
  symbol: string;
  amount: number;
  usd?: number;

  r: number;
  x: number;
  y: number;

  ax: number; // chain anchor x
  ay: number; // chain anchor y

  color: string;
  logoUrl?: string;

  // floating params (no rotation)
  fPhase: number;
  fAmpX: number;
  fAmpY: number;
  fSpeed: number;
  fWobble: number;
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function fmtCompact(v: number): string {
  const av = Math.abs(v);
  if (av >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (av >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (av >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (av >= 1) return `${v.toFixed(2)}`;
  if (av >= 1e-3) return `${v.toFixed(4)}`;
  return v === 0 ? "0" : v.toExponential(2);
}

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

function norm(x: number, y: number): [number, number] {
  const d = Math.hypot(x, y) || 1e-6;
  return [x / d, y / d];
}

function packCircles(
  nodesIn: CircleNode[],
  opts: {
    containerR: number;
    iterations: number;
    repelStrength: number;
    anchorStrength: number;
    boundaryStrength: number;
    damping: number;
    padding: number;
  }
): CircleNode[] {
  const nodes = nodesIn.map((n) => ({ ...n }));
  const { containerR, iterations, repelStrength, anchorStrength, boundaryStrength, damping, padding } = opts;

  const vx = new Array(nodes.length).fill(0);
  const vy = new Array(nodes.length).fill(0);

  for (let it = 0; it < iterations; it++) {
    // repel overlaps
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const minD = a.r + b.r + padding;

        if (d < minD) {
          const overlap = minD - d;
          const ux = dx / d;
          const uy = dy / d;
          const push = overlap * 0.5 * repelStrength;
          vx[i] -= ux * push;
          vy[i] -= uy * push;
          vx[j] += ux * push;
          vy[j] += uy * push;
        }
      }
    }

    // chain gravity + boundary
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];

      // pull to chain anchor (cluster guarantee)
      vx[i] += (n.ax - n.x) * anchorStrength;
      vy[i] += (n.ay - n.y) * anchorStrength;

      // keep inside invisible outline
      const d0 = Math.hypot(n.x, n.y) || 1e-6;
      const maxD = containerR - n.r - padding;
      if (d0 > maxD) {
        const ux = n.x / d0;
        const uy = n.y / d0;
        const excess = d0 - maxD;
        vx[i] -= ux * excess * boundaryStrength;
        vy[i] -= uy * excess * boundaryStrength;
      }
    }

    // integrate
    for (let i = 0; i < nodes.length; i++) {
      vx[i] *= damping;
      vy[i] *= damping;
      nodes[i].x += vx[i];
      nodes[i].y += vy[i];
    }
  }

  return nodes;
}

function TokenIcon({ symbol, logoUrl, size }: { symbol: string; logoUrl?: string; size: number }) {
  const letter = (symbol?.trim?.()?.[0] ?? "?").toUpperCase();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [logoUrl, symbol]);

  if (!logoUrl || failed) {
    return (
      <div className="cd-icon-fallback" style={{ width: size, height: size }}>
        {letter}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      className="cd-icon-img"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      alt={symbol}
    />
  );
}

function ChainPointerIcon({ chainName, logoUrl, size }: { chainName: string; logoUrl?: string; size: number }) {
  const letter = (chainName?.trim?.()?.[0] ?? "?").toUpperCase();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [logoUrl, chainName]);

  if (!logoUrl || failed) {
    return (
      <div className="cd-chain-pointer-fallback" style={{ width: size, height: size }}>
        {letter}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      className="cd-chain-pointer-img"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      alt={chainName}
    />
  );
}

export interface CircleDiagramProps {
  walletData: WalletData;
  walletMeta?: WalletMeta;
  walletUsd?: WalletUsd;
  onTokenClick: (chainName: string, tokenSymbol: string) => void;
}

export const CircleDiagram: React.FC<CircleDiagramProps> = ({ walletData, walletMeta, walletUsd, onTokenClick }) => {
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

  const activeChains = useMemo(() => {
    return Object.entries(walletData)
      .map(([chain, tokens]) => ({
        chain,
        tokens: Object.entries(tokens).filter(([, amt]) => Number.isFinite(amt) && amt > 0),
      }))
      .filter((c) => c.tokens.length > 0);
  }, [walletData]);

  const seed = useMemo(() => {
    let s = 1337;
    for (const c of activeChains) {
      s = (s * 31 + c.chain.length) >>> 0;
      s = (s * 31 + c.tokens.length) >>> 0;
    }
    return s >>> 0;
  }, [activeChains]);

  const { nodes, pointerTargetsByChain } = useMemo(() => {
    if (activeChains.length === 0) return { nodes: [] as CircleNode[], pointerTargetsByChain: new Map<string, CircleNode>() };

    const rng = mulberry32(seed);

    // Build raw weights
    const raw: Array<{
      chain: string;
      symbol: string;
      amount: number;
      usd?: number;
      weight: number;
      hasPrice: boolean;
    }> = [];

    for (const c of activeChains) {
      for (const [sym, amt] of c.tokens) {
        const usd = walletUsd?.[c.chain]?.[sym];
        const hasPrice = typeof usd === "number" && Number.isFinite(usd) && usd > 0;
        const weight = hasPrice ? usd! : Math.max(amt, 0);
        raw.push({ chain: c.chain, symbol: sym, amount: amt, usd: hasPrice ? usd : undefined, weight, hasPrice });
      }
    }

    // Requirement: MIN_R = 27
    const MIN_R = 27;
    const MAX_R = 78;

    // fallback for unpriced tokens
    const priced = raw.filter((r) => r.hasPrice).map((r) => r.weight);
    let fallbackUsd = 25;
    if (priced.length > 0) {
      priced.sort((a, b) => a - b);
      fallbackUsd = priced[Math.floor(priced.length / 2)];
      fallbackUsd = clamp(fallbackUsd, 5, 2500);
    }

    const weightsForSizing = raw.map((r) => {
      if (r.hasPrice) return r.weight;
      return Math.max(fallbackUsd * 0.65, 15);
    });

    const sumW = weightsForSizing.reduce((a, b) => a + b, 0);
    const containerArea = Math.PI * RADIUS * RADIUS;
    const targetArea = containerArea * 0.50;
    const k = sumW > 0 ? targetArea / sumW : 1;

    // --------- Chain clustering anchors (groups adjacent) ---------
    // Put chain anchors on a ring close to the boundary to satisfy (3) naturally.
    // (still inside so circles don't immediately violate the boundary)
    const ringR = RADIUS * 0.78;

    // Keep chain order stable; place anchors evenly.
    const chainAnchors = new Map<string, { ax: number; ay: number }>();
    for (let i = 0; i < activeChains.length; i++) {
      const theta = (-Math.PI / 2) + (2 * Math.PI * i) / activeChains.length;
      chainAnchors.set(activeChains[i].chain, {
        ax: ringR * Math.cos(theta),
        ay: ringR * Math.sin(theta),
      });
    }

    // Build nodes near their chain anchor (small jitter so groups stay tight)
    const built: CircleNode[] = raw.map((r, idx) => {
      const w = weightsForSizing[idx];
      const rr = Math.sqrt((k * w) / Math.PI);
      const radius = clamp(rr, MIN_R, MAX_R);

      const anchor = chainAnchors.get(r.chain)!;

      // keep jitter small so same-chain tokens are near each other
      const jitter = (rng() - 0.5) * (RADIUS * 0.10);
      const jitter2 = (rng() - 0.5) * (RADIUS * 0.10);

      const baseColor = CHAIN_COLORS[r.chain] ?? "rgba(153,153,153,0.30)";
      const color = normalizeTint(baseColor, 0.30);

      // very subtle float params (no rotation)
      const ampBase = clamp(radius * 0.040, 1.1, 3.2);
      const fAmpX = ampBase * (0.75 + rng() * 0.60);
      const fAmpY = ampBase * (0.75 + rng() * 0.60);
      const fPhase = rng() * Math.PI * 2;
      const fSpeed = 0.00055 + rng() * 0.00035;
      const fWobble = 0.0010 + rng() * 0.0009;

      return {
        id: `${r.chain}::${r.symbol}::${idx}`,
        chain: r.chain,
        symbol: r.symbol,
        amount: r.amount,
        usd: r.usd,
        r: radius,
        x: anchor.ax + jitter,
        y: anchor.ay + jitter2,
        ax: anchor.ax,
        ay: anchor.ay,
        color,
        logoUrl: resolveLogoUrl(r.chain, r.symbol),
        fPhase,
        fAmpX,
        fAmpY,
        fSpeed,
        fWobble,
      };
    });

    // pack: stronger anchor to force clustering by chain
    built.sort((a, b) => b.r - a.r);

    let packed = packCircles(built, {
      containerR: RADIUS - 2,
      iterations: 420,
      repelStrength: 1.0,
      anchorStrength: 0.020,   // <- stronger clustering
      boundaryStrength: 0.55,
      damping: 0.86,
      padding: 2.2,
    });

    // (3) guarantee: move at least one circle near the invisible outline
    // Choose current "outermost" circle and push it out to the boundary (still inside).
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < packed.length; i++) {
      const n = packed[i];
      const score = Math.hypot(n.x, n.y) + n.r; // edge reach
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const target = packed[bestIdx];
    const [ux, uy] = norm(target.x, target.y);

    const desired = (RADIUS - 2) - target.r - 1.0; // ~touch outline
    target.x = ux * desired;
    target.y = uy * desired;

    // re-relax a little to fix any overlaps caused by the push
    packed = packCircles(packed, {
      containerR: RADIUS - 2,
      iterations: 120,
      repelStrength: 1.0,
      anchorStrength: 0.012,
      boundaryStrength: 0.65,
      damping: 0.86,
      padding: 2.2,
    });

    // pointer target should be a circle near the outline; pick again after re-pack
    let pointerIdx = 0;
    let pointerScore = -Infinity;
    for (let i = 0; i < packed.length; i++) {
      const n = packed[i];
      const score = Math.hypot(n.x, n.y) + n.r;
      if (score > pointerScore) {
        pointerScore = score;
        pointerIdx = i;
      }
    }

    // one pointer target per chain: pick the circle in that chain closest to the boundary
    const pointerTargetsByChain = new Map<string, CircleNode>();

    for (const chainObj of activeChains) {
    const chain = chainObj.chain;
    let best: CircleNode | null = null;
    let bestScore = -Infinity;

    for (const n of packed) {
        if (n.chain !== chain) continue;
        const score = Math.hypot(n.x, n.y) + n.r; // boundary reach
        if (score > bestScore) {
        bestScore = score;
        best = n;
        }
    }

    if (best) pointerTargetsByChain.set(chain, best);
    }

    return { nodes: packed, pointerTargetsByChain };

  }, [activeChains, seed, walletUsd, resolveLogoUrl]);

  // Hover handling
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Floating animation time
  const rafRef = useRef<number | null>(null);
  const [tMs, setTMs] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    const start = performance.now();

    const tick = (now: number) => {
      if (!mounted) return;
      setTMs(now - start);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // render smallest last (on top)
  const nodesForRender = useMemo(() => [...nodes].sort((a, b) => b.r - a.r), [nodes]);

  // pointer geometry (4)
  const pointers = useMemo(() => {
    const out: Array<{
        chain: string;
        x1: number; y1: number;
        x2: number; y2: number;
        xLogo: number; yLogo: number;
        url?: string;
    }> = [];

    // spread angle slightly per chain so logos don't stack if chains are close
    const chains = Array.from(pointerTargetsByChain.keys()).sort();

    for (let k = 0; k < chains.length; k++) {
        const chain = chains[k];
        const n = pointerTargetsByChain.get(chain);
        if (!n) continue;

        const d = Math.hypot(n.x, n.y) || 1e-6;
        let ux = n.x / d;
        let uy = n.y / d;

        // tiny angular offset per chain to avoid pointer/logo overlap
        const offset = (k - (chains.length - 1) / 2) * 0.06; // radians
        const cos = Math.cos(offset);
        const sin = Math.sin(offset);
        const ux2 = ux * cos - uy * sin;
        const uy2 = ux * sin + uy * cos;
        ux = ux2; uy = uy2;

        const x1 = n.x + ux * (n.r + 1);
        const y1 = n.y + uy * (n.r + 1);
        const x2 = n.x + ux * (n.r + OUT_LINE_LEN);
        const y2 = n.y + uy * (n.r + OUT_LINE_LEN);

        const xLogo = n.x + ux * (n.r + OUT_LINE_LEN + OUT_LOGO_GAP) - uy * 6;
        const yLogo = n.y + uy * (n.r + OUT_LINE_LEN + OUT_LOGO_GAP) + ux * 6;

        out.push({
        chain,
        x1, y1,
        x2, y2,
        xLogo, yLogo,
        url: CHAIN_LOGOS[chain],
        });
    }

    return out;
    }, [pointerTargetsByChain]);


  return (
    <div className="circle-diagram-container">
      <svg viewBox={`-${RADIUS} -${RADIUS} ${RADIUS * 2} ${RADIUS * 2}`} className="circle-diagram-svg">
        <defs>
          <radialGradient id="cdGlassHighlight" cx="13.35%" cy="16.4%" r="57.2%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
          </radialGradient>

          <filter id="cdLiquid" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.8" result="b1" />
            <feOffset in="b1" dx="2.0" dy="2.0" result="o1" />
            <feComposite in="o1" in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" result="i1" />
            <feFlood floodColor="rgba(255,255,255,0.34)" result="c1" />
            <feComposite in="c1" in2="i1" operator="in" result="s1" />
            <feBlend in="SourceGraphic" in2="s1" mode="normal" />
          </filter>
        </defs>

        {/* (1) No big background circle and no outline circle. */}

        {/* (4) chain pointer to the near-outline circle */}
        {pointers.map((p) => (
            <g key={`ptr:${p.chain}`} className="cd-pointer" pointerEvents="none">
                <line
                x1={p.x1}
                y1={p.y1}
                x2={p.x2}
                y2={p.y2}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={1.2}
                strokeLinecap="round"
                />
                <foreignObject
                x={p.xLogo - CHAIN_LOGO_SIZE / 2}
                y={p.yLogo - CHAIN_LOGO_SIZE / 2}
                width={CHAIN_LOGO_SIZE}
                height={CHAIN_LOGO_SIZE}
                style={{ overflow: "visible" }}
                >
                <ChainPointerIcon chainName={p.chain} logoUrl={p.url} size={CHAIN_LOGO_SIZE} />
                </foreignObject>
            </g>
            ))}


        {/* nodes */}
        <g>
          {nodesForRender.map((n) => {
            const isHover = hoverId === n.id;
            const stroke = isHover ? "rgba(255,255,255,0.85)" : "rgba(255, 250, 250, 0.47)";
            const sw = isHover ? 1.6 : 1.0;

            // subtle floating offsets (no rotation)
            const tt = tMs;
            const a1 = n.fPhase + tt * n.fSpeed;
            const a2 = n.fPhase * 0.7 + tt * n.fWobble;

            const dx = Math.sin(a1) * n.fAmpX + Math.sin(a2) * (n.fAmpX * 0.22);
            const dy = Math.cos(a1 * 0.9) * n.fAmpY + Math.cos(a2 * 1.1) * (n.fAmpY * 0.22);

            const fx = n.x + dx;
            const fy = n.y + dy;

            return (
              <g
                key={n.id}
                className="cd-node cd-float"
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId((prev) => (prev === n.id ? null : prev))}
                onClick={(e) => {
                  e.stopPropagation();
                  onTokenClick(n.chain, n.symbol);
                }}
                style={{ cursor: "pointer" }}
              >
                {/* shadow disk under circle */}
                <circle
                  cx={fx}
                  cy={fy}
                  r={n.r}
                  className="cd-shadow"
                  pointerEvents="none"
                  style={{
                    opacity: clamp(0.10 + (n.r / 140) * 0.22 + Math.sin(a1) * 0.02, 0.08, 0.32),
                  }}
                />

                <circle
                  cx={fx}
                  cy={fy}
                  r={n.r}
                  fill={n.color}
                  stroke={stroke}
                  strokeWidth={sw}
                  filter="url(#cdLiquid)"
                  className="cd-circle"
                />
                <circle
                  cx={fx}
                  cy={fy}
                  r={n.r}
                  fill="url(#cdGlassHighlight)"
                  style={{ mixBlendMode: "plus-lighter" as any, pointerEvents: "none" }}
                />

                <foreignObject
                  x={fx - n.r}
                  y={fy - n.r}
                  width={n.r * 2}
                  height={n.r * 2}
                  style={{ overflow: "visible", pointerEvents: "none" }}
                >
                  <div className="cd-content">
                    {(() => {
                      // Smaller logos than before
                      const iconSize = clamp(n.r * 0.34, 14, 28);
                      const symFont = clamp(n.r * 0.22, 10, 14);
                      const amtFont = clamp(n.r * 0.18, 9, 12);

                      return (
                        <>
                          <div className="cd-icon-wrap" style={{ marginBottom: clamp(n.r * 0.03, 2, 5) }}>
                            <TokenIcon symbol={n.symbol} logoUrl={n.logoUrl} size={iconSize} />
                          </div>

                          <div className="cd-sym" style={{ fontSize: symFont }}>
                            {n.symbol}
                          </div>

                          <div className="cd-amt" style={{ fontSize: amtFont }}>
                            {typeof n.usd === "number" && Number.isFinite(n.usd)
                              ? fmtUsdCompact(n.usd)
                              : fmtCompact(n.amount)}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};
