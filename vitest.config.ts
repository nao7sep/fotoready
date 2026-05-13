import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

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
    environment: "node"
  }
});
