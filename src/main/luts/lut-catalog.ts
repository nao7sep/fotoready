import fs from "node:fs/promises";
import path from "node:path";
import type { LutEntry } from "@shared/types/ipc";

const BUILT_INS = [
  { name: "warm", transform: (r: number, g: number, b: number) => [r * 1.04, g * 1.01, b * 0.95] },
  { name: "cool", transform: (r: number, g: number, b: number) => [r * 0.96, g * 1.0, b * 1.06] },
  { name: "faded", transform: (r: number, g: number, b: number) => [r * 0.86 + 0.08, g * 0.86 + 0.08, b * 0.86 + 0.08] },
  { name: "muted", transform: (r: number, g: number, b: number) => muted(r, g, b) },
  { name: "high-contrast-bw", transform: (r: number, g: number, b: number) => highContrastBw(r, g, b) }
] as const;

export async function listLuts(lutFolder: string, homeDir: string): Promise<LutEntry[]> {
  const dir = expandHome(lutFolder, homeDir);
  await ensureBuiltInLuts(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".cube"))
    .map((entry) => ({
      name: path.basename(entry.name, path.extname(entry.name)),
      path: path.join(dir, entry.name),
      builtin: BUILT_INS.some((builtIn) => `${builtIn.name}.cube` === entry.name)
    }))
    .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name));
}

async function ensureBuiltInLuts(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(BUILT_INS.map((builtIn) => fs.writeFile(path.join(dir, `${builtIn.name}.cube`), cubeContent(builtIn.name, builtIn.transform), "utf8")));
}

function cubeContent(name: string, transform: (r: number, g: number, b: number) => readonly number[]): string {
  const size = 8;
  const lines = [
    `TITLE "${name}"`,
    "LUT_3D_SIZE 8",
    "DOMAIN_MIN 0 0 0",
    "DOMAIN_MAX 1 1 1"
  ];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        lines.push(transform(r / (size - 1), g / (size - 1), b / (size - 1)).map(formatCubeNumber).join(" "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function muted(r: number, g: number, b: number): number[] {
  const gray = r * 0.3 + g * 0.59 + b * 0.11;
  return [gray + (r - gray) * 0.72, gray + (g - gray) * 0.72, gray + (b - gray) * 0.72];
}

function highContrastBw(r: number, g: number, b: number): number[] {
  const gray = clamp((r * 0.3 + g * 0.59 + b * 0.11 - 0.5) * 1.35 + 0.5);
  return [gray, gray, gray];
}

function formatCubeNumber(value: number): string {
  return clamp(value).toFixed(6);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function expandHome(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}
