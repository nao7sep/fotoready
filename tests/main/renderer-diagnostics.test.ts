import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";
import { configureRendererDiagnostics } from "@main/renderer-diagnostics";

it.each(["main", "records"] as const)("records one %s renderer failure through the main logger and removes its listener on close", (identity) => {
  const contents = new EventEmitter();
  const win = Object.assign(new EventEmitter(), { webContents: contents });
  const logger = { error: vi.fn() };
  configureRendererDiagnostics(win as unknown as BrowserWindow, identity, logger);
  expect(contents.listenerCount("render-process-gone")).toBe(1);

  contents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 139 });
  expect(logger.error).toHaveBeenCalledExactlyOnceWith("renderer process exited", {
    mod: "main.renderer", window: identity, reason: "crashed", exitCode: 139
  });

  win.emit("closed");
  expect(contents.listenerCount("render-process-gone")).toBe(0);
  contents.emit("render-process-gone", {}, { reason: "killed", exitCode: 1 });
  expect(logger.error).toHaveBeenCalledTimes(1);
});
