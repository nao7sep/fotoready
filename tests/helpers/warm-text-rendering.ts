import sharp from "sharp";
import { renderTrimmedTextBitmap } from "@core/ops/watermark-text";
import { requireOpModule } from "@core/ops/registry";

type Params = Parameters<typeof renderTrimmedTextBitmap>[0];

/**
 * Starts the image library's text stack, its font discovery, which the first text render in a
 * process pays once. A file that renders text calls this from its `beforeAll`, so no test pays that
 * start-up inside its own time limit. It renders a text no test uses, so it adds no cached render a
 * test reads.
 */
export async function warmTextRendering(): Promise<void> {
  const defaults = requireOpModule("watermark-text").defaultParams as Params;
  // A symbol outside ASCII starts the fallback-font lookup too, and one render per image thread at
  // once starts each thread's own font set-up; threads can still be replaced later.
  await Promise.all(Array.from({ length: Math.max(1, sharp.concurrency()) }, (_, index) =>
    renderTrimmedTextBitmap({ ...defaults, text: `Text start-up © ${index}` }, 12)));
}
