import type { FileWriter } from "@shared/file-header";

/** FotoReady as the writer of the files it saves: its package name and this build's version. */
export const APP_WRITER: FileWriter = { name: "fotoready", version: __APP_VERSION__ };
