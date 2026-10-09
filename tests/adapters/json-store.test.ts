import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAsideStore } from "@adapters/json-store";

let dir: string;
const storePath = () => path.join(dir, "config.json");

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-set-aside-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T05:06:07.250Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("setting an unreadable store aside", () => {
  it("names the copy with second precision and removes the original", async () => {
    await fs.writeFile(storePath(), "{ broken");
    const setAside = await setAsideStore(storePath());
    expect(setAside).toBe(path.join(dir, "config-20261009-050607-utc.invalid"));
    expect(await fs.readFile(setAside, "utf8")).toBe("{ broken");
    expect(await fs.readdir(dir)).toEqual(["config-20261009-050607-utc.invalid"]);
  });

  it("refuses a second set-aside within the same second, keeping the first and leaving the original", async () => {
    await fs.writeFile(storePath(), "{ first");
    const first = await setAsideStore(storePath());
    vi.setSystemTime(new Date("2026-10-09T05:06:07.900Z"));
    await fs.writeFile(storePath(), "{ second");

    await expect(setAsideStore(storePath())).rejects.toMatchObject({ code: "EEXIST" });

    expect(await fs.readFile(first, "utf8")).toBe("{ first");
    expect(await fs.readFile(storePath(), "utf8")).toBe("{ second");
  });
});
