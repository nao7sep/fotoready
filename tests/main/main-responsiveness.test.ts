import { describe, expect, it, vi } from "vitest";

// What keeps busy image work from holding up the main process: the I/O thread pool's size, how many
// original thumbnails decode at once, and how waiting previews are coalesced.

const thumbnails = vi.hoisted(() => {
  const state = { active: 0, peak: 0, finishers: [] as Array<() => void> };
  const image = () => ({
    rotate() { return this; },
    async metadata() { return { width: 4, height: 3 }; },
    resize() { return this; },
    jpeg() { return this; },
    toBuffer: () => new Promise<Buffer>((resolve) => {
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      state.finishers.push(() => { state.active -= 1; resolve(Buffer.from("jpeg")); });
    })
  });
  return { state, sharp: vi.fn(image) };
});

vi.mock("sharp", () => ({ default: thumbnails.sharp }));

const { threadpoolSizeToSet, THREADPOOL_SIZE } = await import("@main/threadpool-size");
const { LatestOnly } = await import("@main/latest-only");
const { PreviewService } = await import("@main/preview-service");

describe("the I/O thread pool size", () => {
  it("is set to 16 unless the environment already chose a size", () => {
    expect(THREADPOOL_SIZE).toBe(16);
    expect(threadpoolSizeToSet({})).toBe("16");
    expect(threadpoolSizeToSet({ UV_THREADPOOL_SIZE: "" })).toBe("16");
    expect(threadpoolSizeToSet({ UV_THREADPOOL_SIZE: "6" })).toBeNull();
  });
});

describe("original thumbnails", () => {
  it("decode at most two at a time, however many originals arrive", async () => {
    const service = new PreviewService(null);
    const originals = Array.from({ length: 6 }, (_, index) => ({ id: `o${index}`, sourcePath: `/photos/${index}.jpg`, width: 4, height: 3 }));
    const rendering = Promise.all(originals.map((original) => service.renderOriginalThumbnail(original as never)));
    await vi.waitFor(() => expect(thumbnails.state.active).toBe(2));
    while (thumbnails.state.finishers.length > 0 || thumbnails.state.active > 0) {
      thumbnails.state.finishers.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect((await rendering).map((thumbnail) => thumbnail.originalId)).toEqual(originals.map((original) => original.id));
    expect(thumbnails.state.peak).toBe(2);
  });
});

describe("waiting previews", () => {
  it("run one at a time, keep only the newest waiting, and answer a replaced one with null", async () => {
    const latest = new LatestOnly();
    const runs: string[] = [];
    let finishFirst!: () => void;
    const first = latest.run(() => new Promise<string>((resolve) => { runs.push("first"); finishFirst = () => resolve("first"); }));
    const second = latest.run(async () => { runs.push("second"); return "second"; });
    const third = latest.run(async () => { runs.push("third"); return "third"; });

    expect(await second).toBeNull();
    finishFirst();
    expect(await first).toBe("first");
    expect(await third).toBe("third");
    expect(runs).toEqual(["first", "third"]);
  });

  it("passes a failure to the request that ran it, and goes on with the next", async () => {
    const latest = new LatestOnly();
    await expect(latest.run(async () => { throw new Error("render failed"); })).rejects.toThrow("render failed");
    expect(await latest.run(async () => "next")).toBe("next");
  });
});
