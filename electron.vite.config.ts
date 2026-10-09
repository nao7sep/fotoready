import { readFileSync } from "node:fs";

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

// Single source of truth for the app version: package.json, injected as
// __APP_VERSION__. Electron's own getVersion() answers about the running binary,
// so an unpackaged run reported Electron's version as the app's.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  main: {
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "workers/pipeline-worker": resolve("src/main/workers/pipeline-worker.ts"),
          "workers/records-worker": resolve("src/main/workers/records-worker.ts"),
          "workers/store-writer": resolve("src/main/workers/store-writer.ts")
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
    server: {
      host: "127.0.0.1",
      port: 23339,
      strictPort: true
    },
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
      // The main window and the Records window, each its own page.
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          records: resolve("src/renderer/records.html")
        }
      },
      modulePreload: { polyfill: false },
      minify: true,
      // Loaded from disk, not over a network: the default 500 kB warning measures
      // transfer cost. 2000 keeps a runaway bundle loud.
      chunkSizeWarningLimit: 2000
    },
    plugins: [react(), contentSecurityPolicy]
  }
});
