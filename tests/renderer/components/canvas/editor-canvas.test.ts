// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorCanvas } from "@renderer/components/canvas/editor-canvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    disconnect(): void {}
  });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("EditorCanvas preview results", () => {
  it("announces a render failure at the canvas with retry recovery", async () => {
    const onRetryPreview = vi.fn();
    await renderCanvas("error", onRetryPreview);

    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toContain("Error: Preview failed");
    expect(error?.getAttribute("aria-atomic")).toBe("true");
    expect(error?.querySelector("svg")).not.toBeNull();

    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Retry");
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(onRetryPreview).toHaveBeenCalledOnce();
  });

  it("does not make preview progress assertive", async () => {
    await renderCanvas("loading", vi.fn());

    expect(document.body.textContent).toContain("Rendering preview");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

async function renderCanvas(previewState: "idle" | "loading" | "error", onRetryPreview: () => void): Promise<void> {
  await act(async () => {
    root.render(createElement(EditorCanvas, {
      fallbackLabel: "No preview",
      onOpParamsChange: () => undefined,
      onRetryPreview,
      originalAspectRatio: null,
      preview: null,
      previewScaleMode: "fit",
      previewState,
      selectedOpId: null,
      task: null
    }));
  });
}
