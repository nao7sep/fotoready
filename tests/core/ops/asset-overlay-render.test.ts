import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAssetOverlay, readAssetAspectRatio } from "@core/ops/_asset-overlay";
import type { AssetOverlayParams } from "@shared/asset-overlay";

let root: string;
let asset: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-overlay-"));
  asset = path.join(root, "stamp.png");
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function replaceAsset(width: number, height: number, background: string): Promise<void> {
  await fs.rm(asset, { force: true });
  await sharp({ create: { width, height, channels: 4, background } }).png().toFile(asset);
}

describe("asset overlay replacement", () => {
  it("reads current aspect ratio after an imported file is removed and replaced at its name", async () => {
    await replaceAsset(16, 8, "red");
    expect(await readAssetAspectRatio(asset)).toBe(2);
    await replaceAsset(8, 16, "blue");
    expect(await readAssetAspectRatio(asset)).toBe(0.5);
  });

  it("renders current bytes when the same overlay geometry is used after replacement", async () => {
    const params: AssetOverlayParams = { assetPath: asset, x: 0, y: 0, width: 1, height: 1,
      lockAspectRatio: true, flipHorizontal: false, flipVertical: false, opacity: 1, rotation: 0 };
    const render = async () => {
      const image = sharp({ create: { width: 8, height: 8, channels: 4, background: "white" } });
      const result = await applyAssetOverlay(image, params, { sourceWidth: 8, sourceHeight: 8 });
      return ("image" in result ? result.image : result).raw().toBuffer();
    };
    await replaceAsset(8, 8, "red");
    expect([...(await render()).subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    await replaceAsset(8, 8, "blue");
    expect([...(await render()).subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  });
});
