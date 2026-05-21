import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LUT_FOLDER } from "@shared/constants";
import { clamp01 } from "@shared/numeric";
import type { LutEntry } from "@shared/types/ipc";
import { expandHomePath, importDirectoryAsset, listDirectoryAssets } from "./file-asset-catalog";

const BUILT_INS = [
  { name: "clean-contrast", transform: (r: number, g: number, b: number) => cleanContrast(r, g, b) },
  { name: "cool-print", transform: (r: number, g: number, b: number) => coolPrint(r, g, b) },
  { name: "muted-chrome", transform: (r: number, g: number, b: number) => mutedChrome(r, g, b) },
  { name: "pastel-fade", transform: (r: number, g: number, b: number) => pastelFade(r, g, b) },
  { name: "silver-fade", transform: (r: number, g: number, b: number) => silverFade(r, g, b) },
  { name: "soft-matte", transform: (r: number, g: number, b: number) => softMatte(r, g, b) },
  { name: "sunset-pop", transform: (r: number, g: number, b: number) => sunsetPop(r, g, b) },
  { name: "teal-shadows", transform: (r: number, g: number, b: number) => tealShadows(r, g, b) },
  { name: "vintage-warm", transform: (r: number, g: number, b: number) => vintageWarm(r, g, b) },
  { name: "warm-print", transform: (r: number, g: number, b: number) => warmPrint(r, g, b) }
] as const;

export async function listLuts(lutFolder: string, homeDir: string): Promise<LutEntry[]> {
  const dir = resolveLutDir(lutFolder, homeDir);
  await ensureBuiltInLuts(dir);
  const entries = await listDirectoryAssets(dir, [".cube"]);
  return entries
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      builtin: BUILT_INS.some((builtIn) => builtIn.name === entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function importLut(filePath: string, lutFolder: string, homeDir: string): Promise<LutEntry> {
  const dir = resolveLutDir(lutFolder, homeDir);
  await ensureBuiltInLuts(dir);
  const imported = await importDirectoryAsset(filePath, dir, [".cube"], "lut");
  return {
    name: imported.name,
    path: imported.path,
    builtin: false
  };
}

async function ensureBuiltInLuts(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(BUILT_INS.map((builtIn) => fs.writeFile(path.join(dir, `${builtIn.name}.cube`), cubeContent(builtIn.name, builtIn.transform), "utf8")));
}

function cubeContent(name: string, transform: (r: number, g: number, b: number) => readonly number[]): string {
  const size = 16;
  const lines = [
    `TITLE "${name}"`,
    `LUT_3D_SIZE ${size}`,
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

function cleanContrast(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 1.08),
    (rgb) => withSaturation(rgb, 1.04),
    (rgb) => withGamma(rgb, 1.02)
  );
}

function coolPrint(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 1.03),
    (rgb) => withSaturation(rgb, 0.95),
    (rgb) => withBalance(rgb, 0.97, 1.01, 1.08),
    (rgb) => withGamma(rgb, 1.04),
    (rgb) => splitTone(rgb, [0.01, 0.03, 0.06], [0, 0.01, 0.02], 0.22, 0.08)
  );
}

function mutedChrome(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 1.14),
    (rgb) => withSaturation(rgb, 0.82),
    (rgb) => withBalance(rgb, 1.02, 1, 0.95),
    (rgb) => withGamma(rgb, 0.97),
    (rgb) => splitTone(rgb, [0.01, 0.03, 0.02], [0.02, 0.01, 0], 0.18, 0.1)
  );
}

function pastelFade(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 0.88),
    (rgb) => withSaturation(rgb, 0.86),
    (rgb) => withBalance(rgb, 1.03, 1.01, 0.98),
    (rgb) => withGamma(rgb, 1.08),
    (rgb) => withLift(rgb, 0.06),
    (rgb) => splitTone(rgb, [0, 0.03, 0.05], [0.05, 0.02, 0.03], 0.12, 0.18)
  );
}

function silverFade(r: number, g: number, b: number): number[] {
  const gray = clamp01(luma(r, g, b));
  return composeRgb(
    [gray, gray, gray],
    (rgb) => withContrast(rgb, 1.04),
    (rgb) => withGamma(rgb, 1.03),
    (rgb) => withLift(rgb, 0.04),
    (rgb) => withBalance(rgb, 0.98, 0.99, 1.03)
  );
}

