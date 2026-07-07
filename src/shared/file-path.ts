export function fileNameFromPath(filePath: string): string {
  if (!filePath) return "";
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}
