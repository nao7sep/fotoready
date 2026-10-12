// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { QueueSnapshot } from "@shared/types/ipc";
import { defaultGlobalSettings } from "@shared/defaults";
import { defaultUiState } from "@shared/validation/state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The two values the main window may cut short, the output folder in the top bar and the running
// task in the status bar, each lead to their complete value by click or keyboard, not only by a hover
// tooltip (text-cleanup-conventions, rule 4).

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class {
    observe(): void {}
    disconnect(): void {}
  }
});

// Each test mounts the whole app from a fresh module graph, which takes seconds on a loaded machine.
const MOUNT_TIMEOUT_MS = 30_000;

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
  }, MOUNT_TIMEOUT_MS);

  it("selects the running task from the status bar", async () => {
    const select = vi.fn(async () => snapshot());
    await mountApp({ select });

    const label = document.querySelector<HTMLButtonElement>("button.status-active-label");
    expect(label?.textContent).toBe(queue.activeTaskLabel);
    await act(async () => label!.click());
    expect(select).toHaveBeenCalledWith("task-1");
  }, MOUNT_TIMEOUT_MS);
});

function shellResults(): string {
  return document.querySelector(".app-shell-result-stack")?.textContent ?? "";
}

function snapshot(): unknown {
  return { project: { outputDir: OUTPUT_DIR, originals: [], tasks: [] }, activeTaskId: null, privacyWarnings: {} };
}

async function mountApp({ revealInFolder = vi.fn(), select = vi.fn(async () => snapshot()) }: {
  revealInFolder?: (path: string) => Promise<void>;
  select?: (taskId: string) => Promise<unknown>;
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
      project: { current: () => Promise.resolve(snapshot()) },
      task: { select },
      ops: { list: () => Promise.resolve([]) },
      queues: { snapshot: () => Promise.resolve(queue) },
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
