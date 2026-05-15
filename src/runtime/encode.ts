import type sharp from "sharp";
import type { OutputSettings } from "@shared/types/pipeline";

export function applyOutputEncoding(image: sharp.Sharp, output: OutputSettings): sharp.Sharp {
  const prepared = prepareForEncoding(image, output);
  switch (output.format) {
    case "original":
      throw new Error("Output format must be resolved before encoding.");
    case "jpeg":
      return prepared.jpeg({
        quality: numericQuality(output.quality, 85),
        progressive: output.jpegProgressive,
        chromaSubsampling: output.jpegChromaSubsampling
      });
    case "webp":
      return prepared.webp({
        quality: numericQuality(output.quality, 82),
        effort: output.webpMethod
      });
    case "avif":
      return prepared.avif({
        quality: numericQuality(output.quality, 60),
        effort: output.avifEffort
      });
    case "png":
      return prepared.png({
        palette: output.pngPalette
      });
  }
}

function numericQuality(value: OutputSettings["quality"], fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function prepareForEncoding(image: sharp.Sharp, output: OutputSettings): sharp.Sharp {
  if (output.format === "jpeg" || output.flattenTransparency) {
    return image.flatten({ background: output.backgroundForTransparency });
  }
  return image;
}
