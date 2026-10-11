// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { createAssetOverlayRenderer, normalizeAssetOverlayForPath } from "@renderer/ops/_asset-overlay";
import type { OpCardContext } from "@renderer/ops/op-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ aspectRatio: vi.fn<() => Promise<number>>() }));
vi.mock("@renderer/ipc/client", () => ({ api: { assets: { aspectRatio: mocks.aspectRatio } } }));

const log = vi.fn(async () => undefined);
let root: Root | null = null;

beforeEach(() => {
  mocks.aspectRatio.mockReset();
  log.mockClear();
  vi.stubGlobal("api", { system: { log } });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("mounted asset aspect controls", () => {
  const renderer = createAssetOverlayRenderer({ type: "stamp", color: "blue",
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

  async function mount(context: OpCardContext, onParamsChange: (patch: Partial<AssetOverlayParams>) => void): Promise<void> {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => render(context, onParamsChange));
  }
  function render(context: OpCardContext, onParamsChange: (patch: Partial<AssetOverlayParams>) => void): void {
    root!.render(createElement(renderer.Card, { params: { ...overlayParams(), lockAspectRatio: false }, ctx: context,
      disabled: false, onParamChange: () => {}, onParamsChange }));
  }
});

describe("asset overlay aspect-ratio fallback", () => {
  it("logs the complete bridge rejection before using the neutral ratio", async () => {
    const error = new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_RATIO_SENTINEL");
    mocks.aspectRatio.mockRejectedValue(error);

    const result = await normalizeAssetOverlayForPath(
      overlayParams(),
      { width: 1000, height: 800 },
      "/current/replacement.png"
    );

    expect(result).toMatchObject({
      assetPath: "/current/replacement.png",
      width: expect.any(Number),
      height: expect.any(Number)
    });
    expect(log).toHaveBeenCalledWith({
      level: "warn",
      message: "asset aspect ratio read failed; using fallback",
      fields: {
        assetPath: "/current/replacement.png",
        error: expect.objectContaining({ message: expect.stringContaining("FOTOREADY_RATIO_SENTINEL") })
      }
    });
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
