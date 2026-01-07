import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  formatEther,
  http,
  parseEther,
  parseUnits,
  erc20Abi,
  encodeFunctionData,
} from "viem";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import sdk from '@farcaster/frame-sdk'; 
import { useSmartAccount } from "./components/providers"; 
import { AssetWheel, WalletData, WalletMeta } from "./components/AssetWheel";
import { ChainHelixView } from "./components/ChainHelixView";
import "./App.css";

//
const MAINNET_CFG = {
  id: 1868,
  name: "Soneium",
  api: "https://soneium.blockscout.com/api/v2",
  rpc: "https://rpc.soneium.org",
  router: "0x3EeD194633ba23Bda9976D7F9ac4e97F225Ca61B",
};

//
const MINATO_CFG = {
  id: 1946,
  name: "Soneium Minato",
  api: "https://soneium-minato.blockscout.com/api/v2",
  rpc: "https://rpc.minato.soneium.org",
  router: "0x3EeD194633ba23Bda9976D7F9ac4e97F225Ca61B",
  quoteApi: "https://quote-api.cluster.kyo.finance/quote/partners/1946",
};

const DUMMY_ASSET_MAP: Record<string, string> = {
  ETH: "coingecko:ethereum",
  WETH: "coingecko:ethereum",
  USDC: "coingecko:usd-coin",
  SOL: "coingecko:solana",
  LINK: "coingecko:chainlink",
  USDT: "coingecko:tether",
  AAVE: "coingecko:aave",
  GMX: "coingecko:gmx",
  JUP: "coingecko:jupiter-exchange-solana",
};

type ViewMode = "chart" | "helix" | "hub" | "gallery";
type AssetOption = { chain: string; symbol: string; balance: number; chainId?: number; isNative?: boolean; tokenAddress?: `0x${string}`; decimals?: number; logoUrl?: string; };
type EnterPhase = "GATE" | "ZOOMING" | "DASHBOARD";

function isHexAddress(value: string): value is `0x${string}` { return /^0x[a-fA-F0-9]{40}$/.test(value.trim()); }

// Explicit Mock Data
const MOCK_DATA_SOURCE = {
  Ethereum: { ETH: 8, USDC: 5, LINK: 3, AAVE: 2 },
  Solana: { SOL: 7, USDT: 4, JUP: 2 },
  Arbitrum: { ETH: 4, GMX: 2, USDC: 3 },
};

