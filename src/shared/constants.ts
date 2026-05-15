export const APP_NAME = "FotoReady";
export const APP_ID = "com.fotoready.desktop";
export const DATA_DIR_NAME = ".fotoready";

export const BUILTIN_FILENAME_TEMPLATE_IDS = {
  slugSize: "builtin-slug-size",
  slug: "builtin-slug",
  originalSize: "builtin-original-size",
  original: "builtin-original"
} as const;

export const DEFAULT_FILENAME_TEMPLATE_ID = BUILTIN_FILENAME_TEMPLATE_IDS.slugSize;
export const DEFAULT_LUT_FOLDER = "~/.fotoready/luts/";
export const TASK_SIDECAR_SUFFIX = ".fotoready.json";
