import sharp from "sharp";
import { expect, it } from "vitest";
import { requireOpModule } from "../../helpers/require-op-module";
import { materialize } from "@core/ops/_shared";

// White balance joined the shared per-pixel pass; it must still give exactly what the image
// library's own linear step gave, so saved photos do not change.
it("gives the image library's linear result, byte for byte", async () => {
  const { data, info } = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 }, noise: { type: "gaussian", mean: 128, sigma: 70 } } })
    .raw().toBuffer({ resolveWithObject: true });
  for (const [temperature, tint] of [[40, -20], [-100, 100], [100, -100], [7, 3], [0, 0]]) {
    const gains = [1 + temperature / 500, 1 + tint / 700, 1 - temperature / 500];
    const library = await (await materialize(sharp(Buffer.from(data), { raw: { width: info.width, height: info.height, channels: 4 } })
      .linear(gains, [0, 0, 0]))).image.raw().toBuffer();
    const shared = Buffer.from(data);
    await requireOpModule("white-balance").transformPixels!(shared, { temperature, tint, samplePoint: null } as never, { sourceWidth: 64, sourceHeight: 64 });
    expect(Buffer.compare(shared, library), `${temperature}, ${tint}`).toBe(0);
  }
});
