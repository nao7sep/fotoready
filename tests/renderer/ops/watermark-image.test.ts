// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { WatermarkSourceAction } from "@renderer/ops/watermark-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pickFile: vi.fn<(options: { title: string; extensions: string[] }) => Promise<string | null>>(),
  aspectRatio: vi.fn<(path: string) => Promise<number>>()
}));
vi.mock("@renderer/ipc/client", () => ({ api: { system: { pickFile: mocks.pickFile }, assets: { aspectRatio: mocks.aspectRatio } } }));

let root: Root;
const log = vi.fn(async () => undefined);

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  mocks.pickFile.mockReset();
  mocks.aspectRatio.mockReset().mockResolvedValue(2);
  log.mockClear();
  vi.stubGlobal("api", { system: { log } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("WatermarkSourceAction", () => {
  it("offers PNG, SVG and WebP files", async () => {
    mocks.pickFile.mockResolvedValue(null);
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
        onParamsChange: vi.fn(),
        params: {
          assetPath: "",
          x: 0,
          y: 0,
          width: 0.2,
          height: 0.2,
          lockAspectRatio: true,
          flipHorizontal: false,
          flipVertical: false,
          opacity: 1,
          rotation: 0
        }
      }));
    });

    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());

    expect(mocks.pickFile).toHaveBeenCalledWith(expect.objectContaining({ extensions: ["png", "svg", "webp"] }));
  });

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

  describe("while the chosen image's shape is read", () => {
    const params = (): AssetOverlayParams => ({
      assetPath: "/current/watermark.png", x: 0.1, y: 0.1, width: 0.2, height: 0.2, lockAspectRatio: true,
      flipHorizontal: false, flipVertical: false, opacity: 1, rotation: 0
    });
    const ctx = (activeTaskId: string) => ({
      activeTaskId, assetPickerPreviewLongEdge: 128, luts: [], opId: "op-1", stamps: [],
      originalMetadataSummary: null, originalSize: { width: 1000, height: 800 }
    });
    const render = (props: { activeTaskId: string; params: AssetOverlayParams; onParamsChange: () => void }) =>
      act(async () => {
        root.render(createElement(WatermarkSourceAction, { ctx: ctx(props.activeTaskId), disabled: false, onParamsChange: props.onParamsChange, params: props.params }));
      });

    it("applies the image only to the values it was made from, which the session checks", async () => {
      mocks.pickFile.mockResolvedValue("/new/logo.png");
      const onParamsChange = vi.fn();
      const current = params();
      await render({ activeTaskId: "task-1", params: current, onParamsChange });
      await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
      expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ assetPath: "/new/logo.png" }), { expectedParams: current });
    });

    it.each([
      ["another task becomes active", { activeTaskId: "task-2", params: params() }],
      ["the watermark is edited", { activeTaskId: "task-1", params: { ...params(), opacity: 0.5 } }],
    ])("changes nothing and asks to choose again when %s", async (_label, next) => {
      mocks.pickFile.mockResolvedValue("/new/logo.png");
      let finish!: (ratio: number) => void;
      mocks.aspectRatio.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const onParamsChange = vi.fn();
      await render({ activeTaskId: "task-1", params: params(), onParamsChange });
      await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
      await render({ ...next, onParamsChange });
      await act(async () => finish(2));
      expect(onParamsChange).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    });
  });
});
