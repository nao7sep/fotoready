import type { OpInstance } from "./op";

export type OutputFormat = "jpeg" | "webp" | "avif" | "png";

export type OutputSettings = {
  format: OutputFormat;
  quality: number | "match-source-size" | "match-source-quality";
  jpegProgressive: boolean;
  jpegChromaSubsampling: "4:4:4" | "4:2:2" | "4:2:0";
  webpMethod: number;
  avifEffort: number;
  pngPalette: boolean;
  backgroundForTransparency: string;
  iccOutput: "tag-srgb" | "embed-srgb" | "untagged";
};

export type Pipeline = {
  ops: OpInstance[];
  output: OutputSettings;
};
