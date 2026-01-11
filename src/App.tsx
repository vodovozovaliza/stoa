import { useEffect, useMemo, useRef, useState, type CSSProperties, useLayoutEffect } from "react";
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

type BottomNavTab = "view" | "search" | "send" | "gallery";

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

  /** Bottom nav state (sliding glass thumb) */
  const [activeTab, setActiveTab] = useState<BottomNavTab>("view");
  const lastNonSearchTabRef = useRef<BottomNavTab>("view");
  const bottomNavRef = useRef<HTMLDivElement | null>(null);
  const [bottomIndicatorX, setBottomIndicatorX] = useState(0);
  const [bottomIndicatorW, setBottomIndicatorW] = useState<number | null>(null);

  /** Search placeholder widget */
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  /** Portfolio change marker (green/red) */
  const [portfolioDeltaPct, setPortfolioDeltaPct] = useState<number | null>(null);

  const accountLabel = farcasterUser?.displayName ? farcasterUser.displayName[0] : "W";

  const [selectedChainDetails, setSelectedChainDetails] = useState<{
    name: string;
    tokens: Record<string, number>;
    selectedSymbol?: string;
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
   * Portfolio change marker (green/red)
   * - Lightweight: compares against last stored total in localStorage
   * - Updates the snapshot whenever the computed total changes
   * ----------------------------- */
  useEffect(() => {
    if (!authenticated) return;
    if (!Number.isFinite(totalBalanceUsd) || totalBalanceUsd <= 0) {
      setPortfolioDeltaPct(null);
      return;
    }

    const key = "stoa_prev_total_usd";
    const prevRaw = window.localStorage.getItem(key);
    const prev = prevRaw ? Number(prevRaw) : NaN;

    if (Number.isFinite(prev) && prev > 0) {
      const pct = ((totalBalanceUsd - prev) / prev) * 100;
      const safePct = Math.max(-9999, Math.min(9999, pct));
      setPortfolioDeltaPct(safePct);
    } else {
      setPortfolioDeltaPct(null);
    }

    window.localStorage.setItem(key, String(totalBalanceUsd));
  }, [totalBalanceUsd, authenticated]);

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

  const closeSendModal = () => {
    setIsSendOpen(false);
    // Return the nav thumb to the current page's default.
    setActiveTab(viewMode === "gallery" ? "gallery" : "view");
  };

  const closeSearchModal = () => {
    setIsSearchOpen(false);
    // Return the nav thumb to whatever tab was active before Search.
    const back = lastNonSearchTabRef.current;
    if (back && back !== "search") {
      setActiveTab(back);
    } else {
      setActiveTab(viewMode === "gallery" ? "gallery" : "view");
    }
  };

  // Keep bottom nav thumb in sync with the current page.
  useEffect(() => {
    if (isSearchOpen) return;
    if (isSendOpen) {
      setActiveTab("send");
      return;
    }
    if (viewMode === "gallery") setActiveTab("gallery");
    else if (viewMode === "chart") setActiveTab("view");
  }, [viewMode, isSendOpen, isSearchOpen]);

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

      // Build tx: native or erc20 transfer
      if (selectedAsset.isNative) {
        const value = parseEther(sendAmount);
        await smartAccountClient.sendTransaction({
          to,
          value,
          data: "0x",
        });
      } else {
        const decimals = selectedAsset.decimals ?? 18;
        const amount = parseUnits(sendAmount, decimals);
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [to, amount],
        });

        const token = selectedAsset.tokenAddress as `0x${string}`;
        if (!isHexAddress(token)) {
          alert("Invalid token address");
          return;
        }

        await smartAccountClient.sendTransaction({
          to: token,
          value: 0n,
          data,
        });
      }

      closeSendModal();
      setSendRecipient("");
      setSendAmount("");
    } catch (e) {
      console.error(e);
      alert("Send failed (see console).");
    }
  };

  /** -----------------------------
   * Wheel interactions
   * ----------------------------- */
  const handleTokenClick = (chain: string, tokenSymbol: string) => {
    const tokens = (walletData as any)[chain] || {};
    setSelectedChainDetails({ name: chain, tokens: tokens as Record<string, number>, selectedSymbol: tokenSymbol });
    setIsAccountOpen(false);
    setIsZooming(true);
    window.setTimeout(() => {
      setViewMode("helix");
      setIsZooming(false);
    }, 250);
  };

  const renderDiagram = () => {
    if (diagramMode === "alt") {
      return (
        <CircleDiagram walletData={walletData} walletMeta={walletMeta} walletUsd={walletUsd} onTokenClick={handleTokenClick} />
      );
    }

    return (
      <AssetWheel walletData={walletData} walletMeta={walletMeta} walletUsd={walletUsd} onTokenClick={handleTokenClick} onHubClick={handleNavSend} />
    );
  };

  // Keep the bottom-nav thumb perfectly aligned by measuring the active button.
  // IMPORTANT: include dashboardReady so the first measurement happens as soon as the nav mounts.
  const measureBottomThumb = () => {
    const nav = bottomNavRef.current;
    if (!nav) return;

    const btn = nav.querySelector<HTMLButtonElement>(`button[data-tab="${activeTab}"]`);
    if (!btn) return;

    const x = btn.offsetLeft;
    const w = btn.offsetWidth;

    // rAF ensures the browser has committed layout before we animate.
    requestAnimationFrame(() => {
      setBottomIndicatorX(x);
      setBottomIndicatorW(w);
    });
  };

  useLayoutEffect(() => {
    measureBottomThumb();
  }, [activeTab, viewMode, isSendOpen, dashboardReady]);

  // Re-measure on resize / font load changes.
  useEffect(() => {
    const onResize = () => measureBottomThumb();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dashboardReady]);

  const handleNavSwitchView = () => {
    // Diagram button behavior:
    // - If user is NOT on Portfolio (e.g. Gallery), just return to Portfolio.
    // - Only toggle the diagram mode when already on Portfolio.
    if (viewMode !== "chart") {
      setViewMode("chart");
      setActiveTab("view");
      return;
    }

    setDiagramMode((prev) => (prev === "wheel" ? "alt" : "wheel"));
    setActiveTab("view");
  };

  const handleNavSearch = () => {
    if (activeTab !== "search") lastNonSearchTabRef.current = activeTab;
    setActiveTab("search");
    setIsSearchOpen(true);
  };

  const handleNavSend = () => {
    setActiveTab("send");
    setIsSendOpen(true);
  };

  const handleNavGallery = () => {
    setActiveTab("gallery");
    setViewMode("gallery");
  };

  // Don’t render until Privy is ready AND we finished Mini App init attempt.
  // This prevents "ready()" being fired while the UI is still blank/loading.
  if (!ready || !miniAppReady) return null;

  return (
    <div className="app-viewport">
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
                  <button className="gate-connect-btn" onClick={login}>
                    Connect wallet
                  </button>
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
                            <div className="portfolio-value">${totalBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            {portfolioDeltaPct !== null && Number.isFinite(portfolioDeltaPct) && (
                              <div className={"portfolio-change " + (portfolioDeltaPct >= 0 ? "pos" : "neg")} aria-label="Portfolio change">
                                <span className="portfolio-change-arrow">{portfolioDeltaPct >= 0 ? "▲" : "▼"}</span>
                                <span className="portfolio-change-pct">
                                  {Math.abs(portfolioDeltaPct).toLocaleString(undefined, { maximumFractionDigits: 2 })}%
                                </span>
                              </div>
                            )}
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
                              <div className="glass-account-address" style={{ opacity: 0.6, fontSize: "10px" }}>
                                {allAddresses.length > 0 ? `${allAddresses.length} Connected` : "None"}
                              </div>
                            </div>
                            <button
                              className="glass-account-logout"
                              onClick={() => {
                                logout();
                                setIsAccountOpen(false);
                              }}
                            >
                              Log out
                            </button>
                          </div>
                        )}

                        <div className="wheel-stage">{renderDiagram()}</div>
                      </div>
                    </div>

                    <div className="dashboard-page gallery-page">
                      {/* Back button removed per spec */}
                      <div className="gallery-title">Gallery</div>
                    </div>
                  </div>

                  {/* Bottom liquid-glass nav (Portfolio & Gallery) */}
                  <div className="bottom-nav" ref={bottomNavRef} aria-label="Bottom navigation">
                    <div className="bottom-nav-bg" aria-hidden="true" />
                    <div
                      className="bottom-nav-indicator"
                      aria-hidden="true"
                      style={{
                        transform: `translateX(${bottomIndicatorX}px)`,
                        width: bottomIndicatorW ? `${bottomIndicatorW}px` : undefined,
                      }}
                    />

                    <button
                      className={`bottom-nav-btn ${activeTab === "view" ? "is-active" : ""}`}
                      type="button"
                      onClick={handleNavSwitchView}
                      title="Diagram"
                      data-tab="view"
                    >
                      <div className="bottom-nav-btn-inner">
                        <img
                          className="bottom-nav-icon"
                          src={diagramMode === "wheel" ? "/assets/wheel_icon.png" : "/assets/circles_icon.png"}
                          alt=""
                          aria-hidden="true"
                        />
                        <div className="bottom-nav-label">Portfolio</div>
                      </div>
                    </button>

                    <button
                      className={`bottom-nav-btn ${activeTab === "search" ? "is-active" : ""}`}
                      type="button"
                      onClick={handleNavSearch}
                      title="Search"
                      data-tab="search"
                    >
                      <div className="bottom-nav-btn-inner">
                        <img className="bottom-nav-icon" src="/assets/search_icon.png" alt="" aria-hidden="true" />
                        <div className="bottom-nav-label">Search</div>
                      </div>
                    </button>

                    <button
                      className={`bottom-nav-btn ${activeTab === "send" ? "is-active" : ""}`}
                      type="button"
                      onClick={handleNavSend}
                      title="Send"
                      data-tab="send"
                    >
                      <div className="bottom-nav-btn-inner">
                        <img className="bottom-nav-icon" src="/assets/send_icon.png" alt="" aria-hidden="true" />
                        <div className="bottom-nav-label">Send</div>
                      </div>
                    </button>

                    <button
                      className={`bottom-nav-btn ${activeTab === "gallery" ? "is-active" : ""}`}
                      type="button"
                      onClick={handleNavGallery}
                      title="Gallery"
                      data-tab="gallery"
                    >
                      <div className="bottom-nav-btn-inner">
                        <img className="bottom-nav-icon" src="/assets/gallery_icon.png" alt="" aria-hidden="true" />
                        <div className="bottom-nav-label">Gallery</div>
                      </div>
                    </button>
                  </div>

                  {isSearchOpen && (
                    <div className="modal-overlay" onClick={closeSearchModal}>
                      <div className="modal-card modal-card--compact" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                          <div className="modal-title">Search</div>
                          <button className="modal-close" onClick={closeSearchModal} aria-label="Close">
                            ×
                          </button>
                        </div>
                        <div className="modal-body">
                          <div className="dev-chip">In development</div>
                          <div className="dev-text">Search isn’t implemented yet — it’s coming soon.</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {isSendOpen && (
                    <div className="modal-overlay" onClick={closeSendModal}>
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
                                MVP restriction: only Minato assets are enabled for sending.
                              </div>
                            )}
                          </label>

                          <label className="field">
                            <div className="field-label">Amount</div>
                            <input
                              className={`field-input ${sendAmount && !amountIsValid ? "field-error" : ""}`}
                              placeholder="0.00"
                              value={sendAmount}
                              onChange={(e) => setSendAmount(e.target.value)}
                            />
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, opacity: 0.75, fontSize: 11 }}>
                              <span>Max: {sendMax.toLocaleString()}</span>
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => setSendAmount(String(sendMax))}
                                style={{ fontSize: 11 }}
                              >
                                Use max
                              </button>
                            </div>
                          </label>

                          <div style={{ display: "flex", gap: 10, marginTop: 8, justifyContent: "flex-end" }}>
                            <button className="secondary-btn" onClick={closeSendModal}>
                              Cancel
                            </button>
                            <button className="primary-btn" disabled={!canSubmitSend} onClick={handleSendSubmit}>
                              Send
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {viewMode === "helix" && selectedChainDetails && (
                <ChainHelixView
                  chainName={selectedChainDetails.name}
                  tokens={selectedChainDetails.tokens}
                  walletMeta={walletMeta} 
                  initialSymbol={selectedChainDetails.selectedSymbol} 
                  onBack={() => {
                    setSelectedChainDetails(null);
                    setViewMode("chart");
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
