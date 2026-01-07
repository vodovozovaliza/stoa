/// <reference types="vite/client" />
export {};

declare global {
  // Make Buffer available on globalThis in the browser bundle
  var Buffer: typeof import("buffer").Buffer;
}
