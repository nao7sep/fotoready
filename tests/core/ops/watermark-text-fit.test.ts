import { beforeAll, describe, expect, it } from "vitest";
import { fitLargestFontSize, renderTrimmedTextBitmap } from "@core/ops/watermark-text";
import { requireOpModule } from "@core/ops/registry";
import { warmTextRendering } from "../../setup/warm-text-rendering";

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

const TEXTS = ["Watermark", "© Ag", "i"];
// Small boxes keep the reference search's renders cheap.
const BOXES = [[60, 20], [40, 13], [24, 24]] as const;

type Reference = { text: string; maxWidth: number; maxHeight: number; expected: number; measured: Map<number, Size> };

describe("watermark text fit", () => {
  // The full binary search renders real text at every size it tries, which can take seconds on a
  // loaded machine; it runs here, outside any test's own time limit, and keeps each real measurement.
  const references: Reference[] = [];
  beforeAll(async () => {
    await warmTextRendering();
    const defaults = requireOpModule("watermark-text").defaultParams as Params;
    for (const text of TEXTS) {
      const measured = new Map<number, Size>();
      const render = async (fontSize: number): Promise<Size> => {
        const { width, height } = await renderTrimmedTextBitmap({ ...defaults, text }, fontSize);
        measured.set(fontSize, { width, height });
        return { width, height };
      };
      for (const [maxWidth, maxHeight] of BOXES) {
        references.push({ text, maxWidth, maxHeight, expected: await binarySearchFit(render, maxWidth, maxHeight), measured });
      }
    }
  });

  it("picks the size a full binary search picks for real text, in a few renders", async () => {
    const defaults = requireOpModule("watermark-text").defaultParams as Params;
    const renderCounts: number[] = [];
    for (const { text, maxWidth, maxHeight, expected, measured } of references) {
      // The real measurements the reference search took; a size it did not try is rendered now.
      const fit = counted(async (fontSize: number): Promise<Size> =>
        measured.get(fontSize) ?? await renderTrimmedTextBitmap({ ...defaults, text }, fontSize));
      const { fontSize } = await fitLargestFontSize(fit.render, maxWidth, maxHeight);
      expect(fontSize, `${text} in ${maxWidth}x${maxHeight}`).toBe(expected);
      renderCounts.push(fit.calls());
    }
    expect(renderCounts).toHaveLength(TEXTS.length * BOXES.length);
    expect(Math.max(...renderCounts)).toBeLessThanOrEqual(5);
  });

  it("returns the bitmap of the size it picks, rendering real text", async () => {
    const defaults = requireOpModule("watermark-text").defaultParams as Params;
    const { text, maxWidth, maxHeight, expected } = references[0]!;
    const render = (fontSize: number) => renderTrimmedTextBitmap({ ...defaults, text }, fontSize);
    const { fontSize, bitmap } = await fitLargestFontSize(render, maxWidth, maxHeight);
    expect(fontSize).toBe(expected);
    expect(bitmap).toEqual(await render(fontSize));
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
