import fs from "node:fs/promises";
import { parseCubeLut, type CubeLut } from "@runtime/lut-cube";

export async function loadCubeLut(cubePath: string): Promise<CubeLut> {
  return parseCubeLut(await fs.readFile(cubePath, "utf8"));
}
