import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Mirror the path aliases declared in electron.vite.config.ts / tsconfig.json so
// tests import modules exactly as the app does.
const alias = {
  "@shared": resolve("src/shared"),
  "@core": resolve("src/core"),
  "@runtime": resolve("src/runtime"),
  "@adapters": resolve("src/adapters"),
  "@main": resolve("src/main"),
  "@renderer": resolve("src/renderer")
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
