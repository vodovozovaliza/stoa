import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import Providers from "./components/providers.tsx";
import "./index.css";

// Keep your Buffer polyfill (your original fix)
import { Buffer } from "buffer";
if (typeof window !== "undefined") {
  (window as any).Buffer = (window as any).Buffer || Buffer;
}
if (typeof globalThis !== "undefined") {
  (globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
