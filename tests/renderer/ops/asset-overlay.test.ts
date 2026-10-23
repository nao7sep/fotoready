// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath, useLocalAssetAspectRatio } from "@renderer/ops/_asset-overlay";
import type { OpCardContext } from "@renderer/ops/op-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ aspectRatio: vi.fn<() => Promise<number>>(), overlayRect: vi.fn((_props: Record<string, unknown>) => null) }));
vi.mock("@renderer/components/canvas/interactive-overlays", () => ({ InteractiveOverlayRect: mocks.overlayRect }));
vi.mock("@renderer/ipc/client", () => ({ api: { assets: { aspectRatio: mocks.aspectRatio } } }));

const log = vi.fn(async () => undefined);
let root: Root | null = null;

beforeEach(() => {
  mocks.aspectRatio.mockReset();
  mocks.overlayRect.mockClear();
  log.mockClear();
  vi.stubGlobal("api", { system: { log } });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("mounted asset aspect controls", () => {
  const renderer = createAssetOverlayRenderer({ color: "blue",
    renderSourceField: () => null,
    renderSourceAction: (props) => createElement("button", { onClick: () => void props.onParamsChange({ assetPath: props.params.assetPath }) }, "Select source")
  });
  const ctx: OpCardContext = { activeTaskId: "task", assetPickerPreviewLongEdge: 160, luts: [], stamps: [], opId: "stamp",
    originalMetadataSummary: null, originalSize: { width: 1000, height: 800 } };

  it("uses refreshed library geometry and rejects the earlier held ratio", async () => {
    let finishOld!: (ratio: number) => void;
    mocks.aspectRatio.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    mocks.aspectRatio.mockResolvedValue(0.5);
    const onParamsChange = vi.fn();
    await mount(ctx, onParamsChange);
    await act(async () => render({ ...ctx, stamps: [...ctx.stamps] }, onParamsChange));
    expect(mocks.aspectRatio).toHaveBeenCalledTimes(2);
    await act(async () => finishOld(2));
    await act(async () => document.querySelector<HTMLInputElement>(".toggle-row input")!.click());
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ width: 0.2, height: 0.4 }));
  });

  it("refreshes accepted same-path source selection without rereading for geometry controls", async () => {
    mocks.aspectRatio.mockResolvedValueOnce(2).mockResolvedValue(0.5);
    const onParamsChange = vi.fn();
    await mount(ctx, onParamsChange);
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(mocks.aspectRatio).toHaveBeenCalledTimes(2);
    onParamsChange.mockClear();
    await act(async () => document.querySelector<HTMLInputElement>(".toggle-row input")!.click());
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ width: 0.2, height: 0.4 }));
    expect(mocks.aspectRatio).toHaveBeenCalledTimes(2);
  });

  it("disables locked resizing after failure while position and rotation preserve the existing dimensions", async () => {
    mocks.aspectRatio.mockRejectedValue(new Error("Unreadable asset"));
    const onParamsChange = vi.fn();
    await mount(ctx, onParamsChange, true);
    const rangeFor = (label: string) => [...document.querySelectorAll<HTMLLabelElement>("label")]
      .find((element) => element.querySelector("span")?.textContent === label)!.querySelector<HTMLInputElement>("input")!;
    expect(rangeFor("Width").disabled).toBe(true);
    expect(rangeFor("Height").disabled).toBe(true);
    const x = rangeFor("X");
    expect(x.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(x, "10");
      x.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onParamsChange).toHaveBeenLastCalledWith(expect.objectContaining({ width: 0.2, height: 0.1, rotation: 0 }));
    const angle = rangeFor("Angle");
    expect(angle.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(angle, "45");
      angle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onParamsChange).toHaveBeenLastCalledWith(expect.objectContaining({ width: 0.2, height: 0.1, rotation: 45 }));
  });

  it("disables canvas resizing for unknown locked aspect while retaining position and rotation edits", async () => {
    mocks.aspectRatio.mockRejectedValue(new Error("Unreadable asset"));
    const onParamsChange = vi.fn();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root!.render(createElement(renderer.Overlay!, {
      params: overlayParams(), opId: "stamp", editable: true, onParamsChange,
      ctx: { imageSize: { width: 1000, height: 800 }, longEdge: 1000,
        imageBounds: { maxX: 1, maxY: 0.8 }, placement: { x: 0, y: 0, width: 1000, height: 800, scale: 1 },
        stageSize: { width: 1000, height: 800 }, originalAspectRatio: 1.25, samplePixel: () => null }
    })));
    const props = mocks.overlayRect.mock.lastCall![0];
    expect(props).toMatchObject({ resizeEnabled: false, rotateEnabled: true });
    const commit = props.onCommit as (rect: { x: number; y: number; w: number; h: number; rotation: number }) => void;
    await act(async () => commit({ x: 100, y: 100, w: 200, h: 100, rotation: 45 }));
    expect(onParamsChange).toHaveBeenLastCalledWith(expect.objectContaining({ width: 0.2, height: 0.1, rotation: 45 }));
  });

  async function mount(context: OpCardContext, onParamsChange: (patch: Partial<AssetOverlayParams>) => void, locked = false): Promise<void> {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => render(context, onParamsChange, locked));
  }
  function render(context: OpCardContext, onParamsChange: (patch: Partial<AssetOverlayParams>) => void, locked = false): void {
    root!.render(createElement(renderer.Card, { params: { ...overlayParams(), lockAspectRatio: locked }, ctx: context,
      disabled: false, onParamChange: () => {}, onParamsChange }));
  }
});

describe("asset overlay aspect inspection failure", () => {
  it("rejects replacement normalization without guessing geometry or logging at the helper", async () => {
    const error = new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_RATIO_SENTINEL");
    mocks.aspectRatio.mockRejectedValue(error);
    const params = overlayParams();
    await expect(normalizeAssetOverlayForPath(params, { width: 1000, height: 800 }, "/current/replacement.png")).rejects.toBe(error);
    expect(params).toEqual(overlayParams());
    expect(log).not.toHaveBeenCalled();
  });

  it("represents pending and failed inspection as unknown and logs the failure once", async () => {
    let fail!: (error: Error) => void;
    mocks.aspectRatio.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    function Probe() {
      const aspect = useLocalAssetAspectRatio("/current/original.png");
      return createElement("output", null, aspect === null ? "unknown" : String(aspect));
    }
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root!.render(createElement(Probe)));
    expect(document.querySelector("output")?.textContent).toBe("unknown");
    await act(async () => fail(new Error("FOTOREADY_RATIO_SENTINEL")));
    expect(document.querySelector("output")?.textContent).toBe("unknown");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      level: "warn", message: "asset aspect ratio read failed",
      fields: { assetPath: "/current/original.png", error: expect.objectContaining({ message: "FOTOREADY_RATIO_SENTINEL" }) }
    });
    await act(async () => root!.render(createElement(Probe)));
    expect(mocks.aspectRatio).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

function overlayParams(): AssetOverlayParams {
  return {
    assetPath: "/current/original.png",
    x: 0,
    y: 0,
    width: 0.2,
    height: 0.1,
    lockAspectRatio: true,
    flipHorizontal: false,
    flipVertical: false,
    opacity: 1,
    rotation: 0
  };
}
