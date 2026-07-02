import type * as sharp from "sharp";
import type { OutputSettings } from "@shared/types/pipeline";

export function applyOutputEncoding(image: sharp.Sharp, output: OutputSettings): sharp.Sharp {
  const prepared = prepareForEncoding(image, output);
  switch (output.format) {
    case "original":
      throw new Error("Output format must be resolved before encoding.");
    case "jpeg":
      return prepared.jpeg({
        quality: requireResolvedQuality(output.quality),
        progressive: output.jpegProgressive,
        chromaSubsampling: output.jpegChromaSubsampling
      });
    case "webp":
      return prepared.webp({
        quality: requireResolvedQuality(output.quality),
        effort: output.webpMethod
      });
    case "avif":
      return prepared.avif({
        quality: requireResolvedQuality(output.quality),
        effort: output.avifEffort
      });
    case "png":
      return prepared.png({
        palette: output.pngPalette
      });
  }
}

// Quality, like format, must be resolved to a concrete, finite number before encoding (an
// "auto" keyword is resolved upstream from the DQT estimate or the configured fixed quality).
// Halt rather than silently substituting a default — or feeding sharp a NaN/Infinity — that
// would not match the user's setting.
function requireResolvedQuality(value: OutputSettings["quality"]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Output quality must be resolved before encoding.");
  }
  return value;
}

function prepareForEncoding(image: sharp.Sharp, output: OutputSettings): sharp.Sharp {
  if (output.format === "jpeg" || output.flattenTransparency) {
    return image.flatten({ background: output.backgroundForTransparency });
  }
  return image;
}
