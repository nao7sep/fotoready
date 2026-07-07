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
    include: ["tests/**/*.test.ts"],
    coverage: {
      // V8's native coverage; `include` spans all source so the report flags
      // logic no test reaches, not just a score for what is reached.
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      // Excluded as framework wiring with no decision to cover — measuring them
      // would bury the real gaps under permanent 0%s:
      exclude: [
        "src/main/index.ts", // Electron main entry / bootstrap glue
        "src/main/bootstrap.ts",
        "src/main/workers/**", // worker-thread entrypoints (run off the main thread)
        "src/preload/**", // contextBridge wiring
        "src/renderer/main.tsx", // React DOM mount
        "src/**/types/**", // type-only declaration modules
        "**/*.d.ts"
      ]
    }
  }
});
