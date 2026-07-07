import path from "node:path";

// Resolves the output directory for a processed image. Per the storage-path
// conventions, a GUI path is NEVER resolved against the working directory: a
// double-clicked macOS build runs with cwd `/`, so a relative output dir would
// land under `/` and writes would fail or be misplaced.
//
// Resolution:
//   - empty/whitespace `outputDir` → the source image's own directory (the
//     established default for "save next to the original").
//   - absolute `outputDir` → used as-is.
//   - relative `outputDir` → resolved against the source image's directory (an
//     explicit, meaningful base), so "out/web" means a subfolder beside the
//     source rather than something under the launch cwd.
//
// By the time this returns, the path is always absolute.
export function resolveProjectOutputDir(outputDir: string | null, sourcePath: string): string {
  const sourceDir = path.dirname(sourcePath);
  if (!outputDir || outputDir.trim().length === 0) return sourceDir;
  const trimmed = outputDir.trim();
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(sourceDir, trimmed);
}
