import React, { useState, useEffect, useRef, useMemo, CSSProperties } from "react";
import "./ChainHelixView.css";
import type { WalletMeta } from "./AssetWheel";

const LLAMA_MAP: Record<string, string> = {
  ETH: "coingecko:ethereum",
  USDC: "coingecko:usd-coin",
  SOL: "coingecko:solana",
  LINK: "coingecko:chainlink",
  USDT: "coingecko:tether",
  AAVE: "coingecko:aave",
  GMX: "coingecko:gmx",
  JUP: "coingecko:jupiter-exchange-solana",
};

type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

type ChartPoint = {
  x: number;
  y: number;
  price: number;
  ts?: number;
};

function fmtUSD(v: number): string {
  if (!isFinite(v)) return "$0.00";
  if (v >= 1000) {
    return (
      "$" +
      v.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return (
    "$" +
    v.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })
  );
}

function fmtPrice(p: number): string {
  if (!isFinite(p)) return "$0";
  if (p >= 100) return "$" + p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return "$" + p.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (p >= 0.01) return "$" + p.toLocaleString(undefined, { maximumFractionDigits: 5 });
  return "$" + p.toLocaleString(undefined, { maximumFractionDigits: 7 });
}

function fmtAmount(amount: number): string {
  if (!isFinite(amount)) return "0";
  if (amount >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const TokenChart: React.FC<{
  symbol: string;
  onPrice?: (price: number) => void;
}> = ({ symbol, onPrice }) => {
  const [range, setRange] = useState<Range>("1W");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // hover tooltip
  const [hovered, setHovered] = useState<ChartPoint | null>(null);
  const [hoverPx, setHoverPx] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const onPriceRef = useRef(onPrice);
  useEffect(() => {
    onPriceRef.current = onPrice;
  }, [onPrice]);

  useEffect(() => {
    const fetchChart = async () => {
      const id = LLAMA_MAP[symbol];
      if (!id) {
        setPoints([]);
        setLoading(false);
        onPriceRef.current?.(NaN);
        return;
      }

      setLoading(true);
      try {
        const chartParams: Record<Range, { period: string; samples: string }> = {
          "1D": { period: "1d", samples: "24" },
          "1W": { period: "7d", samples: "42" },
          "1M": { period: "30d", samples: "90" },
          "3M": { period: "90d", samples: "120" },
          "1Y": { period: "365d", samples: "30" },
          "ALL": { period: "1825d", samples: "60" },
        };

        const { period, samples } = chartParams[range];
        const url = `https://coins.llama.fi/chart/${id}?period=${period}&span=${samples}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Llama chart error ${res.status}`);

        const data = await res.json();
        const raw = data.coins?.[id]?.prices || [];
        const clean = raw
          .map((p: any) => ({
            price: Number(p.price),
            ts: p.timestamp ?? p.time ?? p.date ?? undefined,
          }))
          .filter((p: { price: number }) => isFinite(p.price));

        if (!clean.length) {
          setPoints([]);
          onPriceRef.current?.(NaN);
          return;
        }

        const last = clean[clean.length - 1]?.price;
        if (isFinite(last)) onPriceRef.current?.(last);

        const vals = clean.map((p: { price: number }) => p.price);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const priceSpan = max - min || 1;

        const PAD_X = 2; // tighter padding for the cleaner look
        const PAD_Y_TOP = 15;
        const PAD_Y_BOTTOM = 5;

        const X0 = PAD_X;
        const X1 = 100 - PAD_X;
        const Y0 = PAD_Y_TOP;
        const Y1 = 100 - PAD_Y_BOTTOM;

        const mapped: ChartPoint[] = clean.map((p: { price: number; ts?: number }, i: number) => {
          const t = clean.length === 1 ? 0.5 : i / (clean.length - 1);
          const x = X0 + t * (X1 - X0);

          const price = p.price;
          const yNorm = (price - min) / priceSpan;
          const y = Y1 - yNorm * (Y1 - Y0);

          return { x, y, price, ts: p.ts };
        });

        setPoints(mapped);
      } catch (e) {
        console.error(e);
        setPoints([]);
        onPriceRef.current?.(NaN);
      } finally {
        setLoading(false);
      }
    };

    fetchChart();
  }, [symbol, range]);

  const buildSmoothPath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
    if (pts.length < 2) return "";

    // Start path
    const d: string[] = [];
    d.push(`M ${pts[0].x},${pts[0].y}`);

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const smoothing = 0.2;

      const c1x = p1.x + (p2.x - p0.x) * smoothing;
      const c1y = p1.y + (p2.y - p0.y) * smoothing;
      const c2x = p2.x - (p3.x - p1.x) * smoothing;
      const c2y = p2.y - (p3.y - p1.y) * smoothing;

      d.push(`C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`);
    }
    return d.join(" ");
  };

  const linePath = useMemo(() => (points.length ? buildSmoothPath(points) : ""), [points]);
  const areaPath = useMemo(() => {
    if (!points.length || !linePath) return "";
    const bottom = 110;
    return `${linePath} L ${points[points.length - 1].x},${bottom} L ${points[0].x},${bottom} Z`;
  }, [points, linePath]);

  const gradId = `cardgrad-${symbol}-${range}`;

  const fmtTime = (ts?: number) => {
    if (!ts) return "";
    const ms = ts < 10_000_000_000 ? ts * 1000 : ts;
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!points.length) return;

    const svgRect = e.currentTarget.getBoundingClientRect();
    const mxPct = ((e.clientX - svgRect.left) / svgRect.width) * 100;
    const closest = points.reduce((a, b) => (Math.abs(b.x - mxPct) < Math.abs(a.x - mxPct) ? b : a));
    setHovered(closest);

    const wrapRect = wrapRef.current?.getBoundingClientRect();
    if (wrapRect) {
      setHoverPx({ x: e.clientX - wrapRect.left, y: e.clientY - wrapRect.top });
    }
  };

  const onLeave = () => {
    setHovered(null);
    setHoverPx(null);
  };

  return (
    <div className="asset-chart-wrap" ref={wrapRef} onMouseLeave={onLeave}>
      {!loading && points.length > 0 && (
        <div className="asset-chart-hit">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="asset-chart-svg" onMouseMove={onMouseMove}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(0, 255, 71, 0.25)" />
                <stop offset="100%" stopColor="rgba(56, 239, 162, 0.0)" />
              </linearGradient>
            </defs>

            {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}

            {linePath && (
              <path
                d={linePath}
                fill="none"
                // Match the green line from screenshot
                stroke="#5CF586"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {hovered && (
              <g>
                <line
                  x1={hovered.x}
                  y1="0"
                  x2={hovered.x}
                  y2="100"
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="0.5"
                  strokeDasharray="2 2"
                />
                <circle cx={hovered.x} cy={hovered.y} r="2.5" fill="#5CF586" stroke="#000" strokeWidth="0.5" />
              </g>
            )}
          </svg>

          {hovered && hoverPx && (
            <div className="asset-chart-tooltip" style={{ left: hoverPx.x, top: hoverPx.y }}>
              <div className="asset-chart-tooltip-price">{fmtPrice(hovered.price)}</div>
              {hovered.ts ? <div className="asset-chart-tooltip-date">{fmtTime(hovered.ts)}</div> : null}
            </div>
          )}
        </div>
      )}

      <div className="asset-range-row">
        {(["1D", "1W", "1M", "3M", "1Y", "ALL"] as Range[]).map((r) => (
          <button
            key={r}
            className={`asset-range-btn ${range === r ? "active" : ""}`}
            onClick={(ev) => {
              ev.stopPropagation();
              setRange(r);
            }}
          >
            {r === "ALL" ? "All" : r}
          </button>
        ))}
      </div>
    </div>
  );
};

function AssetIcon({ symbol, logoUrl }: { symbol: string; logoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl, symbol]);

  if (!logoUrl || failed) {
    return <div className="asset-icon-fallback">{(symbol?.[0] ?? "?").toUpperCase()}</div>;
  }

  return (
    <img
      src={logoUrl}
      className="asset-icon"
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

interface ChainHelixViewProps {
  chainName: string;
  tokens: Record<string, number>;
  onBack: () => void;
  walletMeta?: WalletMeta;
  initialSymbol?: string; // ✅ NEW
}

export const ChainHelixView: React.FC<ChainHelixViewProps> = ({
  chainName,
  tokens,
  onBack,
  walletMeta,
  initialSymbol,
}) => {
  const tokenList = useMemo(() => Object.entries(tokens).map(([symbol, amount]) => ({ symbol, amount })), [tokens]);
  const count = tokenList.length;

  const viewportRef = useRef<HTMLDivElement>(null);
  const topUIRef = useRef<HTMLDivElement>(null);

  const [scrollProgress, setScrollProgress] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(390);
  const [viewportHeight, setViewportHeight] = useState(844);
  const [visualCenterY, setVisualCenterY] = useState(844 / 2);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const [prices, setPrices] = useState<Record<string, number>>({});

  // magnetic snap
  const snapTimerRef = useRef<number | null>(null);
  const isAutoScrollingRef = useRef(false);

  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

  const scrollToIndex = (idx: number, behavior: ScrollBehavior = "smooth") => {
    const v = viewportRef.current;
    if (!v) return;
    const denom = v.scrollHeight - v.clientHeight || 1;
    const p = count <= 1 ? 0 : idx / (count - 1);
    const top = p * denom;

    isAutoScrollingRef.current = true;
    v.scrollTo({ top, behavior });

    window.setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, behavior === "smooth" ? 500 : 50);
  };

  useEffect(() => {
    if (!initialSymbol) return;
    if (!tokenList.length) return;

    const idx = tokenList.findIndex((t) => t.symbol === initialSymbol);
    if (idx < 0) return;

    // Do NOT lock scroll by focusing; just rotate/scroll so it's the front card.
    setFocusedIndex(null);

    // Wait for layout + scroll depth to be in place.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // instant jump so the helix "opens" on the selected card
        scrollToIndex(idx, "auto");
        const p = count <= 1 ? 0 : idx / (count - 1);
        setScrollProgress(p);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol, tokenList, count]);

  const globalSymbolLogo = useMemo(() => {
    const g: Record<string, string> = {};
    if (!walletMeta) return g;

    for (const c of Object.keys(walletMeta)) {
      const chainObj = walletMeta[c] || {};
      for (const sym of Object.keys(chainObj)) {
        const url = chainObj[sym]?.logoUrl;
        if (url && !g[sym]) g[sym] = url;
      }
    }
    return g;
  }, [walletMeta]);

  const resolveLogoUrl = (sym: string) => {
    return walletMeta?.[chainName]?.[sym]?.logoUrl ?? globalSymbolLogo[sym] ?? undefined;
  };

  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return;

    const onScroll = () => {
      if (focusedIndex !== null && !isAutoScrollingRef.current) return;

      const denom = v.scrollHeight - v.clientHeight || 1;
      const p = denom ? v.scrollTop / denom : 0;
      setScrollProgress(p);

      if (focusedIndex === null) {
        if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current);
        snapTimerRef.current = window.setTimeout(() => {
          const raw = count <= 1 ? 0 : p * (count - 1);
          const nearest = Math.round(raw);
          scrollToIndex(nearest, "smooth");
        }, 140);
      }
    };

    v.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      v.removeEventListener("scroll", onScroll);
      if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current);
    };
  }, [focusedIndex, count]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const measure = () => {
      if (!viewportRef.current || !topUIRef.current) return;

      const rV = viewportRef.current.getBoundingClientRect();
      const rUI = topUIRef.current.getBoundingClientRect();

      const vw = rV.width || 390;
      const vh = rV.height || 844;

      const topUIBottom = rUI.bottom - rV.top;

      setViewportWidth(vw);
      setViewportHeight(vh);
      const baseCenter = vh * 0.46;
      const uiClearance = topUIBottom + 90;
      setVisualCenterY(Math.max(baseCenter, uiClearance));
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);

    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /* Geometry - Updated to match the design's specific card aspect ratio */
  const SPACING_Y = Math.max(220, viewportWidth * 0.65);
  const SAFE_MARGIN_X = Math.max(22, viewportWidth * 0.06);

  // ~326px wide, ~240px tall (plus styling)
  const CARD_W = Math.min(326, viewportWidth * 0.82);
  const CARD_H = 260; // Squarer look

  const ORBIT_RADIUS = Math.max(140, viewportWidth / 2 - CARD_W / 2 - SAFE_MARGIN_X);

  const SIDE_MARGIN = viewportWidth < 500 ? viewportWidth * 0.1 : viewportWidth * 0.14;
  const maxFocusedScale = (viewportWidth - SIDE_MARGIN * 2) / CARD_W;

  const smoothstep = (e0: number, e1: number, x: number) => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };

  const SLOTS = 6;
  const ROTATION_MULT = 2.0;
  const DEG_PER_SLOT = (360 / SLOTS) * ROTATION_MULT;

  const getRotationForIndex = (i: number) => i * DEG_PER_SLOT;

  const activeIndexFloatRaw = count <= 1 ? 0 : scrollProgress * (count - 1);
  const nearestIdx = Math.round(activeIndexFloatRaw);
  const dist = Math.abs(activeIndexFloatRaw - nearestIdx);

  const tMag = smoothstep(0.0, 0.35, dist);
  const activeIndexFloat = nearestIdx + (activeIndexFloatRaw - nearestIdx) * tMag;

  const spindleRotation = activeIndexFloat * DEG_PER_SLOT;
  const pillarStretch = 1.6;
  const pillarTravel = viewportHeight * (pillarStretch - 1);
  const pillarShift = -clamp01(scrollProgress) * pillarTravel;

  return (
    <div className="helix-viewport" ref={viewportRef}>
      <div className="helix-background" style={{ backgroundImage: `url(/assets/background.png)` }} aria-hidden />
      <div className="helix-darken-rect" aria-hidden />
      <div className="scroll-depth" style={{ height: `${Math.max(1, count) * SPACING_Y + viewportHeight}px` }} />

      <div className="fixed-scene-container">
        <img
          className="helix-pillar-static"
          src="/assets/pillar.png"
          alt=""
          aria-hidden
          style={
            {
              ["--pillar-stretch" as any]: `${pillarStretch * 100}%`,
              ["--pillar-shift" as any]: `${pillarShift}px`,
            } as CSSProperties
          }
        />

        <div ref={topUIRef}>
          <nav className="helix-ui-layer">
            <button
              className="back-button"
              onClick={() => {
                setFocusedIndex(null);
                onBack();
              }}
            >
              ← Back
            </button>
          </nav>

          <div className="helix-title-overlay" aria-hidden>
            <h1 className="chain-title">{chainName}</h1>
            <p className="scroll-hint">{count} ASSETS FOUND</p>
          </div>
        </div>

        <div
          className="helix-stage"
          style={
            {
              ["--cardW" as any]: `${CARD_W}px`,
              ["--cardH" as any]: `${CARD_H}px`,
              transform: focusedIndex !== null ? "scale(1.10)" : "scale(1)",
              transition: "transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
            } as CSSProperties
          }
        >
          <div className="helix-spindle">
            {tokenList.map((token, i) => {
              const isFocused = focusedIndex === i;
              const isAnyFocused = focusedIndex !== null;

              const verticalOffset = (i - activeIndexFloat) * SPACING_Y + (visualCenterY - viewportHeight / 2) - 30;

              const cardAngle = getRotationForIndex(i);
              const orbitAngle = cardAngle - spindleRotation;

              const cardHalfH = CARD_H / 2;
              const yAbs = Math.abs(verticalOffset);
              const onScreenY = yAbs < viewportHeight / 2 + cardHalfH + 220;

              const edgeFade = smoothstep(viewportHeight / 2 + 320, viewportHeight / 2 - 320, yAbs);

              const normalized = ((orbitAngle % 360) + 360) % 360;
              const isBehind = normalized > 90 && normalized < 270;

              const baseOpacity = onScreenY ? (0.35 + 0.65 * edgeFade) * (isBehind ? 0.65 : 1) : 0;
              const opacity = isAnyFocused ? (isFocused ? 1 : 0) : baseOpacity;

              const blur = isAnyFocused ? (isFocused ? 0 : 10) : isBehind ? 2 : 0;

              const desiredFocusedScale = 1.14;
              const scale = isFocused ? Math.min(desiredFocusedScale, maxFocusedScale) : isBehind ? 0.94 : 1.03;

              const turn = Math.floor((orbitAngle + 180) / 360);
              const localAngle = orbitAngle - turn * 360;

              let faceRotation: number;
              if (isBehind) {
                faceRotation = -(localAngle - 180) - turn * 360;
              } else {
                const rad = (localAngle * Math.PI) / 180;
                const absCos = Math.abs(Math.cos(rad));
                const tFace = smoothstep(0.15, 0.95, absCos);
                faceRotation = -(localAngle * tFace) - turn * 360;
              }

              const focusLift = Math.max(60, viewportHeight * 0.1);

              const zIndex = isFocused ? 10 : isBehind ? 1 : 3;
              const pe = isAnyFocused ? (isFocused ? "auto" : "none") : onScreenY ? "auto" : "none";

              const price = prices[token.symbol];
              const usd = isFinite(price) ? token.amount * price : NaN;
              const showChart = isFocused || onScreenY;

              return (
                <div
                  key={`${token.symbol}-${i}`}
                  className="helix-card-anchor"
                  style={
                    {
                      pointerEvents: pe as any,
                      opacity,
                      zIndex,
                      transform: `
                        translateX(-50%)
                        rotateY(${orbitAngle}deg)
                        translateZ(${ORBIT_RADIUS}px)
                        translateY(${verticalOffset - (isFocused ? focusLift : 0)}px)
                      `,
                      transition: `
                        transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
                        opacity 0.6s ease
                      `,
                    } as CSSProperties
                  }
                >
                  <div
                    className="asset-card clickable-card"
                    onClick={() => {
                      setFocusedIndex(i);
                      scrollToIndex(i, "smooth");
                    }}
                    style={
                      {
                        transform: `
                          rotateY(${faceRotation}deg)
                          scale(${scale})
                        `,
                        filter: `blur(${blur}px)`,
                        transition: `
                          transform 0.65s cubic-bezier(0.22, 1, 0.36, 1),
                          filter 0.35s ease
                        `,
                      } as CSSProperties
                    }
                  >
                    <div className="asset-top">
                      <div className="asset-top-left">
                        <div className="asset-coinrow">
                          <div className="asset-icon-shell">
                            <AssetIcon symbol={token.symbol} logoUrl={resolveLogoUrl(token.symbol)} />
                          </div>
                          <div className="asset-symbol">{token.symbol}</div>
                        </div>
                        <div className="asset-sub">{isFinite(price) ? fmtPrice(price) : "$—"}</div>
                      </div>

                      <div className="asset-top-right">
                        <div className="asset-amt">
                          {fmtAmount(token.amount)} <span className="asset-amt-sym">{token.symbol}</span>
                        </div>
                        <div className="asset-sub">{isFinite(usd) ? fmtUSD(usd) : "$—"}</div>
                      </div>
                    </div>

                    <div className="asset-bottom">
                      {showChart ? (
                        <TokenChart
                          symbol={token.symbol}
                          onPrice={(p) => {
                            if (!Number.isFinite(p)) return;
                            setPrices((prev) => (prev[token.symbol] === p ? prev : { ...prev, [token.symbol]: p }));
                          }}
                        />
                      ) : null}
                    </div>

                    {isFocused && (
                      <button
                        className="asset-focus-close"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setFocusedIndex(null);
                          scrollToIndex(i, "smooth");
                        }}
                        aria-label="Close focus"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};