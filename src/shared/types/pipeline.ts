import type { OpInstance } from "./op";

export type EncodedOutputFormat = "jpeg" | "webp" | "avif" | "png" | "tiff";
export type OutputFormat = "original" | EncodedOutputFormat;

export type OutputSettings = {
  format: OutputFormat;
  quality: number | "auto";
  flattenTransparency: boolean;
  jpegProgressive: boolean;
  jpegChromaSubsampling: "4:4:4" | "4:2:2" | "4:2:0";
  webpMethod: number;
  avifEffort: number;
  pngPalette: boolean;
  backgroundForTransparency: string;
};

export type Pipeline = {
  ops: OpInstance[];
  output: OutputSettings;
};
