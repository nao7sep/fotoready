import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR_NAME } from "@shared/constants";

const electron = vi.hoisted(() => ({
  setPath: vi.fn<(name: string, directory: string) => void>(),
  requestSingleInstanceLock: vi.fn<() => boolean>(),
  whenReady: vi.fn<() => Promise<void>>(),
  quit: vi.fn(),
  isPackaged: false
}));
vi.mock("electron", () => ({
  app: electron,
  BrowserWindow: {}, ipcMain: {}, powerMonitor: {},
  nativeTheme: { on() {}, themeSource: "system", shouldUseDarkColors: false },
  shell: {}, dialog: {}, screen: {}
}));

import { bootstrap } from "@main/bootstrap";

let temporary: string;
let home: string;
const readinessBoundary = new Error("test stops at readiness");

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-profile-"));
  home = path.join(temporary, "home");
  fs.mkdirSync(home);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("FOTOREADY_DATA_DIR", path.join(temporary, "profile"));
  electron.setPath.mockReset();
  electron.requestSingleInstanceLock.mockReset().mockReturnValue(true);
  electron.whenReady.mockReset().mockRejectedValue(readinessBoundary);
  electron.quit.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(temporary, { recursive: true, force: true });
});

describe("bootstrap profile admission", () => {
  it("creates and configures the selected profile before admission and readiness", async () => {
    const profile = path.join(temporary, "profile", "electron");
    const calls: string[] = [];
    electron.setPath.mockImplementation((name, directory) => {
      expect(fs.statSync(directory).isDirectory()).toBe(true);
      calls.push(name);
    });
    electron.requestSingleInstanceLock.mockImplementation(() => {
      calls.push("lock");
      return true;
    });
    electron.whenReady.mockImplementation(async () => {
      calls.push("ready");
      throw readinessBoundary;
    });

    await expect(bootstrap()).rejects.toBe(readinessBoundary);

    expect(electron.setPath.mock.calls).toEqual([
      ["userData", profile], ["sessionData", path.join(profile, "session")]
    ]);
    expect(calls).toEqual(["userData", "sessionData", "lock", "ready"]);
  });

  it("derives independent Electron profiles from separate configured roots", async () => {
    for (const name of ["first", "second"]) {
      const root = path.join(temporary, name);
      vi.stubEnv("FOTOREADY_DATA_DIR", root);
      await expect(bootstrap()).rejects.toBe(readinessBoundary);
      expect(electron.setPath).toHaveBeenLastCalledWith("sessionData", path.join(root, "electron", "session"));
      expect(electron.setPath).toHaveBeenCalledWith("userData", path.join(root, "electron"));
    }
    expect(electron.requestSingleInstanceLock).toHaveBeenCalledTimes(2);
  });

  it("quits a second launch of the selected root without starting readiness", async () => {
    electron.requestSingleInstanceLock.mockReturnValue(false);

    await bootstrap();

    expect(electron.setPath).toHaveBeenCalledWith("userData", path.join(temporary, "profile", "electron"));
    expect(electron.quit).toHaveBeenCalledOnce();
    expect(electron.whenReady).not.toHaveBeenCalled();
  });

  it("rejects an unusable root before admission or readiness without creating a default profile", async () => {
    const invalid = path.join(temporary, "file");
    fs.writeFileSync(invalid, "not a directory");
    vi.stubEnv("FOTOREADY_DATA_DIR", invalid);

    await expect(bootstrap()).rejects.toThrow("FOTOREADY_DATA_DIR");

    expect(electron.setPath).not.toHaveBeenCalled();
    expect(electron.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(electron.whenReady).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, DATA_DIR_NAME))).toBe(false);
  });
});
