// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import { defaultUiState } from "@shared/validation/state";
import type { ProjectSnapshot, QueueSnapshot } from "@shared/types/ipc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted = vi.hoisted(() => ({ root: null as Root | null }));
vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return { ...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    mounted.root = actual.createRoot(...args);
    return mounted.root;
  } };
});
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class { observe(): void {} disconnect(): void {} }
});
afterEach(async () => { await act(async () => mounted.root?.unmount()); });

it("keeps finished project and queue broadcasts while startup libraries are still loading", async () => {
  let finishLibrary!: (value: []) => void;
  const heldLibrary = new Promise<[]>((resolve) => { finishLibrary = resolve; });
  let onProject!: (snapshot: ProjectSnapshot) => void;
  let onQueue!: (snapshot: QueueSnapshot) => void;
  const time = "2026-10-01T00:00:00.000Z";
  const early: ProjectSnapshot = {
    project: { outputDir: null, originals: [{ id: "original-1", sourcePath: "/fixtures/photo.jpg", sourceHash: "source",
      size: 100, format: "jpeg", jpegQualityEstimate: null, metadataSummary: { editorial: {}, dates: {}, gps: {} },
      width: 100, height: 80, addedAt: time }], tasks: [{ id: "task-1", originalId: "original-1",
      generateDescription: false, generateSlug: false, customSlug: null, visionRunning: false, visionRunMode: null,
      pipeline: defaultPipeline(), status: "processing", output: null, error: null, everEdited: true, createdAt: time, updatedAt: time }] },
    activeTaskId: null, privacyWarnings: {}
  };
  const finished = structuredClone(early);
  finished.project.tasks[0]!.status = "saved";
  finished.project.tasks[0]!.output = { stagedPath: "/fixtures/photo-fotoready.jpg", stagedParamsPath: "/fixtures/photo-fotoready.json",
    stagedAt: time, outputHash: "output", vision: null, finalPath: null, finalParamsPath: null, renamedAt: null };
  const earlyQueue: QueueSnapshot = { saved: 0, total: 1, notSaved: 0, queued: 0, processing: 1, errors: 0,
    activeTaskId: "task-1", activeTaskLabel: "photo.jpg" };
  const finishedQueue: QueueSnapshot = { ...earlyQueue, saved: 1, processing: 0, activeTaskId: null, activeTaskLabel: null };
  Object.defineProperty(window, "api", { configurable: true, value: {
    language: { current: async () => ({ language: "en", locale: "en-US" }), onChanged: () => () => {} },
    system: { getInfo: async () => ({ appName: "FotoReady", version: "0.1.0", dataDir: "/fixtures/data",
      lutsDir: "/fixtures/luts", stampsDir: "/fixtures/stamps", cpuCount: 8, platform: "darwin" }), log: vi.fn().mockResolvedValue(undefined) },
    settings: { get: async () => defaultGlobalSettings(), hasGeminiApiKey: async () => false },
    state: { get: async () => defaultUiState(), toggleHistogram: async () => ({ ...defaultUiState(), showHistogram: true }) }, project: { current: async () => structuredClone(early) },
    ops: { list: async () => [] }, queues: { snapshot: async () => earlyQueue },
    luts: { list: () => heldLibrary }, stamps: { list: async () => [] },
    preview: { originalThumbnail: async () => ({ dataUrl: "data:image/png;base64,", width: 100, height: 80 }) },
    events: { onOriginalImportActivity: () => () => {}, onProjectSnapshot: (callback: typeof onProject) => { onProject = callback; return () => {}; },
      onQueueSnapshot: (callback: typeof onQueue) => { onQueue = callback; return () => {}; } },
    lifecycle: { onCloseRequest: () => () => {}, onWindowActivityChanged: () => () => {} }
  } });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import("@renderer/app"); });
  await vi.waitFor(() => expect(onProject).toBeTypeOf("function"));
  const { useEditorStore } = await import("@renderer/state/editor-store");
  await act(async () => { onProject(finished); onQueue(finishedQueue); });
  expect(useEditorStore.getState().projectSnapshot?.project.tasks[0]?.status).toBe("saved");
  await act(async () => { finishLibrary([]); });
  await vi.waitFor(() => expect(document.querySelector(".app-shell")).not.toBeNull());
  expect(useEditorStore.getState().projectSnapshot?.project.tasks[0]?.status).toBe("saved");
  expect(document.querySelector(".status-bar")?.textContent).toContain("1/1 saved");
  expect(document.querySelector(".status-bar .status-chip-active")).toBeNull();
});
