import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { assertOutputSidecarFormat, OutputSidecarFormatError } from "@main/output-sidecar-format";
import { NewerFormatError } from "@shared/format-versions";

let root: string;
let file: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-sidecar-format-")); file = path.join(root, "output.json"); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("output sidecar mutation authority", () => {
  it("allows a missing optional sidecar and the supported marker", async () => {
    await assertOutputSidecarFormat(file);
    await fs.writeFile(file, '{"formatVersion":1}');
    await assertOutputSidecarFormat(file);
  });
  it("names and preserves a newer sidecar, keeping the structured diagnostic cause", async () => {
    const bytes = '{"formatVersion":2,"future":"diagnostic sentinel"}';
    await fs.writeFile(file, bytes);
    const error = await assertOutputSidecarFormat(file).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(OutputSidecarFormatError);
    expect(error).toMatchObject({ reason: { key: "failure.outputSidecarNewer", values: { path: file } }, cause: expect.any(NewerFormatError) });
    expect(JSON.stringify((error as OutputSidecarFormatError).reason)).not.toContain("diagnostic sentinel");
    expect(await fs.readFile(file, "utf8")).toBe(bytes);
  });
  it.each(['{}', '{"formatVersion":-1}', '{"formatVersion":1.5}', 'invalid sentinel'])('refuses the unreadable marker %s without moving the file', async (bytes) => {
    await fs.writeFile(file, bytes);
    await expect(assertOutputSidecarFormat(file)).rejects.toMatchObject({ reason: { key: "failure.outputSidecarUnreadable", values: { path: file } } });
    expect(await fs.readFile(file, "utf8")).toBe(bytes);
  });
});
