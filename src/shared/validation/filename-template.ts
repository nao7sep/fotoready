export function assertSafeRenderedFilename(fileName: string): void {
  if (fileName.length === 0) {
    throw new Error("Rendered filename is empty.");
  }
  if (fileName === "." || fileName === "..") {
    throw new Error(`Rendered filename "${fileName}" is not allowed.`);
  }
  if (/[\\/]/.test(fileName)) {
    throw new Error(`Rendered filename "${fileName}" contains path separators.`);
  }
  if (fileName.includes("\0")) {
    throw new Error("Rendered filename contains a null byte.");
  }
}
