/**
 * Builds the Records window demo (`records-demo.ts`): the app's own build with the demo as one
 * more main-process entry, written to `out/records-demo/` so the app's `out/` parts, which the
 * package is made from, stay as they were. `npm run demo:records` builds and opens it; the live
 * test builds it too.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "electron-vite";
import app from "../../electron.vite.config";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));
const out = resolve(repo, "out/records-demo");
// The app's config resolves its paths from the working folder, which the build runs in: the
// repository. Its single preload input is named here so the demo's entries can join the main ones.
const inputs = (input: unknown): Record<string, string> =>
  typeof input === "string" ? { index: input } : { ...(input as Record<string, string>) };

const base = app as UserConfig;
const { main, preload, renderer } = base;

export default {
  ...base,
  main: {
    ...main,
    build: {
      ...main?.build,
      outDir: resolve(out, "main"),
      rollupOptions: {
        ...main?.build?.rollupOptions,
        input: { ...inputs(main?.build?.rollupOptions?.input), "records-demo": resolve(here, "records-demo.ts") }
      }
    }
  },
  preload: {
    ...preload,
    build: {
      ...preload?.build,
      outDir: resolve(out, "preload"),
      rollupOptions: { ...preload?.build?.rollupOptions, input: inputs(preload?.build?.rollupOptions?.input) }
    }
  },
  renderer: {
    ...renderer,
    build: {
      ...renderer?.build,
      outDir: resolve(out, "renderer"),
      rollupOptions: { ...renderer?.build?.rollupOptions, input: inputs(renderer?.build?.rollupOptions?.input) }
    }
  }
} satisfies UserConfig;
