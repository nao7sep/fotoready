import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  dark: false,
  loadError: undefined as unknown,
  executeResults: [] as Array<number | Error>,
  windows: [] as Array<{ close: () => void; show: ReturnType<typeof vi.fn>; options: { backgroundColor?: string } }>,
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

    constructor(readonly options: { backgroundColor?: string }) {
      electron.windows.push(this);
    }

    isDestroyed(): boolean { return this.destroyed; }

    emitContents(event: string, ...args: unknown[]): void {
      this.emit(event, ...args);
    }

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

  return {
    BrowserWindow: FakeBrowserWindow,
    nativeTheme: { get shouldUseDarkColors() { return electron.dark; } },
  };
});

import { cancelOpenMessageDialogs, renderPlainMessageDialogHtml, showPlainMessageDialog } from "@main/plain-message-dialog";

beforeEach(() => {
  electron.dark = false;
  electron.loadError = undefined;
  electron.executeResults = [];
  electron.windows = [];
});

// The page's own words come from the caller, already in the interface language.
const words = { buttons: ["OK"], detailsLabel: "Message details", lang: "en" };

describe("plain message dialog", () => {
  it("renders distinct header, body, and footer regions", () => {
    const html = renderPlainMessageDialogHtml({ title: "Title", message: "Message", detail: "Detail", ...words });

    expect(html).toContain('id="dialog-header"');
    expect(html).toContain('id="dialog-body"');
    expect(html).toContain('id="dialog-footer"');
    expect(html).toContain('role="region" aria-label="Message details" tabindex="0"');
    expect(html).toContain("*::-webkit-scrollbar{width:16px;height:16px}");
  });

  it("speaks the language it is given, in its button, region name and document language", () => {
    const html = renderPlainMessageDialogHtml({
      title: "Titel",
      message: "Nachricht",
      buttons: ["OK <sofort>"],
      detailsLabel: "Details der Meldung",
      lang: "de",
    });

    expect(html).toContain('<html lang="de">');
    expect(html).toContain('aria-label="Details der Meldung"');
    expect(html).toContain(">OK &lt;sofort&gt;</button>");
  });

  it("draws each button with its role, and wraps the row instead of clipping it", () => {
    const html = renderPlainMessageDialogHtml({
      title: "Title",
      message: "Message",
      buttons: ["Cancel", "Retry", "Quit anyway"],
      defaultId: 1,
      cancelId: 0,
      destructiveId: 2,
      detailsLabel: "Message details",
      lang: "en",
    });

    expect(html).toContain('<button id="choice-0" class="button" type="button"');
    expect(html).toContain('<button id="choice-1" class="button primary" type="button"');
    expect(html).toContain('<button id="choice-2" class="button destructive" type="button"');
    expect(html).toContain(".actions{display:flex;flex-wrap:wrap;");
  });

  it("answers with the button chosen, and with the cancel choice on Escape or an ending session", async () => {
    const options = { title: "Title", message: "Message", buttons: ["Cancel", "Retry"], defaultId: 1, cancelId: 0, detailsLabel: "Message details", lang: "en" };

    const chosen = showPlainMessageDialog(options);
    await vi.waitFor(() => expect(electron.windows[0]?.show).toHaveBeenCalledOnce());
    navigate(0, "https://fotoready-dialog.invalid/choice/1");
    await expect(chosen).resolves.toBe(1);

    const escaped = showPlainMessageDialog(options);
    await vi.waitFor(() => expect(electron.windows[1]?.show).toHaveBeenCalledOnce());
    pressEscape(1);
    await expect(escaped).resolves.toBe(0);

    const ended = showPlainMessageDialog(options);
    await vi.waitFor(() => expect(electron.windows[2]?.show).toHaveBeenCalledOnce());
    cancelOpenMessageDialogs();
    await expect(ended).resolves.toBe(0);
    expect(electron.windows[2]?.close).toHaveBeenCalled();
  });

  it("follows the resolved theme in its page and its window background", async () => {
    const html = renderPlainMessageDialogHtml({ title: "Title", message: "Message", ...words });
    expect(html).toContain("@media (prefers-color-scheme:dark){:root{color-scheme:dark;background:#161616");

    electron.dark = true;
    const result = showPlainMessageDialog({ title: "Title", message: "Message", ...words });
    await vi.waitFor(() => expect(electron.windows[0]?.show).toHaveBeenCalledOnce());
    expect(electron.windows[0]?.options.backgroundColor).toBe("#161616");
    electron.windows[0]?.close();
    await result;
  });

  it("rejects and closes instead of hanging when the page cannot load", async () => {
    electron.loadError = new Error("load failed");

    await expect(showPlainMessageDialog({ title: "Title", message: "Message", ...words })).rejects.toThrow("load failed");

    expect(electron.windows[0]?.show).not.toHaveBeenCalled();
    expect(electron.windows[0]?.close).toHaveBeenCalledOnce();
  });

  it("rejects and closes instead of leaving a hidden window when sizing fails", async () => {
    electron.executeResults = [new Error("measurement failed")];

    await expect(showPlainMessageDialog({ title: "Title", message: "Message", ...words })).rejects.toThrow("measurement failed");

    expect(electron.windows[0]?.show).not.toHaveBeenCalled();
    expect(electron.windows[0]?.close).toHaveBeenCalledOnce();
  });

  it("keeps an already visible dialog usable when button focus fails", async () => {
    electron.executeResults = [220, new Error("focus failed")];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = showPlainMessageDialog({ title: "Title", message: "Message", ...words });
    await vi.waitFor(() => expect(electron.windows[0]?.show).toHaveBeenCalledOnce());
    electron.windows[0]?.close();

    await expect(result).resolves.toBe(0);
    expect(consoleError).toHaveBeenCalledWith(
      "[fotoready] Could not focus the message dialog button:",
      expect.objectContaining({ message: "focus failed" }),
    );
    consoleError.mockRestore();
  });
});

function navigate(index: number, url: string): void {
  const event = { preventDefault: vi.fn() };
  (electron.windows[index] as unknown as { emitContents(name: string, ...args: unknown[]): void }).emitContents("will-navigate", event, url);
}

function pressEscape(index: number): void {
  (electron.windows[index] as unknown as { emitContents(name: string, ...args: unknown[]): void }).emitContents("before-input-event", { preventDefault() {} }, { key: "Escape" });
}
