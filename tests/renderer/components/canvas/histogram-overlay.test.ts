// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistogramOverlay } from "@renderer/components/canvas/histogram-overlay";
import { whenDocument } from "../../../helpers/document-change";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HistogramOverlay results", () => {
  it("leaves the canvas as the sole live owner of a preview render failure", async () => {
    await renderHistogram(null, "error");

    expect(document.body.textContent).toContain("Preview failed");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("announces its own decode failure and offers a retry", async () => {
    let imageCount = 0;
    let loaded: (() => void) | null = null;
    class FailingImage {
      onerror: ((event: Event) => unknown) | null = null;
      onload: ((event: Event) => unknown) | null = null;

      set src(_value: string) {
        imageCount += 1;
        loaded?.();
        queueMicrotask(() => this.onerror?.(new Event("error")));
      }
    }
    vi.stubGlobal("Image", FailingImage as unknown as typeof Image);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderHistogram({ dataUrl: "data:broken", width: 10, height: 10 }, "idle");

    await whenDocument(() => document.querySelector('[role="alert"]') !== null);
    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toContain("Histogram failed");
    expect(error?.textContent).not.toContain("Error:");
    expect(error?.querySelector("svg")).toBeNull();
    expect(error?.closest(".histogram-overlay")?.classList.contains("has-error")).toBe(true);

    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Retry");
    expect(retry).toBeDefined();
    const reloaded = new Promise<void>((resolve) => { loaded = resolve; });
    await act(async () => retry!.click());
    await reloaded;
    expect(imageCount).toBe(2);
  });

  it("does not make preview progress assertive", async () => {
    await renderHistogram(null, "loading");

    expect(document.body.textContent).toContain("Rendering");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

async function renderHistogram(
  preview: { dataUrl: string; width: number; height: number } | null,
  previewState: "idle" | "loading" | "error"
): Promise<void> {
  await act(async () => {
    root.render(createElement(HistogramOverlay, {
      onClose: () => undefined,
      onPositionChange: () => undefined,
      position: null,
      preview,
      previewState
    }));
  });
}
