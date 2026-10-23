import { describe, expect, it } from "vitest";
import { runPipelineFromRaw } from "@runtime/pipeline-runner";
import { defaultPipeline } from "@shared/defaults";
import type { ConcealRegion } from "@shared/types/conceal";

const width = 128;
const height = 96;
type Point = readonly [number, number];
type ConcealOp = "cover" | "blur" | "mosaic";

// Fine red detail plus a broad green gradient distinguishes smoothing from block averaging.
// The landscape frame also makes scaling both region axes by the long edge observable.
function patternedPixels(inverted = false): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bright = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === (inverted ? 1 : 0);
      const offset = (y * width + x) * 4;
      pixels[offset] = bright ? 220 : 20;
      pixels[offset + 1] = inverted ? 254 - x * 2 : x * 2;
      pixels[offset + 2] = bright ? 200 : 40;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}
const source = patternedPixels();

function pixel(bytes: Buffer, [x, y]: Point): number[] {
  const offset = (y * width + x) * 4;
  return [...bytes.subarray(offset, offset + 4)];
}
function around([x, y]: Point): Point[] {
  const points: Point[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) points.push([x + dx, y + dy]);
    }
  }
  return points;
}
async function render(type: ConcealOp, region: ConcealRegion, bytes = source): Promise<Buffer> {
  const params = type === "cover" ? { rects: [region], color: "#112233", opacity: 1 }
    : type === "blur" ? { rects: [region], radius: 4 }
      : { rects: [region], blockSize: 0.125 };
  const result = await runPipelineFromRaw({
    ...defaultPipeline(), ops: [{ id: "conceal", type, enabled: true, params }]
  }, { bytes, width, height }, {});
  expect([result.width, result.height]).toEqual([width, height]);
  return result.bytes;
}

// Explicit spatial landmarks, away from antialiased boundaries, form an independent mask oracle.
// In particular, rotated bounding-box corners must retain the original pixels.
const cases: Array<{ name: string; region: ConcealRegion; inside: Point[]; outside: Point[] }> = [
  {
    name: "rectangle", region: { x: 0.25, y: 0.25, w: 0.5, h: 0.25, rotation: 0, shape: "rectangle" },
    inside: [[40, 40], [64, 48], [88, 56]], outside: [[16, 48], [64, 24], [104, 48], [64, 72]]
  },
  {
    name: "ellipse", region: { x: 0.25, y: 0.25, w: 0.5, h: 0.25, rotation: 0, shape: "ellipse" },
    inside: [[64, 40], [48, 48], [80, 48]], outside: [[34, 34], [94, 62], [16, 48], [64, 72]]
  },
  {
    name: "rectangle rotated into a diamond",
    region: { x: 0.375, y: 0.25, w: 0.25, h: 0.25, rotation: 45, shape: "rectangle" },
    inside: [[64, 30], [82, 48], [64, 66], [46, 48]], outside: [[49, 33], [79, 33], [49, 63], [79, 63]]
  },
  {
    name: "long ellipse rotated vertically",
    region: { x: 0.25, y: 0.3125, w: 0.5, h: 0.125, rotation: 90, shape: "ellipse" },
    inside: [[64, 24], [64, 72], [60, 48]], outside: [[40, 48], [88, 48], [57, 20], [71, 76]]
  },
  {
    name: "rectangle clipped at the right and bottom edges",
    region: { x: 0.75, y: 0.5, w: 0.5, h: 0.375, rotation: 0, shape: "rectangle" },
    inside: [[100, 68], [120, 88], [127, 95]], outside: [[88, 80], [112, 52], [32, 32]]
  },
  {
    name: "ellipse clipped at the right and bottom edges",
    region: { x: 0.625, y: 0.375, w: 0.5, h: 0.5, rotation: 0, shape: "ellipse" },
    inside: [[112, 80], [127, 95], [112, 95]], outside: [[82, 50], [96, 32], [64, 80]]
  }
];

for (const type of ["cover", "blur", "mosaic"] as const) {
  describe(`${type} mask pixels`, () => {
    it.each(cases)("conceals inside a $name and preserves nearby pixels outside its shape", async ({ region, inside, outside }) => {
      const output = await render(type, region);
      for (const point of outside.flatMap(around)) {
        expect(pixel(output, point), `outside (${point})`).toEqual(pixel(source, point));
      }
      for (const point of inside.flatMap(around)) {
        const changed = pixel(output, point);
        expect(changed[3], `alpha (${point})`).toBe(255);
        if (type === "cover") expect(changed, `covered (${point})`).toEqual([17, 34, 51, 255]);
        else {
          // Original red values are 20/220: either concealment removes the fine alternating detail.
          expect(changed[0], `smoothed red (${point})`).toBeGreaterThan(60);
          expect(changed[0], `smoothed red (${point})`).toBeLessThan(180);
        }
      }
    });
  });
}

it("opaque cover removes source detail rather than blending the original through", async () => {
  const region = cases[0]!.region;
  const inverted = patternedPixels(true);
  const first = await render("cover", region);
  const second = await render("cover", region, inverted);
  const originalColors = new Set<string>();
  for (let y = 36; y < 60; y += 1) {
    for (let x = 36; x < 92; x += 1) {
      const point: Point = [x, y];
      originalColors.add(pixel(source, point).join(","));
      expect(pixel(first, point)).toEqual([17, 34, 51, 255]);
      expect(pixel(second, point)).toEqual(pixel(first, point));
    }
  }
  expect(originalColors.size).toBeGreaterThan(20);
  expect(pixel(first, [8, 8])).not.toEqual(pixel(second, [8, 8]));
});

it("blur smooths fine detail while retaining a continuous spatial gradient", async () => {
  const output = await render("blur", cases[0]!.region);
  const reds = [52, 53, 54, 55, 56].map((x) => pixel(output, [x, 48])[0]!);
  expect(Math.max(...reds) - Math.min(...reds)).toBeLessThan(10);
  expect(Math.abs(pixel(source, [52, 48])[0]! - pixel(source, [54, 48])[0]!)).toBe(200);
  const greens = [52, 53, 54, 55, 56].map((x) => pixel(output, [x, 48])[1]!);
  expect(greens[4]).toBeGreaterThan(greens[0]!);
  expect(new Set(greens).size).toBeGreaterThan(3);
});

it("mosaic replaces detail with uniform tiles while retaining differences between tiles", async () => {
  const output = await render("mosaic", cases[0]!.region);
  const tile = pixel(output, [36, 36]);
  for (let y = 36; y < 44; y += 1) {
    for (let x = 36; x < 44; x += 1) expect(pixel(output, [x, y])).toEqual(tile);
  }
  expect(pixel(source, [36, 36])).not.toEqual(pixel(source, [38, 36]));
  expect(pixel(output, [52, 36])[1]).toBeGreaterThan(tile[1]!);
});
