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

export type AppliedColorNormalization = {
  detectedProfile: string | null;
  detectedColorSpaceTag: "srgb" | "adobe-rgb" | "uncalibrated" | null;
  assumed: "srgb" | "adobe-rgb" | null;
  iccBakedIntoPixels: boolean;
};

export type JpegQualityEstimate = {
  value: number;
  method: "metadata" | "dqt-match" | "binary-search";
};

export type SourceSnapshot = {
  sha256: string;
  width: number;
  height: number;
  format: string;
  jpegQualityEstimate: JpegQualityEstimate | null;
};

export type ToolVersions = {
  fotoready: string;
  sharp: string;
  libvips: string;
  exiftool: string;
};

export type Pipeline = {
  specVersion: 1;
  ops: OpInstance[];
  output: OutputSettings;
  appliedColorNormalization: AppliedColorNormalization | null;
  sourceSnapshot: SourceSnapshot | null;
  toolVersions: ToolVersions | null;
};
