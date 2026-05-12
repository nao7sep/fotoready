import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

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
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve("src/main/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
    plugins: [react()]
  }
});
