export type CubeLut = {
  title: string | null;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Array<[number, number, number]>;
};

export function parseCubeLut(source: string): CubeLut {
  let title: string | null = null;
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const data: Array<[number, number, number]> = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const directive = parts[0].toUpperCase();

    if (directive === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "");
    } else if (directive === "LUT_3D_SIZE") {
      size = Number(parts[1]);
    } else if (directive === "DOMAIN_MIN") {
      domainMin = tuple(parts.slice(1));
    } else if (directive === "DOMAIN_MAX") {
      domainMax = tuple(parts.slice(1));
    } else if (/^-?\d/.test(parts[0])) {
      data.push(tuple(parts));
    }
  }

  if (!Number.isInteger(size) || size < 2) {
    throw new Error("Unsupported or missing LUT_3D_SIZE.");
  }
  if (data.length !== size * size * size) {
    throw new Error(`Expected ${size * size * size} LUT entries, got ${data.length}.`);
  }

  return { title, size, domainMin, domainMax, data };
}

export function sampleCubeLut(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const nr = normalize(r, lut.domainMin[0], lut.domainMax[0]);
  const ng = normalize(g, lut.domainMin[1], lut.domainMax[1]);
  const nb = normalize(b, lut.domainMin[2], lut.domainMax[2]);
  const max = lut.size - 1;
  const x = nr * max;
  const y = ng * max;
  const z = nb * max;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(max, x0 + 1);
  const y1 = Math.min(max, y0 + 1);
  const z1 = Math.min(max, z0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;

  return lerp3(
    lerp3(lerp3(at(lut, x0, y0, z0), at(lut, x1, y0, z0), tx), lerp3(at(lut, x0, y1, z0), at(lut, x1, y1, z0), tx), ty),
    lerp3(lerp3(at(lut, x0, y0, z1), at(lut, x1, y0, z1), tx), lerp3(at(lut, x0, y1, z1), at(lut, x1, y1, z1), tx), ty),
    tz
  );
}

function at(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  return lut.data[r + g * lut.size + b * lut.size * lut.size];
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function normalize(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
}

function tuple(values: string[]): [number, number, number] {
  return [Number(values[0]), Number(values[1]), Number(values[2])];
}
