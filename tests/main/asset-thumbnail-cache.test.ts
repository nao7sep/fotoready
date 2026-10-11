import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AssetThumbnailCache } from "@main/asset-thumbnail-cache";

const renders = vi.hoisted(() => ({ releases: [] as ((data: Buffer) => void)[] }));
vi.mock("sharp", () => ({ default: () => {
  const image = {
    resize: () => image, ensureAlpha: () => image, png: () => image,
    toBuffer: () => new Promise((resolve) => { renders.releases.push((data) => resolve({ data, info: { width: 32, height: 32 } })); })
  };
  return image;
} }));
let root: string;
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it("does not promote a retired thumbnail after a replacement with the same preserved stat key", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-thumbnails-"));
  const asset = path.join(root, "same.svg");
  await fs.writeFile(asset, "old");
  const modified = new Date("2024-01-01T00:00:00.000Z");
  await fs.utimes(asset, modified, modified);
  const cache = new AssetThumbnailCache();
  const held = cache.get(asset, 32);
  await vi.waitFor(() => expect(renders.releases).toHaveLength(1));
  await fs.rm(asset);
  await fs.writeFile(asset, "new");
  await fs.utimes(asset, modified, modified);
  cache.clear();
  const fresh = cache.get(asset, 32);
  await vi.waitFor(() => expect(renders.releases).toHaveLength(2));
  renders.releases[1]!(Buffer.from("new"));
  const replacement = await fresh;
  renders.releases[0]!(Buffer.from("old"));
  expect((await held).dataUrl).not.toBe(replacement.dataUrl);
  expect(await cache.get(asset, 32)).toEqual(replacement);
  expect(renders.releases).toHaveLength(2);
});
