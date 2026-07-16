import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  clampWindowSizeToWorkArea,
  computeFirstRunWindowHeight,
  computeFirstRunWindowWidth,
  computeMinWindowHeight,
  computeMinWindowWidth
} from "@shared/layout/workspace-metrics";

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
// Mock the surface it touches; nativeTheme is a writable object so the theme-forcing assignment in
// bootstrap() (asserted below by reading the source) has somewhere to land.
vi.mock("electron", () => ({
  app: { whenReady: () => Promise.resolve(), getVersion: () => "0.0.0", isPackaged: false, on() {}, once() {} },
  BrowserWindow: class {},
  ipcMain: { handle() {}, removeHandler() {} },
  nativeTheme: { themeSource: "system" },
  powerMonitor: { once() {}, off() {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 2560, height: 1440 } }) }
}));

const { buildWindowOptions } = await import("@main/bootstrap");

describe("buildWindowOptions", () => {
  const workArea = { width: 2560, height: 1440 };
  const options = buildWindowOptions("/tmp/preload.mjs", workArea, null);

  it("uses the derived minimum size, not hand-typed literals", () => {
    expect(options.minWidth).toBe(computeMinWindowWidth());
    expect(options.minHeight).toBe(computeMinWindowHeight());
    // The old magic literals must be gone.
    expect(options.minWidth).not.toBe(1024);
    expect(options.minHeight).not.toBe(640);
  });

  it("first run (no saved size) opens at the derived first-run size, not a fixed literal", () => {
    expect(options.width).toBe(clampWindowSizeToWorkArea(
      { width: computeFirstRunWindowWidth(), height: computeFirstRunWindowHeight() },
      workArea
    ).width);
    // The old fixed 1280x800 default is gone; the first-run width is the compact derived one.
    expect(options.width).not.toBe(1280);
    expect(options.width).toBe(computeFirstRunWindowWidth());
  });

  it("restores a remembered size, clamped to the current screen", () => {
    // A size saved on a big monitor, reopened on a small laptop: clamps down to fit.
    const saved = { width: 3000, height: 2000 };
    const small = { width: 1440, height: 900 };
    const opts = buildWindowOptions("/tmp/preload.mjs", small, saved);
    expect(opts.width).toBe(clampWindowSizeToWorkArea(saved, small).width);
    expect(opts.width).toBeLessThanOrEqual(small.width);
    expect(opts.width).toBeGreaterThanOrEqual(computeMinWindowWidth());
  });

  it("paints the light app background so the native chrome never flashes a dark default", () => {
    expect(options.backgroundColor).toBe("#f5f5f4");
  });

  it("wires the given preload path and keeps the renderer sandbox hardening", () => {
    expect(options.webPreferences?.preload).toBe("/tmp/preload.mjs");
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
  });
});

describe("native title-bar theme", () => {
  it("forces the light theme so a light app never gets a dark native bar", () => {
    // The assignment is a global side effect inside bootstrap(); assert it is present in the source
    // rather than running the whole app. A light app on a dark-mode host must force the bar light.
    const bootstrapPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/main/bootstrap.ts");
    const source = readFileSync(bootstrapPath, "utf8");
    expect(source).toMatch(/nativeTheme\.themeSource\s*=\s*"light"/);
  });
});
