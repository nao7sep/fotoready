import { describe, expect, it } from "vitest";
import { canStartSave, saveCost } from "@main/queues/save-admission";

const GB = 2 ** 30;
const SIXTY_MP = saveCost(9504, 6336);
const TWELVE_MP = saveCost(4032, 3024);

describe("how many saves run at once", () => {
  it("costs a photo about four full copies of its pixels", () => {
    expect(SIXTY_MP / GB).toBeCloseTo(0.9, 2);
    expect(TWELVE_MP / GB).toBeCloseTo(0.18, 2);
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
    // On an 8 GB machine, four 60 MP saves fit in its 4 GB share; a fifth waits.
    expect(canStartSave(Array.from({ length: 3 }, () => SIXTY_MP), SIXTY_MP, 10, 8 * GB)).toBe(true);
    expect(canStartSave(Array.from({ length: 4 }, () => SIXTY_MP), SIXTY_MP, 10, 8 * GB)).toBe(false);
    expect(canStartSave(Array.from({ length: 9 }, () => SIXTY_MP), SIXTY_MP, 10, 24 * GB)).toBe(true);
    expect(canStartSave(Array.from({ length: 9 }, () => SIXTY_MP), SIXTY_MP, 12, 16 * GB)).toBe(false);
  });
});
