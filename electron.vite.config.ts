import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { resolve } from "node:path";
import { CONTENT_SECURITY_POLICY } from "./scripts/content-security-policy";

// Injects the production CSP as a <meta> tag into the built renderer HTML. Build-only: the dev
// server is left without a CSP so Vite HMR (inline scripts, eval, the websocket) keeps working.
const contentSecurityPolicy: Plugin = {
  name: "fotoready-csp",
  apply: "build",
  transformIndexHtml() {
    return [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
        injectTo: "head-prepend"
      }
    ];
  }
};

const alias = {
  "@shared": resolve("src/shared"),
  "@core": resolve("src/core"),
  "@runtime": resolve("src/runtime"),
  "@adapters": resolve("src/adapters"),
  "@main": resolve("src/main"),
  "@renderer": resolve("src/renderer")
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "workers/pipeline-worker": resolve("src/main/workers/pipeline-worker.ts")
        }
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.ts")
      }
    }
  },
  renderer: {
    root: resolve("src/renderer"),
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer")
      }
    },
    // Electron's Chromium supports modulepreload natively, so Vite's inline polyfill script is
    // unnecessary — dropping it keeps the built HTML free of inline scripts, so the CSP can hold
    // script-src to 'self' without 'unsafe-inline'.
    build: {
      modulePreload: { polyfill: false }
    },
    plugins: [react(), contentSecurityPolicy]
  }
});
