export type SourceJpegFacts = {
  jpegQualityEstimate: { value: number; method: "metadata" | "dqt-match" } | null;
};

const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
];

const STD_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99
];

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
];

export function detectJpegQuality(bytes: Buffer): SourceJpegFacts {
  const tables = parseDqtTables(bytes);
  const estimate = estimateQualityFromTables(tables);

  return {
    jpegQualityEstimate: estimate ? { value: estimate, method: "dqt-match" } : null
  };
}

function parseDqtTables(bytes: Buffer): Map<number, number[]> {
  const tables = new Map<number, number[]>();
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return tables;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;

    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;

    const segmentLength = bytes.readUInt16BE(offset);
    offset += 2;
    const segmentEnd = offset + segmentLength - 2;
    if (segmentEnd > bytes.length) break;

    if (marker === 0xdb) {
      parseDqtSegment(bytes, offset, segmentEnd, tables);
    }

    offset = segmentEnd;
  }

  return tables;
}

function parseDqtSegment(bytes: Buffer, offset: number, end: number, tables: Map<number, number[]>): void {
  let cursor = offset;
  while (cursor < end) {
    const spec = bytes[cursor++];
    const precision = spec >> 4;
    const tableId = spec & 0x0f;
    const valueSize = precision === 0 ? 1 : 2;
    const table: number[] = new Array(64);

    if (cursor + 64 * valueSize > end) return;

    for (let index = 0; index < 64; index += 1) {
      const value = valueSize === 1 ? bytes[cursor] : bytes.readUInt16BE(cursor);
      cursor += valueSize;
      table[ZIGZAG[index]] = value;
    }

    tables.set(tableId, table);
  }
}

function estimateQualityFromTables(tables: Map<number, number[]>): number | null {
  const observed: Array<{ table: number[]; standard: number[] }> = [];
  const luma = tables.get(0);
  const chroma = tables.get(1);
  if (luma) observed.push({ table: luma, standard: STD_LUMA });
  if (chroma) observed.push({ table: chroma, standard: STD_CHROMA });
  if (observed.length === 0) return null;

  let bestQuality = 0;
  let bestRms = Number.POSITIVE_INFINITY;
  for (let quality = 1; quality <= 100; quality += 1) {
    const rms = combinedRms(observed, quality);
    if (rms < bestRms) {
      bestRms = rms;
      bestQuality = quality;
    }
  }

  return bestRms <= 1.0 ? bestQuality : null;
}

function combinedRms(observed: Array<{ table: number[]; standard: number[] }>, quality: number): number {
  let sum = 0;
  let count = 0;
  for (const item of observed) {
    const expected = scaledTable(item.standard, quality);
    for (let index = 0; index < 64; index += 1) {
      const delta = item.table[index] - expected[index];
      sum += delta * delta;
      count += 1;
    }
  }
  return Math.sqrt(sum / count);
}

function scaledTable(standard: number[], quality: number): number[] {
  const scale = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2;
  return standard.map((value) => clamp(Math.floor((value * scale + 50) / 100), 1, 255));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
