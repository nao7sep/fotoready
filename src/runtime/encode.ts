import type sharp from "sharp";
import type { OutputSettings } from "@shared/types/pipeline";

export function applyOutputEncoding(image: sharp.Sharp, output: OutputSettings): sharp.Sharp {
  switch (output.format) {
    case "jpeg":
      return image.jpeg({
        quality: numericQuality(output.quality, 85),
        progressive: output.jpegProgressive,
        chromaSubsampling: output.jpegChromaSubsampling
      });
    case "webp":
      return image.webp({
        quality: numericQuality(output.quality, 82),
        effort: output.webpMethod
      });
    case "avif":
      return image.avif({
        quality: numericQuality(output.quality, 60),
        effort: output.avifEffort
      });
    case "png":
      return image.png({
        palette: output.pngPalette
      });
  }
}

function numericQuality(value: OutputSettings["quality"], fallback: number): number {
  return typeof value === "number" ? value : fallback;
}
