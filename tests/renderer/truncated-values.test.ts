// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { QueueSnapshot } from "@shared/types/ipc";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
import { defaultUiState } from "@shared/validation/state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Values the main window may cut short lead to their complete value by click or keyboard, not only
// by a hover tooltip (interface-styling-conventions, Labels): the output folder and the selected
// photo reveal themselves in Finder or Explorer, and the running task selects itself.

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    observe(): void {}
    disconnect(): void {}
  }
});

const OUTPUT_DIR = "/fixtures/output/a folder whose path is longer than the top bar can show";

const queue: QueueSnapshot = {
  saved: 0,
  total: 1,
  notSaved: 0,
  queued: 0,
  processing: 1,
  errors: 0,
  activeTaskId: "task-1",
  activeTaskLabel: "IMG_0001-with-a-long-name.jpg"
};

describe("values cut short in the main window", () => {
  it("reveals the output folder from its badge and reports a folder that cannot be shown", async () => {
    const revealInFolder = vi.fn().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValue(undefined);
    await mountApp({ revealInFolder });

    const badge = document.querySelector<HTMLButtonElement>("button.output-badge-label");
    expect(badge?.textContent).toContain(OUTPUT_DIR);
    await act(async () => badge!.click());
    expect(revealInFolder).toHaveBeenCalledWith(OUTPUT_DIR);
    await vi.waitFor(() => expect(shellResults()).toContain("The output folder could not be shown"));

    await act(async () => badge!.click());
    expect(revealInFolder).toHaveBeenCalledTimes(2);
  });

  it("keeps the output folder's last segment whole and shortens the folders before it", async () => {
    await mountApp({});
    const badge = document.querySelector("button.output-badge-label")!;
    expect(badge.querySelector(".path-tail")?.textContent).toBe("a folder whose path is longer than the top bar can show");
    expect(badge.querySelector(".path-head")?.textContent).toBe("/fixtures/output/");
  });

  it("reveals the selected photo from its shortened name in the preview toolbar, keeping the task state apart", async () => {
    const revealInFolder = vi.fn().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValue(undefined);
    await mountApp({ revealInFolder, withPhoto: true });

    const name = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("button.preview-name");
      expect(button).not.toBeNull();
      return button!;
    });
    expect(name.textContent).toBe(PHOTO_NAME);
    expect(document.querySelector(".preview-state")?.textContent).toBe("Not saved");
    await act(async () => name.click());
    expect(revealInFolder).toHaveBeenCalledWith(`/fixtures/originals/${PHOTO_NAME}`);
    await vi.waitFor(() => expect(document.querySelector(".editor-panel")?.textContent).toContain("The file could not be shown"));
  });

  it("selects the running task from the status bar", async () => {
    const select = vi.fn(async () => snapshot());
    await mountApp({ select });

    const label = document.querySelector<HTMLButtonElement>("button.status-active-label");
    expect(label?.textContent).toBe(queue.activeTaskLabel);
    await act(async () => label!.click());
    expect(select).toHaveBeenCalledWith("task-1");
  });
});

function shellResults(): string {
  return document.querySelector(".app-shell-result-stack")?.textContent ?? "";
}

const PHOTO_NAME = "harbor-at-dusk-with-fishing-boats-and-the-old-lighthouse-DSC04412.jpg";

function snapshot(withPhoto = false): unknown {
  if (!withPhoto) return { project: { outputDir: OUTPUT_DIR, originals: [], tasks: [] }, activeTaskId: null, privacyWarnings: {} };
  const original = {
    id: "original-1", sourcePath: `/fixtures/originals/${PHOTO_NAME}`, sourceHash: "hash", size: 1024, format: "jpeg",
    jpegQualityEstimate: null, metadataSummary: { editorial: {}, dates: {}, gps: {} }, width: 1600, height: 1067, addedAt: "2026-10-06T00:00:00.000Z"
  };
  const task = {
    id: "task-1", originalId: "original-1", generateDescription: false, generateSlug: false, customSlug: null, visionRunning: false,
    visionRunMode: null, pipeline: defaultPipeline(), status: "not-saved", output: null, error: null, everEdited: false,
    createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z"
  };
  return { project: { outputDir: OUTPUT_DIR, originals: [original], tasks: [task] }, activeTaskId: "task-1", privacyWarnings: {} };
}

async function mountApp({ revealInFolder = vi.fn(), select = vi.fn(async () => snapshot()), withPhoto = false }: {
  revealInFolder?: (path: string) => Promise<void>;
  select?: (taskId: string) => Promise<unknown>;
  withPhoto?: boolean;
}): Promise<void> {
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
        log: vi.fn().mockResolvedValue(undefined),
        revealInFolder
      },
      settings: { get: async () => defaultGlobalSettings(), hasGeminiApiKey: async () => false },
      luts: { list: async () => [] },
      stamps: { list: async () => [] },
      state: { get: () => Promise.resolve(defaultUiState()) },
      project: { current: () => Promise.resolve(snapshot(withPhoto)) },
      preview: { render: () => new Promise(() => {}), originalThumbnail: () => new Promise(() => {}) },
      task: { select },
      ops: { list: () => Promise.resolve([]) },
      queues: { snapshot: () => Promise.resolve(withPhoto ? { ...queue, processing: 0, notSaved: 1, activeTaskId: null, activeTaskLabel: null } : queue) },
      events: {
        onProjectSnapshot: () => vi.fn(),
        onQueueSnapshot: () => vi.fn()
      },
      lifecycle: {
        onCloseRequest: () => vi.fn(),
        onWindowActivityChanged: () => vi.fn()
      }
    }
  });
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await act(async () => {
    await import("@renderer/app");
  });
  await vi.waitFor(() => expect(document.querySelector("button.output-badge-label")).not.toBeNull());
}
