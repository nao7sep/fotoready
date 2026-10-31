import { APP_WRITER } from "@main/app-writer";
import { FILE_OWNER, type FileKind } from "@shared/file-header";

/** The identity header a FotoReady file of `kind` starts with, at `version` (1 unless given). */
export function header(kind: FileKind, version = 1): { format: { owner: string; kind: FileKind; version: number }; writer: { name: string; version: string } } {
  return { format: { owner: FILE_OWNER, kind, version }, writer: { ...APP_WRITER } };
}
