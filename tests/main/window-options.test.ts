import { describe, expect, it, vi } from "vitest";
import {
  computeFirstRunWindowHeight,
  computeFirstRunWindowWidth,
  computeMinWindowHeight,
  computeMinWindowWidth
} from "@shared/layout/workspace-metrics";

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
// Mock the surface it touches so buildWindowOptions can be exercised directly.
vi.mock("electron", () => ({
  app: { whenReady: () => Promise.resolve(), getVersion: () => "0.0.0", isPackaged: false, on() {}, once() {} },
  BrowserWindow: class {},
  ipcMain: { handle() {}, removeHandler() {} },
  nativeTheme: { themeSource: "system", shouldUseDarkColors: false },
  powerMonitor: { once() {}, off() {} }
}));

const { buildWindowOptions } = await import("@main/bootstrap");
const { windowBackground } = await import("@main/theme");

describe("buildWindowOptions", () => {
  const options = buildWindowOptions("/tmp/preload.mjs");

  it("uses the derived minimum size, not hand-typed literals", () => {
    expect(options.minWidth).toBe(computeMinWindowWidth());
    expect(options.minHeight).toBe(computeMinWindowHeight());
    // The old magic literals must be gone.
    expect(options.minWidth).not.toBe(1024);
    expect(options.minHeight).not.toBe(640);
  });

  it("opens at the derived designed size, not a fixed literal", () => {
    // The old fixed 1280x800 default is gone; the first-run width is the compact derived one.
    expect(options.width).not.toBe(1280);
    expect(options.width).toBe(computeFirstRunWindowWidth());
    expect(options.height).toBe(computeFirstRunWindowHeight());
  });

  it("uses Electron-owned bounds persistence for the stable main window", () => {
    expect(options.name).toBe("main");
    expect(options.windowStatePersistence).toEqual({
      bounds: true,
      displayMode: process.platform === "win32",
    });
  });

  it("paints the resolved theme's app background so the first frame never flashes the OS default", () => {
    expect(options.backgroundColor).toBe(windowBackground(false));
  });

  it("wires the given preload path and keeps the renderer sandbox hardening", () => {
    expect(options.webPreferences?.preload).toBe("/tmp/preload.mjs");
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
  });
});
