import React, { createContext, useContext, useEffect, useState } from 'react';
import { PrivyProvider, useWallets } from '@privy-io/react-auth';
import { createSmartAccountClient, toStartaleSmartAccount } from "@startale-scs/aa-sdk";
import { createWalletClient, custom, http } from "viem";

const soneiumMinato = {
  id: 1946,
  name: 'Soneium Minato',
  network: 'soneium-minato',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.minato.soneium.org'] },
    public: { http: ['https://rpc.minato.soneium.org'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://soneium-minato.blockscout.com' },
  },
  testnet: true,
};

const SmartAccountContext = createContext<{
  smartAccountClient: any;
  smartAddress: `0x${string}` | null;
  isInitialising: boolean;
}>({
  smartAccountClient: null,
  smartAddress: null,
  isInitialising: false,
});

export const useSmartAccount = () => useContext(SmartAccountContext);

function StartaleSmartAccountProvider({ children }: { children: React.ReactNode }) {
  const { wallets } = useWallets();
  const [smartAccountClient, setSmartAccountClient] = useState<any>(null);
  const [smartAddress, setSmartAddress] = useState<`0x${string}` | null>(null);
  const [isInitialising, setIsInitialising] = useState(false);

  useEffect(() => {
    const initSmartAccount = async () => {
      const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
      if (!embeddedWallet || smartAddress) return;

      setIsInitialising(true);
      try {
        const eip1193Provider = await embeddedWallet.getEthereumProvider();
        
        const signer = createWalletClient({
          account: embeddedWallet.address as `0x${string}`,
          chain: soneiumMinato,
          transport: custom(eip1193Provider),
        });

        // 1. Generate the Smart Account Object
        const startaleAccount = await toStartaleSmartAccount({
          signer: signer,
          chain: soneiumMinato,
        });

        // 2. Set Address IMMEDIATELY (so UI shows it)
        setSmartAddress(startaleAccount.address);
        console.log("Smart Account Generated:", startaleAccount.address);

        // 3. Try to initialize the Client (Transaction sender)
        // This might fail if the public RPC doesn't support Bundler methods, 
        // but that's okay for displaying the address.
        try {
          const client = createSmartAccountClient({
            account: startaleAccount,
            chain: soneiumMinato,
            bundlerTransport: http("https://rpc.minato.soneium.org"),
          });
          setSmartAccountClient(client);
        } catch (clientErr) {
          console.warn("Smart Account Client (Sender) init failed - likely needs Paymaster API key:", clientErr);
        }

      } catch (error) {
        console.error("AA Initialization Critical Failure:", error);
      } finally {
        setIsInitialising(false);
      }
    };

    if (wallets.length > 0) {
      initSmartAccount();
    }
  }, [wallets, smartAddress]);

  return (
    <SmartAccountContext.Provider value={{ smartAccountClient, smartAddress, isInitialising }}>
      {children}
    </SmartAccountContext.Provider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID || '';

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: 'dark', accentColor: '#8B5CF6' },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: soneiumMinato,
        supportedChains: [soneiumMinato],
      }}
    >
      <StartaleSmartAccountProvider>
        {children}
      </StartaleSmartAccountProvider>
    </PrivyProvider>
  );
}