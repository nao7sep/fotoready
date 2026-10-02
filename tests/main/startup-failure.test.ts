import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// bootstrap.ts statically imports electron, which is unavailable under vitest's node environment.
vi.mock("electron", () => ({
  app: { on() {}, off() {}, quit() {}, isPackaged: false },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle() {}, removeHandler() {} },
  nativeTheme: { themeSource: "system", shouldUseDarkColors: false },
  powerMonitor: { on() {} }
}));

const { recordStartupFailure } = await import("@main/bootstrap");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a startup failure before the logger exists", () => {
  it("is written to a text file under logs/", () => {
    recordStartupFailure("startup failed", new Error("no catalogue"));

    const logsDir = path.join(process.env.FOTOREADY_DATA_DIR!, "logs");
    const [file] = fs.readdirSync(logsDir);
    expect(file).toMatch(/^\d{8}-\d{6}-\d{3}-utc\.log$/);
    const line = JSON.parse(fs.readFileSync(path.join(logsDir, file), "utf8")) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "error", message: "startup failed", mod: "main.bootstrap", err: { message: "no catalogue" } });
  });

  it("is written to the console when the storage root is unusable", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-root-")), "file");
    fs.writeFileSync(blocker, "x");
    process.env.FOTOREADY_DATA_DIR = blocker;
    try {
      expect(() => recordStartupFailure("startup failed", new Error("no root"))).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"startup failed"'));
    } finally {
      fs.rmSync(path.dirname(blocker), { recursive: true, force: true });
    }
  });
});
