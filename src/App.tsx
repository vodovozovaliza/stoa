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
import { sdk } from "@farcaster/miniapp-sdk";
import { useSmartAccount } from "./components/providers";
import { AssetWheel, WalletData, WalletMeta } from "./components/AssetWheel";
import { ChainHelixView } from "./components/ChainHelixView";
import { CircleDiagram } from "./components/CircleDiagram";
import "./App.css";

/** -----------------------------
 * Chain configs (EVM)
 * ----------------------------- */
const MAINNET_CFG = {
  id: 1868,
  name: "Soneium",
  api: "https://soneium.blockscout.com/api/v2",
  rpc: "https://rpc.soneium.org",
  router: "0x3EeD194633ba23Bda9976D7F9ac4e97F225Ca61B",
};

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
type EnterPhase = "GATE" | "ZOOMING" | "DASHBOARD";

/** Diagram mode toggle (future-proof) */
type DiagramMode = "wheel" | "alt";

type AssetOption = {
  chain: string;
  symbol: string;
  balance: number;

  chainId?: number;
  isNative?: boolean;

  tokenAddress?: `0x${string}`;
  decimals?: number;

  logoUrl?: string;
};

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

// Explicit Mock Data
const MOCK_DATA_SOURCE: WalletData = {
  // Ethereum: { ETH: 8, USDC: 5, LINK: 3, AAVE: 2 },
  // Solana: { SOL: 7, USDT: 4, JUP: 2 },
  // Arbitrum: { ETH: 4, GMX: 2, USDC: 3 },
};

