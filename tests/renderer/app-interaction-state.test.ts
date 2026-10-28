// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import { defaultUiState } from "@shared/validation/state";
import type { ProjectSnapshot } from "@shared/types/ipc";
import type { UiState } from "@shared/types/state";
import { whenDocument } from "../helpers/document-change";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted = vi.hoisted(() => ({ roots: [] as Root[] }));
vi.mock("react-dom/client", async (load) => {
  const actual = await load<typeof import("react-dom/client")>();
  return { ...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    const root = actual.createRoot(...args);
    mounted.roots.push(root);
    return root;
  } };
});

afterEach(async () => {
  await act(async () => { for (const root of mounted.roots.splice(0)) root.unmount(); });
  vi.unstubAllGlobals();
});

async function mount() {
  const snapshot: ProjectSnapshot = {
    project: {
      outputDir: null,
      originals: [{
        id: "original-1", sourcePath: "/fixtures/photo.jpg", sourceHash: "source", size: 100,
        format: "jpeg", jpegQualityEstimate: null, metadataSummary: { editorial: {}, dates: {}, gps: {} },
        width: 100, height: 80, addedAt: "2026-10-01T00:00:00.000Z"
      }],
      tasks: []
    },
    activeTaskId: null,
    privacyWarnings: {}
  };
  let importActivity!: (pending: number) => void;
  let onProject!: (value: ProjectSnapshot) => void;
  let onQueue!: (value: unknown) => void;
  const selectOriginal = vi.fn(async () => {});
  const addOriginalsFromDialog = vi.fn(async () => ({
    canceled: true, acceptedImages: 0, addedOriginals: 0, restoredTasks: 0, succeededPaths: [], issues: []
  }));
  const toggleHistogram = vi.fn<() => Promise<UiState>>();
  const updateState = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  Object.defineProperty(window, "api", { configurable: true, value: {
    language: { current: async () => ({ language: "en", locale: "en-US" }), onChanged: () => () => {} },
    system: {
      getInfo: async () => ({ appName: "FotoReady", version: "0.1.0", cpuCount: 8, platform: "darwin" }),
      log: vi.fn(async () => {})
    },
    settings: { get: async () => defaultGlobalSettings(), hasGeminiApiKey: async () => false },
    state: { get: async () => defaultUiState(), toggleHistogram, update: updateState },
    project: {
      subscribe: async () => {
        onProject(snapshot);
        onQueue({ saved: 0, total: 0, notSaved: 0, queued: 0, processing: 0, errors: 0, activeTaskId: null, activeTaskLabel: null });
      },
      selectOriginal, addOriginalsFromDialog
    },
    ops: { list: async () => [] }, luts: { list: async () => [] }, stamps: { list: async () => [] },
    preview: { originalThumbnail: async () => ({ originalId: "original-1", dataUrl: "data:image/png;base64,", width: 100, height: 80 }) },
    events: {
      onProjectSnapshot: (callback: typeof onProject) => { onProject = callback; return () => {}; },
      onQueueSnapshot: (callback: typeof onQueue) => { onQueue = callback; return () => {}; },
      onOriginalImportActivity: (callback: typeof importActivity) => { importActivity = callback; return () => {}; }
    },
    lifecycle: { onCloseRequest: () => () => {}, onWindowActivityChanged: () => () => {} }
  } });
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await act(async () => { await import("@renderer/app"); });
  await whenDocument(() => document.querySelector(".app-shell") !== null);
  return { importActivity, selectOriginal, addOriginalsFromDialog, toggleHistogram, updateState };
}

it("keeps Originals and Add usable during overlapping import activity until the pending count reaches zero", async () => {
  const api = await mount();
  const status = () => document.querySelector('.originals-panel [role="status"]');
  expect(status()).toBeNull();
  await act(async () => api.importActivity(2));
  expect(status()?.textContent).toBe("Importing… 2");

  const original = document.querySelector<HTMLButtonElement>(".originals-panel .row-main-action")!;
  const add = document.querySelector<HTMLButtonElement>(".originals-panel .panel-footer button")!;
  expect(original.disabled).toBe(false);
  expect(add.disabled).toBe(false);
  await act(async () => original.click());
  expect(api.selectOriginal).toHaveBeenCalledExactlyOnceWith("original-1");
  await act(async () => add.click());
  expect(api.addOriginalsFromDialog).toHaveBeenCalledOnce();
  expect(status()?.textContent).toBe("Importing… 2");

  for (const pending of [1234, 5, 3, 1]) {
    await act(async () => api.importActivity(pending));
    expect(status()?.textContent).toBe(`Importing… ${new Intl.NumberFormat("en-US").format(pending)}`);
    expect(document.querySelector(".originals-panel .row-main-action")).not.toBeNull();
    expect(add.disabled).toBe(false);
  }
  await act(async () => api.importActivity(0));
  expect(status()).toBeNull();
});

it("sends each overlapping histogram intent to the atomic toggle API and displays its returned state", async () => {
  const api = await mount();
  let first!: (state: UiState) => void;
  let second!: (state: UiState) => void;
  api.toggleHistogram.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
  api.toggleHistogram.mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
  const button = document.querySelector<HTMLButtonElement>('button[title^="Toggle histogram"]')!;
  await act(async () => {
    button.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", metaKey: true, bubbles: true }));
  });
  expect(api.toggleHistogram.mock.calls).toEqual([[], []]);
  expect(api.updateState).not.toHaveBeenCalled();
  expect(document.querySelector(".histogram-overlay")).toBeNull();
  await act(async () => first({ ...defaultUiState(), showHistogram: true }));
  expect(document.querySelector(".histogram-overlay")).not.toBeNull();
  expect(button.classList.contains("active")).toBe(true);
  await act(async () => second({ ...defaultUiState(), showHistogram: false }));
  expect(document.querySelector(".histogram-overlay")).toBeNull();
  expect(button.classList.contains("active")).toBe(false);
});
