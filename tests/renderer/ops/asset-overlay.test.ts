// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { normalizeAssetOverlayForPath } from "@renderer/ops/_asset-overlay";

const mocks = vi.hoisted(() => ({ aspectRatio: vi.fn<() => Promise<number>>() }));
vi.mock("@renderer/ipc/client", () => ({ api: { assets: { aspectRatio: mocks.aspectRatio } } }));

const log = vi.fn(async () => undefined);

beforeEach(() => {
  mocks.aspectRatio.mockReset();
  log.mockClear();
  vi.stubGlobal("api", { system: { log } });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