const MOCK_META_SOURCE = {
  chains: [
    {
      id: "Ethereum",
      assets: [
        { symbol: "ETH", name: "Ether", iconUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=026" },
        { symbol: "USDC", name: "USD Coin", iconUrl: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=026" },
        { symbol: "LINK", name: "Chainlink", iconUrl: "https://cryptologos.cc/logos/chainlink-link-logo.png?v=026" },
        { symbol: "AAVE", name: "Aave", iconUrl: "https://cryptologos.cc/logos/aave-aave-logo.png?v=026" },
      ],
    },
    {
      id: "Solana",
      assets: [
        { symbol: "SOL", name: "Solana", iconUrl: "https://cryptologos.cc/logos/solana-sol-logo.png?v=026" },
        { symbol: "USDT", name: "Tether", iconUrl: "https://cryptologos.cc/logos/tether-usdt-logo.png?v=026" },
        { symbol: "JUP", name: "Jupiter", iconUrl: "https://cryptologos.cc/logos/jupiter-ag-jup-logo.png?v=026" },
      ],
    },
    {
      id: "Arbitrum",
      assets: [
        { symbol: "ETH", name: "Ether (Arb)", iconUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=026" },
        { symbol: "GMX", name: "GMX", iconUrl: "https://cryptologos.cc/logos/gmx-gmx-logo.png?v=026" },
        { symbol: "USDC", name: "USD Coin", iconUrl: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=026" },
      ],
    },
  ],
};

export default function App() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { smartAddress, smartAccountClient } = useSmartAccount();

  /** -----------------------------
   * Wallet address aggregation
   * ----------------------------- */
  const allAddresses = useMemo(() => {
    const list: `0x${string}`[] = [];
    if (user?.wallet?.address) list.push(user.wallet.address as `0x${string}`);
    wallets.forEach((w) => {
      if (w.address && !list.includes(w.address as `0x${string}`)) list.push(w.address as `0x${string}`);
    });
    return list;
  }, [user, wallets]);

  const aaAddress = smartAddress;

  /** -----------------------------
   * Data state
   * ----------------------------- */
  const [farcasterUser, setFarcasterUser] = useState<any>(null);

  const [mainnetAssets, setMainnetAssets] = useState<Record<string, number>>({});
  const [minatoAssets, setMinatoAssets] = useState<Record<string, number>>({});
  const [mainnetTokenList, setMainnetTokenList] = useState<AssetOption[]>([]);
  const [minatoTokenList, setMinatoTokenList] = useState<AssetOption[]>([]);

  const [walletUsd, setWalletUsd] = useState<Record<string, Record<string, number>>>({});
  const [totalBalanceUsd, setTotalBalanceUsd] = useState<number>(0);

  /** -----------------------------
   * UI state
   * ----------------------------- */
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const isChartView = viewMode === "chart" || viewMode === "gallery";

  const [isZooming, setIsZooming] = useState(false);
  const [enterPhase, setEnterPhase] = useState<EnterPhase>("GATE");
  const zoomTimeoutRef = useRef<number | null>(null);
  const isGateZooming = enterPhase === "ZOOMING";
  const dashboardReady = enterPhase === "DASHBOARD";

  const [chartBgEnter, setChartBgEnter] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);

  /** Diagram toggle state (ready for future replacement) */
  const [diagramMode, setDiagramMode] = useState<DiagramMode>("wheel");

  const accountLabel = farcasterUser?.displayName ? farcasterUser.displayName[0] : "W";

  const [selectedChainDetails, setSelectedChainDetails] = useState<{
    name: string;
    tokens: Record<string, number>;
  } | null>(null);

  /** -----------------------------
   * Farcaster Mini App init (context + ready)
   * - Uses miniapp-sdk
   * - Calls ready() once, awaited
   * - Does not break local dev
   * ----------------------------- */
  const [miniAppReady, setMiniAppReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initMiniApp = async () => {
      try {
        // sdk.context is UX-only; do not trust it for auth
        const context = await sdk.context;
        if (!cancelled && context?.user) setFarcasterUser(context.user);

        // Signal the client that the app is ready (await it)
        await sdk.actions.ready();
      } catch (e) {
        // Not running inside a Farcaster-compatible client (local dev / normal browser)
        // Keep going without failing the app.
        console.warn("Mini App SDK init warning:", e);
      } finally {
        if (!cancelled) setMiniAppReady(true);
      }
    };

    initMiniApp();
    return () => {
      cancelled = true;
    };
  }, []);

  /** -----------------------------
   * Gate / enter zoom logic
   * ----------------------------- */
  const clearZoomTimer = () => {
    if (zoomTimeoutRef.current) {
      window.clearTimeout(zoomTimeoutRef.current);
      zoomTimeoutRef.current = null;
    }
  };

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
      clearZoomTimer();
      setEnterPhase("GATE");
      setViewMode("chart");
      setSelectedChainDetails(null);
      setIsAccountOpen(false);
      setDiagramMode("wheel"); // reset on logout
      return;
    }
    if (authenticated && enterPhase !== "DASHBOARD" && enterPhase !== "ZOOMING") startEnterZoom();
  }, [ready, authenticated, enterPhase]);

  useEffect(() => {
    return () => clearZoomTimer();
  }, []);

  /** -----------------------------
   * Fetch balances from Blockscout + RPC
   * ----------------------------- */
  const fetchData = async () => {
    if (allAddresses.length === 0) return;

    const fetchNet = async (cfg: typeof MAINNET_CFG) => {
      const client = createPublicClient({ transport: http(cfg.rpc) });

      const balances: Record<string, number> = {};
      const tokenList: AssetOption[] = [];
      const usedSymbols = new Set<string>();

      const makeUniqueSymbol = (sym: string, tokenAddr?: string) => {
        const base = (sym || "UNK").trim() || "UNK";
        if (!usedSymbols.has(base)) {
          usedSymbols.add(base);
          return base;
        }
        const suffix =
          tokenAddr && /^0x[a-fA-F0-9]{40}$/.test(tokenAddr) ? tokenAddr.slice(2, 6) : `${usedSymbols.size}`;
        const uniq = `${base}-${suffix}`;
        usedSymbols.add(uniq);
        return uniq;
      };

      const parseItems = (data: any): any[] => {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.items)) return data.items;
        return [];
      };

      const nextParamsFrom = (data: any): Record<string, any> | null => {
        if (Array.isArray(data)) return null;
        return data?.next_page_params ?? null;
      };

      const toQueryString = (obj: Record<string, any>) => {
        const p = new URLSearchParams();
        Object.entries(obj).forEach(([k, v]) => {
          if (v === undefined || v === null) return;
          p.set(k, String(v));
        });
        return p.toString();
      };

      const fetchPage = async (addr: `0x${string}`, qs: string) => {
        const url = `${cfg.api}/addresses/${addr}/token-balances${qs ? `?${qs}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        return res.json();
      };

      for (const addr of allAddresses) {
        // 1) Native
        const wei = await client.getBalance({ address: addr }).catch(() => 0n);
        const nativeBal = Number(formatEther(wei));
        if (nativeBal > 0) {
          balances["ETH"] = (balances["ETH"] || 0) + nativeBal;
          if (!tokenList.find((t) => t.chain === cfg.name && t.symbol === "ETH")) {
            tokenList.push({
              chain: cfg.name,
              chainId: cfg.id,
              symbol: "ETH",
              balance: nativeBal,
              isNative: true,
              decimals: 18,
            });
            usedSymbols.add("ETH");
          }
        }

        // 2) ERC20s
        let nextParams: Record<string, any> | null = null;
        let safety = 0;

        do {
          const data = await fetchPage(addr, nextParams ? toQueryString(nextParams) : "");
          if (!data) break;

          const items = parseItems(data);

          for (let i = 0; i < items.length; i++) {
            const t = items[i];
            const tokenInfo = t?.token ?? t ?? {};

            const tokenAddr =
              tokenInfo?.address ??
              tokenInfo?.contract_address ??
              tokenInfo?.contractAddress ??
              t?.token_address ??
              t?.tokenAddress ??
              t?.address;

            const decimalsRaw = tokenInfo?.decimals;
            const decimals =
              decimalsRaw !== undefined && decimalsRaw !== null && Number.isFinite(Number(decimalsRaw))
                ? Number(decimalsRaw)
                : 18;

            const raw = t?.value ?? t?.token_balance ?? t?.balance ?? t?.tokenBalance ?? "0";
            const rawStr = typeof raw === "string" ? raw : String(raw);
            const amt = Number(rawStr) / 10 ** decimals;

            if (!Number.isFinite(amt) || amt <= 0) continue;

            let sym: string =
              tokenInfo?.symbol ??
              tokenInfo?.ticker ??
              tokenInfo?.name ??
              (typeof tokenAddr === "string" && tokenAddr.startsWith("0x") ? `${tokenAddr.slice(0, 6)}...` : "UNK");

            const finalSym = makeUniqueSymbol(sym, tokenAddr);

            balances[finalSym] = (balances[finalSym] || 0) + amt;

            const logoUrl =
              tokenInfo?.icon_url ??
              tokenInfo?.logo_url ??
              tokenInfo?.image_url ??
              tokenInfo?.iconUrl ??
              tokenInfo?.logoUrl ??
              undefined;

            tokenList.push({
              chain: cfg.name,
              chainId: cfg.id,
              symbol: finalSym,
              balance: amt,
              tokenAddress: tokenAddr,
              decimals,
              isNative: false,
              logoUrl,
            });
          }

          nextParams = nextParamsFrom(data);
          safety++;
        } while (nextParams && safety < 60);
      }

      return { balances, tokenList };
    };

    try {
      const [main, minato] = await Promise.all([fetchNet(MAINNET_CFG), fetchNet(MINATO_CFG)]);
      setMainnetAssets(main.balances);
      setMinatoAssets(minato.balances);
      setMainnetTokenList(main.tokenList);
      setMinatoTokenList(minato.tokenList);
    } catch (e) {
      console.error("fetchData failed", e);
      setMainnetAssets({});
      setMinatoAssets({});
      setMainnetTokenList([]);
      setMinatoTokenList([]);
    }
  };

  useEffect(() => {
    if (authenticated && allAddresses.length > 0) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, allAddresses.join("|")]);

  /** -----------------------------
   * Compile walletData (mock + live)
   * ----------------------------- */
  const walletData: WalletData = useMemo(() => {
    const finalData: WalletData = { ...MOCK_DATA_SOURCE };
    finalData["Soneium"] = mainnetAssets;
    finalData["Soneium Minato"] = minatoAssets;
    return finalData;
  }, [mainnetAssets, minatoAssets]);

  /** -----------------------------
   * Compile walletMeta (mock + live)
   * ----------------------------- */
  const walletMeta: WalletMeta = useMemo(() => {
    const meta: WalletMeta = {};

    MOCK_META_SOURCE.chains.forEach((c) => {
      meta[c.id] ??= {};
      c.assets.forEach((a) => {
        meta[c.id][a.symbol] = { logoUrl: a.iconUrl, name: a.name };
      });
    });

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

  /** -----------------------------
   * USD calculation
   * ----------------------------- */
  useEffect(() => {
    if (!authenticated || Object.keys(walletData).length === 0) return;

    const calculateUsd = async () => {
      const uniqueIds = new Set<string>();
      const pricedItems: Array<{ id: string; chain: string; symbol: string; amount: number }> = [];

      const register = (chain: string, sym: string, amt: number) => {
        let id = DUMMY_ASSET_MAP[sym];
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
          const prices = data?.coins || {};

          pricedItems.forEach((it) => {
            const price = prices[it.id]?.price;
            if (typeof price === "number") {
              const val = price * it.amount;
              addUsd(it.chain, it.symbol, val);
              totalCurrentValue += val;
            }
          });
        } catch (e) {
          console.error("Price fetch error", e);
        }
      }

      setWalletUsd(nextWalletUsd);
      setTotalBalanceUsd(totalCurrentValue);
    };

    calculateUsd();
  }, [walletData, authenticated]);

  /** -----------------------------
   * Available assets for Send dropdown
   * ----------------------------- */
  const availableAssets: AssetOption[] = useMemo(() => {
    const out: AssetOption[] = [];

    mainnetTokenList.forEach((a) => out.push(a));
    minatoTokenList.forEach((a) => out.push(a));

    Object.entries(walletData).forEach(([chain, tokens]) => {
      if (chain === "Soneium" || chain === "Soneium Minato") return;
      Object.entries(tokens).forEach(([symbol, balance]) => {
        if (typeof balance === "number" && balance > 0) out.push({ chain, symbol, balance });
      });
    });

    const seen = new Set<string>();
    const dedup: AssetOption[] = [];
    for (const a of out) {
      const k = `${a.chain}::${a.symbol}::${a.tokenAddress ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(a);
    }

    dedup.sort((a, b) => (a.chain + a.symbol).localeCompare(b.chain + b.symbol));
    return dedup;
  }, [walletData, mainnetTokenList, minatoTokenList]);

  /** -----------------------------
   * Send modal state + logic (with asset selection)
   * ----------------------------- */
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAssetKey, setSendAssetKey] = useState("");
  const [sendAmount, setSendAmount] = useState("");

  useEffect(() => {
    if (availableAssets.length === 0) return;
    if (!sendAssetKey) setSendAssetKey(`${availableAssets[0].chain}::${availableAssets[0].symbol}`);
  }, [availableAssets, sendAssetKey]);

  const selectedAsset = useMemo(() => {
    return availableAssets.find((a) => `${a.chain}::${a.symbol}` === sendAssetKey) || null;
  }, [availableAssets, sendAssetKey]);

  const recipientIsValid = isHexAddress(sendRecipient);
  const sendMax = selectedAsset?.balance ?? 0;
  const parsedAmount = Number(sendAmount);
  const amountIsValid = !!selectedAsset && Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= sendMax;

  // MVP SAFETY: restrict onchain sends to Minato only
  const isMinatoAsset = !!selectedAsset?.chainId && selectedAsset.chainId === MINATO_CFG.id;

  const canSubmitSend =
    recipientIsValid &&
    amountIsValid &&
    !!selectedAsset &&
    isMinatoAsset &&
    (selectedAsset.isNative ||
      (!!selectedAsset.tokenAddress &&
        /^0x[a-fA-F0-9]{40}$/.test(String(selectedAsset.tokenAddress)) &&
        Number.isFinite(selectedAsset.decimals ?? 18)));

  const handleSendSubmit = async () => {
    if (!smartAccountClient) {
      alert("Smart Account not ready. Check console.");
      return;
    }
    if (!canSubmitSend || !selectedAsset) return;

    try {
      const to = sendRecipient.trim() as `0x${string}`;

      if (selectedAsset.isNative) {
        const hash = await smartAccountClient.sendTransaction({
          to,
          value: parseEther(sendAmount),
        });
        alert(`Sent! Hash: ${hash}`);
      } else {
        const tokenAddress = selectedAsset.tokenAddress as `0x${string}`;
        const decimals = selectedAsset.decimals ?? 18;
        const amount = parseUnits(sendAmount, decimals);

        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [to, amount],
        });

        const hash = await smartAccountClient.sendTransaction({
          to: tokenAddress,
          data,
          value: 0n,
        });

        alert(`Sent! Hash: ${hash}`);
      }

      setIsSendOpen(false);
      setSendAmount("");
      setSendRecipient("");
      await fetchData();
    } catch (e: any) {
      alert(`Send failed: ${e?.message ?? String(e)}`);
    }
  };

  /** -----------------------------
   * Wheel interactions
   * ----------------------------- */
  const handleTokenClick = (chain: string, _tokenSymbol: string) => {
    const tokens = (walletData as any)[chain] || {};
    setSelectedChainDetails({ name: chain, tokens: tokens as Record<string, number> });
    setIsAccountOpen(false);
    setIsZooming(true);
    window.setTimeout(() => {
      setViewMode("helix");
      setIsZooming(false);
    }, 250);
  };

  const renderDiagram = () => {
    // For now, both modes call the same AssetWheel (you'll swap later).
    // When you're ready, replace the "alt" branch with your new diagram component.
    if (diagramMode === "alt") {
      return (
        <CircleDiagram
          walletData={walletData}
          walletMeta={walletMeta}
          walletUsd={walletUsd}
          onTokenClick={handleTokenClick}
        />
      );
    }

    return (
      <AssetWheel
        walletData={walletData}
        walletMeta={walletMeta}
        walletUsd={walletUsd}
        onTokenClick={handleTokenClick}
        onHubClick={() => setIsSendOpen(true)}
      />
    );
  };

  // Don’t render until Privy is ready AND we finished Mini App init attempt.
  // This prevents "ready()" being fired while the UI is still blank/loading.
  if (!ready || !miniAppReady) return null;

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
                ) : (
                  <div className="gate-enter-hint">Entering…</div>
                )}
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
                            <div className="portfolio-value">
                              ${totalBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>

                        <button className="glass-account-btn" onClick={() => setIsAccountOpen(!isAccountOpen)}>
                          <span className="glass-account-letter">{accountLabel}</span>
                        </button>

                        {/* Diagram mode toggle (top-right, under account button) */}
                        <div className="diagram-toggle-wrap">
                          <button
                            className={`diagram-toggle ${diagramMode === "wheel" ? "active" : ""}`}
                            onClick={() => setDiagramMode("wheel")}
                            type="button"
                          >
                            Wheel
                          </button>
                          <button
                            className={`diagram-toggle ${diagramMode === "alt" ? "active" : ""}`}
                            onClick={() => setDiagramMode("alt")}
                            type="button"
                          >
                            Circles
                          </button>
                        </div>

                        {isAccountOpen && (
                          <div className="glass-account-popover">
                            <div className="glass-account-section">
                              <div className="glass-account-subtitle">Startale Smart ID</div>
                              <div className="glass-account-address">{aaAddress || "Deploying..."}</div>
                            </div>
                            <div className="glass-account-section">
                              <div className="glass-account-subtitle">Scanning Addresses</div>
                              <div className="glass-account-address" style={{ opacity: 0.6, fontSize: "10px" }}>
                                {allAddresses.length > 0 ? `${allAddresses.length} Connected` : "None"}
                              </div>
                            </div>
                            <button className="glass-account-logout" onClick={() => { logout(); setIsAccountOpen(false); }}>
                              Log out
                            </button>
                          </div>
                        )}

                        <div className="wheel-stage">
                          {renderDiagram()}
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
                      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-title">Send via Smart Account</div>

                        <div className="modal-body">
                          <label className="field">
                            <div className="field-label">Recipient</div>
                            <input
                              className={`field-input ${sendRecipient && !recipientIsValid ? "field-error" : ""}`}
                              placeholder="0x..."
                              value={sendRecipient}
                              onChange={(e) => setSendRecipient(e.target.value)}
                              autoFocus
                            />
                          </label>

                          <label className="field">
                            <div className="field-label">Asset</div>
                            <select
                              className="field-input"
                              value={sendAssetKey}
                              onChange={(e) => {
                                setSendAssetKey(e.target.value);
                                setSendAmount("");
                              }}
                            >
                              {availableAssets.map((a) => (
                                <option key={`${a.chain}::${a.symbol}`} value={`${a.chain}::${a.symbol}`}>
                                  {a.symbol} • {a.chain} • Bal: {a.balance.toLocaleString()}
                                </option>
                              ))}
                            </select>

                            {!!selectedAsset && (!selectedAsset.chainId || selectedAsset.chainId !== MINATO_CFG.id) && (
                              <div className="field-help" style={{ marginTop: 6, opacity: 0.8, fontSize: 11 }}>
                                MVP mode: sending is enabled only for Soneium Minato assets.
                              </div>
                            )}
                          </label>

                          <label className="field">
                            <div className="field-label">Amount</div>
                            <input
                              className={`field-input ${sendAmount && !amountIsValid ? "field-error" : ""}`}
                              placeholder={`Max: ${sendMax.toLocaleString()}`}
                              value={sendAmount}
                              onChange={(e) => setSendAmount(e.target.value)}
                            />
                          </label>
                        </div>

                        <div className="modal-footer">
                          <button className="secondary-btn" onClick={() => setIsSendOpen(false)}>Cancel</button>
                          <button className="primary-btn" onClick={handleSendSubmit} disabled={!canSubmitSend}>Send</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {viewMode === "helix" && selectedChainDetails && (
                <div className="helix-screen">
                  <ChainHelixView
                    chainName={selectedChainDetails.name}
                    tokens={selectedChainDetails.tokens}
                    onBack={() => { setViewMode("chart"); setSelectedChainDetails(null); }}
                    walletMeta={walletMeta}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
