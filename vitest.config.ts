import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Tests live under tests/, mirroring the src/ layout, so src/ stays pure shipped code and the
// production typecheck (tsc over src/**) doesn't see test files. The alias map mirrors
// electron.vite.config.ts / tsconfig.json so tests import modules by the same @-aliases the
// app uses.
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
    include: ["tests/**/*.test.ts"]
  }
});
