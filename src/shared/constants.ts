import { encodedFormats } from "./output-format";
import type { EncodedOutputFormat } from "./types/pipeline";

export const APP_NAME = "FotoReady";
export const APP_ID = "com.fotoready.desktop";
export const DATA_DIR_NAME = ".fotoready";
export const TASK_SIDECAR_SUFFIX = ".json";
export const MAX_RESIZE_DIMENSION = 8192;
export const MAX_RESIZE_PIXELS = 40_000_000;
export const MAX_PREVIEW_LONG_EDGE = 4096;
export const MAX_VISION_IMAGE_LONG_EDGE = 4096;
export const DEFAULT_ASSET_PICKER_PREVIEW_LONG_EDGE = 180;
export const MIN_ASSET_PICKER_PREVIEW_LONG_EDGE = 96;
export const MAX_ASSET_PICKER_PREVIEW_LONG_EDGE = 320;

// The extensions each writable format is accepted under. Keyed by EncodedOutputFormat,
// so adding a format to that union fails to compile until its extensions are named here.
const FORMAT_EXTENSIONS: Record<EncodedOutputFormat, readonly string[]> = {
  jpeg: ["jpg", "jpeg"],
  png: ["png"],
  webp: ["webp"],
  avif: ["avif"],
  tiff: ["tif", "tiff"]
};

// File extensions accepted by the import flow (file dialog and drag-and-drop),
// DERIVED from what the app can write, plus the .json task sidecar so dropping a
// sidecar re-imports its task.
//
// Import and output are the same set on purpose. This list used to also accept heic
// and gif, neither of which can be encoded: "Same as original" then resolved to null
// and fell through to png, so the app promised the source format and silently handed
// back another. Accepting only what can be written makes that unrepresentable rather
// than merely fixed — and heic could not even be *opened* by this Sharp build, so the
// dialog was offering a format that never once worked.
export const IMPORT_FILE_EXTENSIONS = [
  ...encodedFormats.flatMap((format) => FORMAT_EXTENSIONS[format]),
  "json"
] as const;
