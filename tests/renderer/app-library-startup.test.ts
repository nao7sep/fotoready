// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "@shared/types/settings";
import type { QueueSnapshot } from "@shared/types/ipc";
import { defaultGlobalSettings } from "@shared/defaults";
import { defaultUiState } from "@shared/validation/state";
import { message } from "@shared/i18n/translate";
import { ipcFailure } from "@shared/ipc-failure";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A LUT or stamp library folder naming an unset variable does not keep the main window from
// opening: that library lists as empty with a notice naming the variable, Settings opens, and
// saving a fixed folder loads the library and clears the notice.

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    observe(): void {}
    disconnect(): void {}
  }
});

const queue: QueueSnapshot = {
  saved: 0,
  total: 0,
  notSaved: 0,
  queued: 0,
  processing: 0,
  errors: 0,
  activeTaskId: null,
  activeTaskLabel: null
};

describe.each([
  { library: "luts", folderKey: "lutFolder", folderLabel: "Imported LUT folder", notice: "The LUT library could not be loaded", otherNotice: "The stamp library could not be loaded" },
  { library: "stamps", folderKey: "stampFolder", folderLabel: "Imported stamp folder", notice: "The stamp library could not be loaded", otherNotice: "The LUT library could not be loaded" }
] as const)("startup with the $library folder naming an unset variable", ({ library, folderKey, folderLabel, notice, otherNotice }) => {
  it("opens the main window with that library empty and a notice, and loads it once Settings fixes the folder", async () => {
    const stored: GlobalSettings = { ...defaultGlobalSettings(), [folderKey]: "$FOTOREADY_UNSET_LIBRARY/assets" };
    const unavailable = ipcFailure(message("failure.pathVariable", { variable: "FOTOREADY_UNSET_LIBRARY" }));
    // The preload rethrows a main-authored IpcFailure as the plain object it is.
    const failingList = vi.fn(async () => {
      if (stored[folderKey].includes("$FOTOREADY_UNSET_LIBRARY")) throw unavailable;
      return [];
    });
    const otherList = vi.fn(async () => []);
    const update = vi.fn(async (next: GlobalSettings) => {
      Object.assign(stored, next);
      return { ...stored };
    });
    mountApi({
      settings: { get: async () => ({ ...stored }), hasGeminiApiKey: async () => false, update },
      luts: { list: library === "luts" ? failingList : otherList },
      stamps: { list: library === "stamps" ? failingList : otherList }
    });

    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    await act(async () => {
      await import("@renderer/app");
    });

    await vi.waitFor(() => expect(document.querySelector(".app-shell")).not.toBeNull());
    const shellResults = (): string => document.querySelector(".app-shell-result-stack")?.textContent ?? "";
    expect(shellResults()).toContain(notice);
    expect(shellResults()).toContain("FOTOREADY_UNSET_LIBRARY");
    expect(shellResults()).not.toContain(otherNotice);
    expect(otherList).toHaveBeenCalledTimes(1);

    // Through the window's own menu: each case mounts a fresh app, and an earlier case's app still
    // listens for shortcuts on the window.
    const root = document.querySelector<HTMLElement>("#root")!;
    await act(async () => root.querySelector<HTMLButtonElement>('button[title="Menu"]')!.click());
    await act(async () => [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Settings")!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => buttonByText(dialog!, "Assets").click());
    const field = [...dialog!.querySelectorAll<HTMLElement>(".stacked-field")].find((candidate) => candidate.querySelector("label")?.textContent === folderLabel);
    await act(async () => buttonByText(field!, "Clear").click());
    await act(async () => dialog!.querySelector<HTMLButtonElement>("button.primary-action")!.click());

    await vi.waitFor(() => expect(failingList).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ [folderKey]: "" }));
    await vi.waitFor(() => expect(shellResults()).not.toContain(notice));
    await expect(failingList.mock.results[1]!.value).resolves.toEqual([]);
  });
});

function mountApi(overrides: Record<string, unknown>): void {
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      language: {
        current: () => Promise.resolve({ language: "en", locale: "en-US" }),
        onChanged: () => vi.fn()
      },
      system: {
        getInfo: () => Promise.resolve({
          appName: "FotoReady",
          version: "0.1.0",
          dataDir: "/fixtures/data",
          lutsDir: "/fixtures/luts",
          stampsDir: "/fixtures/stamps",
          cpuCount: 8,
          platform: "darwin"
        }),
        log: vi.fn().mockResolvedValue(undefined)
      },
      state: { get: () => Promise.resolve(defaultUiState()) },
      project: { current: () => Promise.resolve({ project: { outputDir: null, originals: [], tasks: [] }, activeTaskId: null, privacyWarnings: {} }) },
      ops: { list: () => Promise.resolve([]) },
      queues: { snapshot: () => Promise.resolve(queue) },
      events: {
        onProjectSnapshot: () => vi.fn(),
        onQueueSnapshot: () => vi.fn()
      },
      lifecycle: {
        onCloseRequest: () => vi.fn(),
        onWindowActivityChanged: () => vi.fn()
      },
      ...overrides
    }
  });
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`No button labelled ${label}`);
  return button;
}
