import path from "node:path";

export function resolveProjectOutputDir(outputDir: string | null, sourcePath: string): string {
  if (!outputDir || outputDir.trim().length === 0) return path.dirname(sourcePath);
  if (path.isAbsolute(outputDir)) return outputDir;
  return path.resolve(process.cwd(), outputDir);
}