const MOCK_META_SOURCE = {
  chains: [
    { id: "Ethereum", assets: [{ symbol: "ETH", name: "Ether", iconUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=026" }, { symbol: "USDC", name: "USD Coin", iconUrl: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=026" }, { symbol: "LINK", name: "Chainlink", iconUrl: "https://cryptologos.cc/logos/chainlink-link-logo.png?v=026" }, { symbol: "AAVE", name: "Aave", iconUrl: "https://cryptologos.cc/logos/aave-aave-logo.png?v=026" }] },
    { id: "Solana", assets: [{ symbol: "SOL", name: "Solana", iconUrl: "https://cryptologos.cc/logos/solana-sol-logo.png?v=026" }, { symbol: "USDT", name: "Tether", iconUrl: "https://cryptologos.cc/logos/tether-usdt-logo.png?v=026" }, { symbol: "JUP", name: "Jupiter", iconUrl: "https://cryptologos.cc/logos/jupiter-ag-jup-logo.png?v=026" }] },
    { id: "Arbitrum", assets: [{ symbol: "ETH", name: "Ether (Arb)", iconUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=026" }, { symbol: "GMX", name: "GMX", iconUrl: "https://cryptologos.cc/logos/gmx-gmx-logo.png?v=026" }, { symbol: "USDC", name: "USD Coin", iconUrl: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=026" }] },
  ]
};

export default function App() {
  const { ready, authenticated, login, logout, user } = usePrivy(); 
  const { wallets } = useWallets();
  const { smartAddress, smartAccountClient } = useSmartAccount();

  // FIX 1: Scan ALL available wallets (Embedded + External)
  const allAddresses = useMemo(() => {
    const list: `0x${string}`[] = [];
    if (user?.wallet?.address) list.push(user.wallet.address as `0x${string}`);
    wallets.forEach(w => {
      if (w.address && !list.includes(w.address as `0x${string}`)) list.push(w.address as `0x${string}`);
    });
    return list;
  }, [user, wallets]);

  // Use primary wallet for display logic
  const address = allAddresses[0]; 
  const aaAddress = smartAddress;

  const [farcasterUser, setFarcasterUser] = useState<any>(null);
  const [mainnetAssets, setMainnetAssets] = useState<Record<string, number>>({});
  const [minatoAssets, setMinatoAssets] = useState<Record<string, number>>({});
  const [mainnetTokenList, setMainnetTokenList] = useState<AssetOption[]>([]);
  const [minatoTokenList, setMinatoTokenList] = useState<AssetOption[]>([]);
  
  const [walletUsd, setWalletUsd] = useState<Record<string, Record<string, number>>>({});
  const [totalBalanceUsd, setTotalBalanceUsd] = useState<number>(0);

  // UI State
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const isChartView = viewMode === "chart" || viewMode === "gallery";
  const [isZooming, setIsZooming] = useState(false);
  const [enterPhase, setEnterPhase] = useState<EnterPhase>("GATE");
  const zoomTimeoutRef = useRef<number | null>(null);
  const isGateZooming = enterPhase === "ZOOMING";
  const dashboardReady = enterPhase === "DASHBOARD";
  const [chartBgEnter, setChartBgEnter] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const accountLabel = farcasterUser?.displayName ? farcasterUser.displayName[0] : "W";
  const [selectedChainDetails, setSelectedChainDetails] = useState<{ name: string; tokens: Record<string, number>; } | null>(null);

  useEffect(() => {
    const loadFarcaster = async () => {
      try {
        const context = await sdk.context;
        if (context?.user) setFarcasterUser(context.user);
      } catch (e) { console.warn("FC Context error", e); }
    };
    loadFarcaster();
  }, []);

  const clearZoomTimer = () => { if (zoomTimeoutRef.current) { window.clearTimeout(zoomTimeoutRef.current); zoomTimeoutRef.current = null; } };
  const startEnterZoom = () => {
    if (enterPhase === "DASHBOARD" || enterPhase === "ZOOMING") return;
    clearZoomTimer();
    setEnterPhase("ZOOMING");
    zoomTimeoutRef.current = window.setTimeout(() => {
      setEnterPhase("DASHBOARD");
      setChartBgEnter(true);
      window.setTimeout(() => setChartBgEnter(false), 2300);
      zoomTimeoutRef.current = null;
    }, 1550);
  };
  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      clearZoomTimer(); setEnterPhase("GATE"); setViewMode("chart"); setSelectedChainDetails(null); setIsAccountOpen(false); return;
    }
    if (authenticated && enterPhase !== "DASHBOARD" && enterPhase !== "ZOOMING") startEnterZoom();
  }, [ready, authenticated]);

  // FIX 2: Loop through ALL addresses and ALL tokens permissively
  const fetchData = async () => {
    if (allAddresses.length === 0) return;

    const fetchNet = async (cfg: typeof MAINNET_CFG) => {
      try {
        const client = createPublicClient({ transport: http(cfg.rpc) });
        
        let combinedBalances: Record<string, number> = {};
        let combinedList: AssetOption[] = [];

        // Check every connected wallet
        for (const addr of allAddresses) {
          // 1. Native ETH
          const wei = await client.getBalance({ address: addr }).catch(() => 0n);
          const nativeBal = Number(formatEther(wei));
          if (nativeBal > 0) {
            combinedBalances["ETH"] = (combinedBalances["ETH"] || 0) + nativeBal;
            // Only add to list if not already there to avoid duplicates in view
            if (!combinedList.find(i => i.symbol === "ETH")) {
              combinedList.push({ chain: cfg.name, chainId: cfg.id, symbol: "ETH", balance: nativeBal, isNative: true });
            }
          }

          // 2. Token List (Blockscout)
          const fetchPage = async (qs: string) => {
            const url = `${cfg.api}/addresses/${addr}/token-balances${qs ? `?${qs}` : ""}`;
            const res = await fetch(url);
            if (!res.ok) return { items: [] }; // silent fail on 404
            return res.json();
          };

          const toQueryString = (obj: Record<string, any>) => {
            const p = new URLSearchParams();
            Object.entries(obj).forEach(([k, v]) => p.set(k, String(v)));
            return p.toString();
          };

          let nextParams: Record<string, any> | null = null;
          let safety = 0;
          
          do {
            const data = await fetchPage(nextParams ? toQueryString(nextParams) : "");
            const items: any[] = data?.items || [];
            
            for (const t of items) {
              const tokenInfo = t.token || {}; 
              
              // CRITICAL FIX: Handle decimals=0 correctly. 
              // 'decimals' key might be missing, null, "0" string, or 0 number.
              let decimals = 18;
              if (tokenInfo.decimals !== undefined && tokenInfo.decimals !== null) {
                  decimals = Number(tokenInfo.decimals);
              }

              const val = t.value || t.balance || "0";
              const amt = Number(val) / 10 ** decimals;
              
              if (amt <= 0) continue;
              
              // FIX 3: Fallback for missing symbols (Custom Tokens)
              let sym = tokenInfo.symbol;
              if (!sym) {
                  // If symbol missing, use first 6 chars of address
                  const addr = tokenInfo.address || t.token_address;
                  sym = addr ? `${addr.slice(0, 6)}...` : "UNK";
              }
              
              combinedBalances[sym] = (combinedBalances[sym] || 0) + amt;
              
              // Add to list if unique
              if (!combinedList.find(i => i.tokenAddress === (tokenInfo.address || t.token_address))) {
                combinedList.push({
                  chain: cfg.name, 
                  chainId: cfg.id, 
                  symbol: sym, 
                  balance: amt,
                  tokenAddress: tokenInfo.address || t.token_address, 
                  decimals, 
                  isNative: false, 
                  logoUrl: tokenInfo.icon_url
                });
              }
            }
            nextParams = data?.next_page_params ?? null;
            safety++;
          } while (nextParams && safety < 30);
        }

        return { balances: combinedBalances, tokenList: combinedList };
      } catch (e) { 
        console.error(`Failed to fetch ${cfg.name}:`, e);
        return { balances: {}, tokenList: [] }; 
      }
    };

    const [main, minato] = await Promise.all([fetchNet(MAINNET_CFG), fetchNet(MINATO_CFG)]);
    
    setMainnetAssets(main.balances);
    setMinatoAssets(minato.balances);
    setMainnetTokenList(main.tokenList);
    setMinatoTokenList(minato.tokenList);
  };

  useEffect(() => { if (authenticated && allAddresses.length > 0) fetchData(); }, [authenticated, allAddresses]);

  // 3. COMPILE WALLET DATA (Robust Merge)
  const walletData: WalletData = useMemo(() => {
    // Start with Mock Data copy
    const finalData: WalletData = { ...MOCK_DATA_SOURCE };
    
    // Merge Real Data (if any)
    if (Object.keys(mainnetAssets).length > 0) {
      finalData["Soneium"] = mainnetAssets;
    }
    if (Object.keys(minatoAssets).length > 0) {
      finalData["Soneium Minato"] = minatoAssets;
    }
    
    return finalData;
  }, [mainnetAssets, minatoAssets]);

  const walletMeta: WalletMeta = useMemo(() => {
    const meta: WalletMeta = {};
    
    // Add Mock Meta
    MOCK_META_SOURCE.chains.forEach(c => {
        meta[c.id] ??= {};
        c.assets.forEach(a => { meta[c.id][a.symbol] = { logoUrl: a.iconUrl, name: a.name }; });
    });

    // Add Real Meta
    const addFetched = (list: AssetOption[]) => {
      for (const a of list) {
        if (!a.chain || !a.symbol) continue;
        meta[a.chain] ??= {};
        meta[a.chain][a.symbol] ??= {};
        if (a.logoUrl) meta[a.chain][a.symbol].logoUrl = a.logoUrl;
      }
    };
    addFetched(mainnetTokenList);
    addFetched(minatoTokenList);
    
    return meta;
  }, [mainnetTokenList, minatoTokenList]);

  // 4. CALCULATE USD
  useEffect(() => {
    if (!authenticated || Object.keys(walletData).length === 0) return;

    const calculateMovement = async () => {
      const uniqueIds = new Set<string>();
      const pricedItems: Array<{ id: string; chain: string; symbol: string; amount: number }> = [];

      const register = (chain: string, sym: string, amt: number) => {
        let id = DUMMY_ASSET_MAP[sym];
        // Special case for Soneium ETH
        if ((chain === "Soneium" || chain === "Soneium Minato") && (sym === "ETH" || sym === "WETH")) {
          id = "coingecko:ethereum";
        }
        if (id) {
          uniqueIds.add(id);
          pricedItems.push({ id, chain, symbol: sym, amount: amt });
        }
      };

      Object.entries(walletData).forEach(([chain, tokens]) => {
        Object.entries(tokens).forEach(([sym, amt]) => {
          if (amt > 0) register(chain, sym, amt);
        });
      });

      const nextWalletUsd: Record<string, Record<string, number>> = {};
      const addUsd = (chain: string, symbol: string, usd: number) => {
        nextWalletUsd[chain] ??= {};
        nextWalletUsd[chain][symbol] = (nextWalletUsd[chain][symbol] || 0) + usd;
      };

      let totalCurrentValue = 0;
      const idArray = Array.from(uniqueIds);
      
      if (idArray.length > 0) {
        try {
          const ids = idArray.join(",");
          const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
          const data = await res.json();
          const prices = data.coins || {};

          pricedItems.forEach((it) => {
            const price = prices[it.id]?.price;
            if (typeof price === "number") {
              const val = price * it.amount;
              addUsd(it.chain, it.symbol, val);
              totalCurrentValue += val;
            }
          });
        } catch (e) { console.error("Price fetch error", e); }
      }
      setWalletUsd(nextWalletUsd);
      setTotalBalanceUsd(totalCurrentValue);
    };

    calculateMovement();
  }, [walletData, authenticated]);

  // UI Boilerplate
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");

  const handleSendSubmit = async () => {
    if (!smartAccountClient) {
      alert("Smart Account not ready. Check console.");
      return;
    }
    try {
      const hash = await smartAccountClient.sendTransaction({
        to: sendRecipient as `0x${string}`,
        value: parseEther(sendAmount),
      });
      alert(`Sent! Hash: ${hash}`);
      setIsSendOpen(false);
    } catch (e: any) { alert(`Send failed: ${e.message}`); }
  };

  const handleTokenClick = (chain: string, _tokenSymbol: string) => {
    const tokens = (walletData as any)[chain] || {};
    setSelectedChainDetails({ name: chain, tokens: tokens as Record<string, number> });
    setIsAccountOpen(false);
    setIsZooming(true);
    window.setTimeout(() => { setViewMode("helix"); setIsZooming(false); }, 250);
  };

  if (!ready) return null;

  return (
    <div className="app-viewport">
       <style>{`
        .dashboard-actions { position: absolute; bottom: 50px; left: 0; width: 100%; display: flex; justify-content: center; gap: 16px; z-index: 20; pointer-events: auto; }
        .action-btn { background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 20px; padding: 10px 24px; color: white; font-family: inherit; font-weight: 500; cursor: pointer; backdrop-filter: blur(8px); transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .action-btn:hover { background: rgba(255, 255, 255, 0.2); transform: translateY(-2px); }
        .glass-account-section { margin-bottom: 12px; }
        .glass-account-subtitle { font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
      `}</style>
      <div className={["app-stage", viewMode, isZooming ? "zooming" : "", dashboardReady ? "gate-open" : ""].join(" ")}>
        <div className={`app-view ${viewMode}${viewMode === "chart" && chartBgEnter ? " chart-bg-enter" : ""}`}>
          
          {!dashboardReady && (
            <div className={`castle-gate-container ${authenticated ? "is-authenticated" : ""}`}>
              <div className="gate-bg gate-bg-door" />
              <div className="gate-bg gate-bg-wall" />
              <div className="gate-dim" />
              <div className="gate-bottom-gradient" />
              <div className="gate-frame37">
                <div className="gate-frame35">
                  <h2 className="gate-welcome-title">Welcome to Stoa</h2>
                  <p className="gate-welcome-subtitle">Your On-Chain Identity.</p>
                </div>
                {!authenticated ? (
                  <button className="gate-connect-btn" onClick={login}>Connect wallet</button>
                ) : ( <div className="gate-enter-hint">Entering…</div> )}
              </div>
            </div>
          )}

          {authenticated && dashboardReady && !isGateZooming && (
            <>
              {isChartView && (
                <div className="dashboard-reveal-container">
                  <div className={`dashboard-pages ${viewMode === "gallery" ? "show-gallery" : ""}`}>
                    <div className="dashboard-page chart-page">
                      <div className="dashboard">
                        <div className="portfolio-header">
                          <h1 className="portfolio-title">{farcasterUser ? `@${farcasterUser.username}` : "Portfolio"}</h1>
                          <div className="portfolio-metrics">
                            <div className="portfolio-value">${totalBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                          </div>
                        </div>

                        <button className="glass-account-btn" onClick={() => setIsAccountOpen(!isAccountOpen)}>
                           <span className="glass-account-letter">{accountLabel}</span>
                        </button>

                        {isAccountOpen && (
                          <div className="glass-account-popover">
                            <div className="glass-account-section">
                              <div className="glass-account-subtitle">Startale Smart ID</div>
                              <div className="glass-account-address">{aaAddress || "Deploying..."}</div>
                            </div>
                            <div className="glass-account-section">
                              <div className="glass-account-subtitle">Scanning Addresses</div>
                              <div className="glass-account-address" style={{opacity: 0.6, fontSize: '10px'}}>
                                {allAddresses.length > 0 ? `${allAddresses.length} Connected` : "None"}
                              </div>
                            </div>
                            <button className="glass-account-logout" onClick={() => { logout(); setIsAccountOpen(false); }}>Log out</button>
                          </div>
                        )}

                        <div className="wheel-stage">
                          <AssetWheel walletData={walletData} walletMeta={walletMeta} walletUsd={walletUsd} onTokenClick={handleTokenClick} onHubClick={() => setIsSendOpen(true)} />
                        </div>

                        <div className="dashboard-actions">
                          <button className="action-btn" onClick={() => setIsSendOpen(true)}>Send</button>
                          <button className="action-btn" onClick={() => setViewMode("gallery")}>Gallery</button>
                        </div>
                      </div>
                    </div>
                    <div className="dashboard-page gallery-page">
                       <button className="gallery-back-btn" onClick={() => setViewMode("chart")}>← Back</button>
                       <div className="gallery-title">Gallery</div>
                    </div>
                  </div>
                  
                  {isSendOpen && (
                     <div className="modal-overlay" onClick={() => setIsSendOpen(false)}>
                       <div className="modal-card" onClick={e => e.stopPropagation()}>
                         <div className="modal-title">Send via Smart Account</div>
                         <div className="modal-body">
                           <input className="field-input" placeholder="Recipient" value={sendRecipient} onChange={e => setSendRecipient(e.target.value)} />
                           <input className="field-input" placeholder="Amount" value={sendAmount} onChange={e => setSendAmount(e.target.value)} />
                         </div>
                         <div className="modal-footer">
                           <button className="secondary-btn" onClick={() => setIsSendOpen(false)}>Cancel</button>
                           <button className="primary-btn" onClick={handleSendSubmit}>Send</button>
                         </div>
                       </div>
                     </div>
                  )}
                </div>
              )}
              {viewMode === "helix" && selectedChainDetails && (
                <div className="helix-screen">
                  <ChainHelixView chainName={selectedChainDetails.name} tokens={selectedChainDetails.tokens} onBack={() => { setViewMode("chart"); setSelectedChainDetails(null); }} walletMeta={walletMeta} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}