function softMatte(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 0.93),
    (rgb) => withSaturation(rgb, 0.95),
    (rgb) => withGamma(rgb, 1.04),
    (rgb) => withLift(rgb, 0.05)
  );
}

function sunsetPop(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 1.11),
    (rgb) => withSaturation(rgb, 1.18),
    (rgb) => withBalance(rgb, 1.09, 1.01, 0.9),
    (rgb) => withGamma(rgb, 1.02),
    (rgb) => splitTone(rgb, [0.04, 0.01, 0.06], [0.06, 0.03, 0], 0.24, 0.32)
  );
}

function tealShadows(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 1.1),
    (rgb) => withSaturation(rgb, 1),
    (rgb) => withBalance(rgb, 0.98, 1.02, 1.04),
    (rgb) => withGamma(rgb, 0.99),
    (rgb) => splitTone(rgb, [0, 0.05, 0.07], [0.04, 0.02, 0], 0.3, 0.2)
  );
}

function vintageWarm(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 0.92),
    (rgb) => withSaturation(rgb, 0.9),
    (rgb) => withBalance(rgb, 1.08, 1.02, 0.89),
    (rgb) => withGamma(rgb, 1.06),
    (rgb) => withLift(rgb, 0.055),
    (rgb) => splitTone(rgb, [0.01, 0.03, 0], [0.05, 0.03, 0], 0.18, 0.16)
  );
}

function warmPrint(r: number, g: number, b: number): number[] {
  return composeRgb(
    [r, g, b],
    (rgb) => withContrast(rgb, 1),
    (rgb) => withSaturation(rgb, 1.03),
    (rgb) => withBalance(rgb, 1.07, 1.02, 0.93),
    (rgb) => withGamma(rgb, 1.03),
    (rgb) => splitTone(rgb, [0, 0.01, 0.03], [0.04, 0.02, 0], 0.08, 0.18)
  );
}

function composeRgb(
  rgb: [number, number, number],
  ...steps: Array<(rgb: [number, number, number]) => [number, number, number]>
): [number, number, number] {
  return steps.reduce((current, step) => step(current), rgb);
}

function withContrast([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  return [
    clamp01((r - 0.5) * amount + 0.5),
    clamp01((g - 0.5) * amount + 0.5),
    clamp01((b - 0.5) * amount + 0.5)
  ];
}

function withLift([r, g, b]: [number, number, number], lift: number): [number, number, number] {
  return [
    clamp01(r * (1 - lift) + lift),
    clamp01(g * (1 - lift) + lift),
    clamp01(b * (1 - lift) + lift)
  ];
}

function withBalance([r, g, b]: [number, number, number], red: number, green: number, blue: number): [number, number, number] {
  return [clamp01(r * red), clamp01(g * green), clamp01(b * blue)];
}

function withGamma([r, g, b]: [number, number, number], gamma: number): [number, number, number] {
  return [
    clamp01(Math.pow(r, 1 / gamma)),
    clamp01(Math.pow(g, 1 / gamma)),
    clamp01(Math.pow(b, 1 / gamma))
  ];
}

function withSaturation([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  const gray = luma(r, g, b);
  return [
    clamp01(gray + (r - gray) * amount),
    clamp01(gray + (g - gray) * amount),
    clamp01(gray + (b - gray) * amount)
  ];
}

function splitTone(
  [r, g, b]: [number, number, number],
  shadows: [number, number, number],
  highlights: [number, number, number],
  shadowAmount: number,
  highlightAmount: number
): [number, number, number] {
  const brightness = luma(r, g, b);
  const shadowWeight = smoothstep(clamp01((0.62 - brightness) / 0.62)) * shadowAmount;
  const highlightWeight = smoothstep(clamp01((brightness - 0.38) / 0.62)) * highlightAmount;
  return [
    clamp01(r + shadows[0] * shadowWeight + highlights[0] * highlightWeight),
    clamp01(g + shadows[1] * shadowWeight + highlights[1] * highlightWeight),
    clamp01(b + shadows[2] * shadowWeight + highlights[2] * highlightWeight)
  ];
}

function luma(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function resolveLutDir(lutFolder: string, homeDir: string): string {
  return expandHomePath(lutFolder.trim().length > 0 ? lutFolder : DEFAULT_LUT_FOLDER, homeDir);
}

function formatCubeNumber(value: number): string {
  return clamp01(value).toFixed(6);
}
