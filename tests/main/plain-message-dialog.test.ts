import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  loadError: undefined as unknown,
  executeResults: [] as Array<number | Error>,
  windows: [] as Array<{ close: () => void; show: ReturnType<typeof vi.fn> }>,
}));

vi.mock("electron", () => {
  class FakeBrowserWindow {
    static getFocusedWindow(): undefined { return undefined; }

    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    private destroyed = false;
    readonly close = vi.fn(() => {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit("closed");
    });
    readonly show = vi.fn();
    readonly setContentSize = vi.fn();
    readonly webContents = {
      on: (event: string, listener: (...args: unknown[]) => void) => this.addListener(event, listener),
      once: (event: string, listener: (...args: unknown[]) => void) => this.addListener(event, listener),
      executeJavaScript: vi.fn(async () => {
        const result = electron.executeResults.shift() ?? 220;
        if (result instanceof Error) throw result;
        return result;
      }),
    };

    constructor() {
      electron.windows.push(this);
    }

    isDestroyed(): boolean { return this.destroyed; }

    loadURL(): Promise<void> {
      if (electron.loadError !== undefined) return Promise.reject(electron.loadError);
      return Promise.resolve().then(() => this.emit("dom-ready"));
    }

    on(event: string, listener: (...args: unknown[]) => void): void {
      this.addListener(event, listener);
    }

    private addListener(event: string, listener: (...args: unknown[]) => void): void {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
    }

    private emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  return { BrowserWindow: FakeBrowserWindow };
});

import { renderPlainMessageDialogHtml, showPlainMessageDialog } from "@main/plain-message-dialog";

beforeEach(() => {
  electron.loadError = undefined;
  electron.executeResults = [];
  electron.windows = [];
});

describe("plain message dialog", () => {
  it("keeps header and footer fixed while only the body scrolls", () => {
    const html = renderPlainMessageDialogHtml({ title: "Title", message: "Message", detail: "Detail" });

    expect(html).toContain('id="dialog-header"');
    expect(html).toContain('id="dialog-body"');
    expect(html).toContain('id="dialog-footer"');
    expect(html).toContain(".body{min-height:0;overflow:auto");
    expect(html).toContain("body{margin:0;height:100vh;overflow:hidden}");
  });

  it("rejects and closes instead of hanging when the page cannot load", async () => {
    electron.loadError = new Error("load failed");

    await expect(showPlainMessageDialog({ title: "Title", message: "Message" })).rejects.toThrow("load failed");

    expect(electron.windows[0]?.show).not.toHaveBeenCalled();
    expect(electron.windows[0]?.close).toHaveBeenCalledOnce();
  });

  it("rejects and closes instead of leaving a hidden window when sizing fails", async () => {
    electron.executeResults = [new Error("measurement failed")];

    await expect(showPlainMessageDialog({ title: "Title", message: "Message" })).rejects.toThrow("measurement failed");

    expect(electron.windows[0]?.show).not.toHaveBeenCalled();
    expect(electron.windows[0]?.close).toHaveBeenCalledOnce();
  });

  it("keeps an already visible dialog usable when button focus fails", async () => {
    electron.executeResults = [220, new Error("focus failed")];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = showPlainMessageDialog({ title: "Title", message: "Message" });
    await vi.waitFor(() => expect(electron.windows[0]?.show).toHaveBeenCalledOnce());
    electron.windows[0]?.close();

    await expect(result).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "[fotoready] Could not focus the message dialog button:",
      expect.objectContaining({ message: "focus failed" }),
    );
    consoleError.mockRestore();
  });
});
