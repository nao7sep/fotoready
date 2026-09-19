import { configDefaults, defineConfig } from "vitest/config";

import base from "./vitest.config";

// The live lane: the built pipeline worker, the real ExifTool, and the real Gemini
// API, run only by npm run check:full. Files run one at a time because they share
// the build cache, spend money, and wait on the network.
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    exclude: configDefaults.exclude,
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 5 * 60_000,
  },
});
