import { describe, expect, it } from "vitest";
import { canStartSave, saveCost } from "@main/queues/save-admission";

const GB = 2 ** 30;
const SIXTY_MP = saveCost(9504, 6336);
const TWELVE_MP = saveCost(4032, 3024);

describe("how many saves run at once", () => {
  it("costs a photo about eight full copies of its pixels", () => {
    expect(SIXTY_MP / GB).toBeCloseTo(1.79, 2);
    expect(TWELVE_MP / GB).toBeCloseTo(0.36, 2);
  });

  it("costs the largest recipe frame even when the final image is smaller", () => {
    const ops = [
      { id: "large", type: "resize", enabled: true, params: { mode: "exact", width: 4000, height: 3000 } },
      { id: "small", type: "resize", enabled: true, params: { mode: "exact", width: 400, height: 300 } }
    ];
    expect(saveCost(1000, 1000, ops)).toBe(4000 * 3000 * 32);
    expect(saveCost(1000, 1000, [{ ...ops[0]!, enabled: false }])).toBe(1000 * 1000 * 32);
  });

  it("always starts the first save, even one larger than the machine's share", () => {
    expect(canStartSave([], saveCost(40_000, 40_000), 8, 8 * GB)).toBe(true);
  });

  it("runs ordinary photos one per core", () => {
    const running = Array.from({ length: 7 }, () => TWELVE_MP);
    expect(canStartSave(running, TWELVE_MP, 8, 8 * GB)).toBe(true);
    expect(canStartSave([...running, TWELVE_MP], TWELVE_MP, 8, 8 * GB)).toBe(false);
  });

  it("runs large photos only as many at once as half the machine's memory holds", () => {
    // On an 8 GB machine, two 60 MP saves fit in its 4 GB share; a third waits.
    expect(canStartSave(Array.from({ length: 1 }, () => SIXTY_MP), SIXTY_MP, 10, 8 * GB)).toBe(true);
    expect(canStartSave(Array.from({ length: 2 }, () => SIXTY_MP), SIXTY_MP, 10, 8 * GB)).toBe(false);
    expect(canStartSave(Array.from({ length: 5 }, () => SIXTY_MP), SIXTY_MP, 10, 24 * GB)).toBe(true);
    expect(canStartSave(Array.from({ length: 9 }, () => SIXTY_MP), SIXTY_MP, 12, 16 * GB)).toBe(false);
  });
});
