import { describe, expect, it } from "vitest";
import { sha256Bytes, sha256BytesYielding } from "@runtime/hash";

describe("hashing on the main process", () => {
  it.each([0, 1, 1024 * 1024, 3 * 1024 * 1024 + 7])("gives the same hash in chunks for %i bytes", async (size) => {
    const bytes = Buffer.alloc(size, 0x5a);
    expect(await sha256BytesYielding(bytes)).toBe(sha256Bytes(bytes));
  });

  it("lets other work run between chunks of a large file", async () => {
    const bytes = Buffer.alloc(4 * 1024 * 1024, 0x5a);
    let ranMeanwhile = false;
    setImmediate(() => { ranMeanwhile = true; });
    const hashing = sha256BytesYielding(bytes).then(() => ranMeanwhile);
    expect(await hashing).toBe(true);
  });
});
