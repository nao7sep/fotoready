import { describe, expect, it } from "vitest";
import { fitLargestFontSize, renderTrimmedTextBitmap } from "@core/ops/watermark-text";
import { requireOpModule } from "@core/ops/registry";

type Params = Parameters<typeof renderTrimmedTextBitmap>[0];
type Size = { width: number; height: number };

// The fit's answer is defined as what a full binary search over every candidate size returns.
async function binarySearchFit(render: (fontSize: number) => Promise<Size>, maxWidth: number, maxHeight: number): Promise<number> {
  let low = 1;
  let high = Math.max(1, Math.ceil(Math.max(maxWidth, maxHeight) * 1.5));
  let best: number | null = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = await render(mid);
    if (candidate.width <= maxWidth && candidate.height <= maxHeight) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best ?? 1;
}

function counted<T>(render: (fontSize: number) => Promise<T>): { render: (fontSize: number) => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    render: (fontSize) => {
      calls += 1;
      return render(fontSize);
    },
    calls: () => calls
  };
}

describe("watermark text fit", () => {
  // Small boxes keep the reference search's renders cheap.
  it("picks the size a full binary search picks for real text, in a few renders", async () => {
    const defaults = requireOpModule("watermark-text").defaultParams as Params;
    const renderCounts: number[] = [];
    for (const text of ["Watermark", "© Ag", "i"]) {
      const params = { ...defaults, text };
      const render = (fontSize: number) => renderTrimmedTextBitmap(params, fontSize);
      for (const [maxWidth, maxHeight] of [[60, 20], [40, 13], [24, 24]] as const) {
        const expected = await binarySearchFit(render, maxWidth, maxHeight);
        const fit = counted(render);
        const { fontSize, bitmap } = await fitLargestFontSize(fit.render, maxWidth, maxHeight);
        expect(fontSize, `${text} in ${maxWidth}x${maxHeight}`).toBe(expected);
        expect(bitmap).toEqual(await render(fontSize));
        renderCounts.push(fit.calls());
      }
    }
    expect(Math.max(...renderCounts)).toBeLessThanOrEqual(5);
  });

  it("picks the size a full binary search picks across box shapes", async () => {
    // Ink grows linearly with the font size plus an antialiasing fringe, like rendered text.
    const render = async (fontSize: number): Promise<Size> => ({
      width: Math.ceil(fontSize * 4.56 + 3.3),
      height: Math.ceil(fontSize * 0.747 + 1.2)
    });
    const renderCounts: number[] = [];
    for (let maxWidth = 1; maxWidth <= 3000; maxWidth += 137) {
      for (const maxHeight of [1, 9, 40, 150, 384, 1000]) {
        const fit = counted(render);
        const { fontSize } = await fitLargestFontSize(fit.render, maxWidth, maxHeight);
        expect(fontSize, `${maxWidth}x${maxHeight}`).toBe(await binarySearchFit(render, maxWidth, maxHeight));
        renderCounts.push(fit.calls());
      }
    }
    expect(Math.max(...renderCounts)).toBeLessThanOrEqual(4);
  });

  it("falls back to size 1 when nothing fits", async () => {
    const fit = await fitLargestFontSize(async (fontSize) => ({ width: fontSize + 10, height: fontSize + 10 }), 5, 5);
    expect(fit.fontSize).toBe(1);
  });
});
