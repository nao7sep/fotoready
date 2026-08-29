// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OriginalImportResult, QueueSnapshot } from "@shared/types/ipc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("FotoReady app file receiver", () => {
  it("routes the shipped Originals receiver through the project import authority", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe(): void {}
        disconnect(): void {}
      }
    });

    const accessible = new File(["image"], "photo.jpg", { type: "image/jpeg" });
    const inaccessible = new File(["sidecar"], "private.fotoready.json", {
      type: "application/json"
    });
    const filePathForFile = vi.fn((file: File) => {
      if (file === accessible) return "/fixtures/photo.jpg";
      throw new Error("No local path is available");
    });
    const snapshot = {
      project: { outputDir: null, originals: [], tasks: [] },
      activeTaskId: null,
      privacyWarnings: {}
    };
    const importResult: OriginalImportResult = {
      snapshot,
      canceled: false,
      acceptedImages: 1,
      addedOriginals: 1,
      restoredTasks: 0,
      succeededPaths: ["/fixtures/photo.jpg"],
      issues: []
    };
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
    const never = new Promise<never>(() => {});
    const addOriginals = vi.fn().mockResolvedValue(importResult);
    const queueSnapshot = vi.fn()
      .mockReturnValueOnce(never)
      .mockResolvedValue(queue);
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        system: {
          getInfo: () => never,
          filePathForFile,
          log: vi.fn().mockResolvedValue(undefined)
        },
        settings: {
          get: () => never,
          hasGeminiApiKey: () => never
        },
        state: { get: () => never },
        project: {
          current: () => never,
          addOriginals
        },
        ops: { list: () => never },
        queues: { snapshot: queueSnapshot },
        luts: { list: () => never },
        stamps: { list: () => never },
        events: {
          onProjectSnapshot: () => vi.fn(),
          onQueueSnapshot: () => vi.fn()
        },
        lifecycle: { onCloseRequest: () => vi.fn() }
      }
    });

    await act(async () => {
      await import("@renderer/app");
    });

    const receiver = document.querySelector<HTMLElement>(".originals-receiver");
    expect(receiver).not.toBeNull();
    const delivery = {
      types: ["Files"],
      items: [{ kind: "file" }],
      files: [accessible, inaccessible],
      dropEffect: "none"
    } as unknown as DataTransfer;

    act(() => receiver!.dispatchEvent(dragEvent("dragenter", delivery)));
    expect(receiver!.classList.contains("is-delivery-candidate")).toBe(true);
    act(() => receiver!.dispatchEvent(dragEvent("dragleave", delivery)));
    expect(receiver!.classList.contains("is-delivery-candidate")).toBe(false);

    act(() => receiver!.dispatchEvent(dragEvent("dragenter", delivery)));
    const drop = dragEvent("drop", delivery);
    await act(async () => {
      receiver!.dispatchEvent(drop);
      await vi.waitFor(() => expect(addOriginals).toHaveBeenCalledTimes(1));
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(receiver!.classList.contains("is-delivery-candidate")).toBe(false);
    expect(filePathForFile).toHaveBeenCalledTimes(2);
    expect(addOriginals).toHaveBeenCalledWith(["/fixtures/photo.jpg"]);
    expect(document.body.textContent).toContain("private.fotoready.json");
  });
});

function dragEvent(type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}
