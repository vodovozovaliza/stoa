import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import Providers from './components/providers.tsx'
import sdk from '@farcaster/frame-sdk'
import './index.css'

// CRITICAL FIX: Proper Buffer Polyfill
import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}
// Fallback for other environments
if (typeof globalThis !== 'undefined') {
  (globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;
}

function Root() {
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Initialize Farcaster SDK
      try {
        await sdk.context;
        sdk.actions.ready(); 
      } catch (err) {
        console.warn("Farcaster SDK load warning:", err);
      }
      setIsSDKLoaded(true);
    };
    load();
  }, []);

  // Render immediately to avoid blank screen if SDK hangs, 
  // but Providers will handle auth state.
  return (
    <React.StrictMode>
      <Providers>
        <App />
      </Providers>
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);