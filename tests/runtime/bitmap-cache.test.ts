import { describe, expect, it } from "vitest";
import { BitmapCache } from "@runtime/bitmap-cache";

const bitmap = (bytes: number, value = 1) => ({ data: Buffer.alloc(bytes, value), width: bytes / 4, height: 1, channels: 4 as const });

describe("BitmapCache", () => {
  it("retains small bitmaps up to the byte allowance without an entry-count cap", () => {
    const cache = new BitmapCache(300 * 4);
    for (let index = 0; index < 300; index += 1) cache.set(String(index), bitmap(4));
    expect(cache.byteSize).toBe(1200);
    for (let index = 0; index < 300; index += 1) expect(cache.get(String(index))).not.toBeNull();
  });

  it("accounts for pixel bytes across both namespaces and evicts least recently read entries", () => {
    const cache = new BitmapCache(20);
    cache.set("fit|one", bitmap(8));
    cache.set("render|two", bitmap(8));
    expect(cache.byteSize).toBe(16);
    expect(cache.get("fit|one")).not.toBeNull();
    cache.set("render|three", bitmap(8));
    expect(cache.byteSize).toBe(16);
    expect(cache.get("render|two")).toBeNull();
    expect(cache.get("fit|one")).not.toBeNull();
    expect(cache.get("render|three")).not.toBeNull();
  });

  it("subtracts replacement bytes and makes the replacement most recently used", () => {
    const cache = new BitmapCache(20);
    cache.set("a", bitmap(8));
    cache.set("b", bitmap(8));
    cache.set("a", bitmap(4, 2));
    expect(cache.byteSize).toBe(12);
    cache.set("c", bitmap(12));
    expect(cache.byteSize).toBe(16);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")?.data).toEqual(Buffer.alloc(4, 2));
  });

  it("evicts as many entries as necessary to stay within a changed allowance", () => {
    const cache = new BitmapCache(24);
    for (const key of ["a", "b", "c"]) cache.set(key, bitmap(8));
    cache.setBudget(8);
    expect(cache.byteSize).toBe(8);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).not.toBeNull();
    cache.setBudget(0);
    expect(cache.byteSize).toBe(0);
    expect(cache.get("c")).toBeNull();
  });

  it("bypasses oversized bitmaps without evicting unrelated reusable pixels", () => {
    const cache = new BitmapCache(8);
    cache.set("a", bitmap(8));
    cache.set("large", bitmap(12));
    expect(cache.byteSize).toBe(8);
    expect(cache.get("large")).toBeNull();
    expect(cache.get("a")).not.toBeNull();
    cache.set("a", bitmap(12));
    expect(cache.byteSize).toBe(0);
    expect(cache.get("a")).toBeNull();
  });

  it("isolates cached bytes from the original and every returned bitmap", () => {
    const cache = new BitmapCache(8);
    const original = bitmap(8);
    cache.set("a", original);
    original.data.fill(2);
    const first = cache.get("a")!;
    expect(first.data).toEqual(Buffer.alloc(8, 1));
    first.data.fill(3);
    expect(cache.get("a")?.data).toEqual(Buffer.alloc(8, 1));
    expect(cache.byteSize).toBe(8);
  });
});
