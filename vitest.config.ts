import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "node:path";

import { readFileSync } from "node:fs";

// __APP_VERSION__ is injected from package.json by electron.vite.config.ts for the
// build; mirrored here so the tests run against the same value.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

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
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias },
  // The automatic JSX runtime, matching tsconfig.web.json / tsconfig.test.json ("jsx": "react-jsx")
  // and the app build. Without it a .tsx test compiles to the classic React.createElement and fails
  // with "React is not defined" — the type checker and the runner would disagree about the same file.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // .tsx as well as .ts: the component tests build their elements with createElement and a
    // `// @vitest-environment jsdom` docblock, so none is JSX today, but a .tsx one written
    // tomorrow would otherwise be type-checked, look fine, and never run.
    include: ["tests/**/*.test.{ts,tsx}"],
    // Every spec that mounts the interface also fails if a catalogue key reaches the screen
    // (localization-conventions, Gates).
    setupFiles: ["tests/setup/rendered-keys.ts"],
    // The live lane spends money and builds the app; only npm run test:full runs it,
    // through vitest.live.config.ts.
    exclude: [...configDefaults.exclude, "tests/live/**"],
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
