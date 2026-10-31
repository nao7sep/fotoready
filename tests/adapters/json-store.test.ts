import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refusalOf } from "@adapters/json-store";
import { header } from "../helpers/file-header";

let dir: string;
const storePath = () => path.join(dir, "config.json");

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-refusal-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("the refusal check at a write", () => {
  it("allows a missing file and a readable one", async () => {
    expect(await refusalOf(storePath(), "config")).toBeNull();
    await fs.writeFile(storePath(), JSON.stringify(header("config")));
    expect(await refusalOf(storePath(), "config")).toBeNull();
  });

  it.each([
    ["broken JSON", "{ broken"],
    ["no header", JSON.stringify({ defaultWebpQuality: 71 })],
    ["another kind", JSON.stringify(header("state"))]
  ])("refuses %s as unreadable, reading only", async (_label, text) => {
    await fs.writeFile(storePath(), text);
    expect(await refusalOf(storePath(), "config")).toBe("unreadable");
    expect(await fs.readFile(storePath(), "utf8")).toBe(text);
    expect(await fs.readdir(dir)).toEqual(["config.json"]);
  });

  it("refuses a newer file as newer", async () => {
    await fs.writeFile(storePath(), JSON.stringify(header("config", 2)));
    expect(await refusalOf(storePath(), "config")).toBe("newer");
  });
});
