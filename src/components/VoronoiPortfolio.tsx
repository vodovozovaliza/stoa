import React, { useEffect, useMemo, useState } from 'react';
import { generateNestedVoronoi, Chain } from '../utils/voronoi';
import portfolioData from '../data/mockPortfolio.json';

// --- Mapping & Types ---
const LLAMA_MAP: Record<string, string> = {
  ETH: 'coingecko:ethereum',
  USDC: 'coingecko:usd-coin',
  SOL: 'coingecko:solana',
  LINK: 'coingecko:chainlink',
  USDT: 'coingecko:tether',
  AAVE: 'coingecko:aave',
  GMX: 'coingecko:gmx',
  JUP: 'coingecko:jupiter-exchange-solana'
};

interface Asset {
  symbol: string;
  weight: number;
  balance: number;
  priceUSD: number;
  iconUrl: string;
}

const RADIUS = 200;

export const VoronoiPortfolio: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [portfolioChange, setPortfolioChange] = useState<number | null>(null);

  // 1. Initial Data Load
  useEffect(() => {
    setData(portfolioData.chains);
    setLoading(false);
  }, []);

  // 2. Fetch 24h Performance & Calculate Overall Movement
  useEffect(() => {
    if (!data) return;

    const fetchOverallPerformance = async () => {
      const allAssets: Asset[] = data.flatMap((c: any) => c.assets);
      const llamaIds = allAssets.map(a => LLAMA_MAP[a.symbol]).filter(id => !!id);
      
      if (llamaIds.length === 0) return;

      try {
        const res = await fetch(`https://coins.llama.fi/percentage/${llamaIds.join(',')}?period=24h`);
        const result = await res.json();
        const priceChanges = result.coins || {};

        let totalWeightedChange = 0;
        let totalWeightOfFoundAssets = 0;

        allAssets.forEach(asset => {
          const id = LLAMA_MAP[asset.symbol];
          const change = priceChanges[id];

          // Ignore assets if DefiLlama has no information
          if (typeof change === 'number') {
            totalWeightedChange += asset.weight * change;
            totalWeightOfFoundAssets += asset.weight;
          }
        });

        // Calculate final average only based on assets with valid data
        if (totalWeightOfFoundAssets > 0) {
          setPortfolioChange(totalWeightedChange / totalWeightOfFoundAssets);
        }
      } catch (e) {
        console.error("DefiLlama fetch error:", e);
      }
    };

    fetchOverallPerformance();
  }, [data]);

  // 3. Voronoi Geometry Engine
  const chains: Chain[] = useMemo(() => {
    if (!data) return [];
    return data.map((chain: any) => ({
      id: chain.id,
      color: chain.themeColor,
      tokens: chain.assets.map((asset: any) => ({
        id: asset.symbol,
        weight: asset.weight,
        ...asset 
      }))
    }));
  }, [data]);

  const { cells: tokenCells, chains: chainCells } = useMemo(() => {
    return generateNestedVoronoi(chains, RADIUS);
  }, [chains]);

  if (loading) return <div className="loading">Loading Citadel Data...</div>;

  return (
    <div className="voronoi-container" style={{ padding: '20px', maxWidth: '420px', margin: '0 auto' }}>
      
      {/* Portfolio Movement Header */}
      <div className="portfolio-perf-header" style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h3 style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem', letterSpacing: '3px' }}>
          CITADEL PERFORMANCE
        </h3>
        {portfolioChange !== null ? (
          <div style={{ 
            fontSize: '2.5rem', 
            fontWeight: '900', 
            color: portfolioChange >= 0 ? '#14F195' : '#FF4D4D',
            textShadow: `0 0 20px ${portfolioChange >= 0 ? 'rgba(20,241,149,0.3)' : 'rgba(255,77,77,0.3)'}`
          }}>
            {portfolioChange >= 0 ? '↑' : '↓'} {Math.abs(portfolioChange).toFixed(2)}%
            <span style={{ fontSize: '0.8rem', opacity: 0.5, marginLeft: '10px' }}>24H</span>
          </div>
        ) : (
          <div style={{ color: 'white', opacity: 0.3 }}>Calculating movement...</div>
        )}
      </div>

      {/* SVG Visualization */}
      <div style={{ aspectRatio: '1/1' }}>
        <svg viewBox={`-${RADIUS} -${RADIUS} ${RADIUS * 2} ${RADIUS * 2}`} style={{ overflow: 'visible' }}>
          <g>
            {tokenCells.map((cell, i) => (
              <path key={i} d={cell.path} fill={cell.color} className="token-path" stroke="rgba(0,0,0,0.2)" />
            ))}
          </g>
          <g pointerEvents="none">
            {chainCells.map((chain, i) => (
              <path key={i} d={chain.path} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
            ))}
          </g>
          {/* Icons and Labels as previously defined */}
        </svg>
      </div>
    </div>
  );
};