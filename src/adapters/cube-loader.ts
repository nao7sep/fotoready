import fs from "node:fs/promises";
import { parseCubeLut, type CubeLut } from "@runtime/lut-cube";

/**
 * Reads and parses the lattice on every use. A bundled 17³ LUT parses in about 2 ms and a 33³ one in
 * about 11 ms, nothing a user notices beside the render that applies it, so no parsed copy is kept.
 */
export async function loadCubeLut(cubePath: string): Promise<CubeLut> {
  return parseCubeLut(await fs.readFile(cubePath, "utf8"));
}
