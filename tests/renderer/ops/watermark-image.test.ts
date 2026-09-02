// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { WatermarkSourceAction } from "@renderer/ops/watermark-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ pickFile: vi.fn<() => Promise<string | null>>() }));
vi.mock("@renderer/ipc/client", () => ({ api: { system: { pickFile: mocks.pickFile } } }));

let root: Root;
const log = vi.fn(async () => undefined);

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  mocks.pickFile.mockReset();
  log.mockClear();
  vi.stubGlobal("api", { system: { log } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("WatermarkSourceAction", () => {
  it("owns picker rejection without exposing bridge diagnostics or changing params", async () => {
    mocks.pickFile.mockRejectedValue(new Error(
      "Error invoking remote method: EACCES /private/tmp/FOTOREADY_WATERMARK_SENTINEL"
    ));
    const onParamsChange = vi.fn();
    const params: AssetOverlayParams = {
      assetPath: "/current/watermark.png",
      x: 0,
      y: 0,
      width: 0.2,
      height: 0.2,
      lockAspectRatio: true,
      flipHorizontal: false,
      flipVertical: false,
      opacity: 1,
      rotation: 0
    };
    await act(async () => {
      root.render(createElement(WatermarkSourceAction, {
        ctx: {
          activeTaskId: "task-1",
          assetPickerPreviewLongEdge: 128,
          luts: [],
          opId: "op-1",
          stamps: [],
          originalMetadataSummary: null,
          originalSize: { width: 1000, height: 800 }
        },
        disabled: false,
        onParamsChange,
        params
      }));
    });

    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());

    const result = document.querySelector('[role="alert"]');
    expect(onParamsChange).not.toHaveBeenCalled();
    expect(result?.textContent).toContain("The current watermark is unchanged");
    expect(result?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_WATERMARK_SENTINEL|invoking remote method/i);
    expect(result?.querySelectorAll("svg")).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: "watermark file picker failed" }));

    mocks.pickFile.mockResolvedValue(null);
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The current watermark is unchanged");
  });
});
