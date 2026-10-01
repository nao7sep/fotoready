import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelLists, fetchGeminiModelIds } from "@main/model-lists";

let home: string;
const endpoint = "https://models.example/proxy";
const key = "fake-test-key";
const DAY = 86400000;
const file = () => path.join(home, "model-lists.json");
const contents = async () => JSON.parse(await fs.readFile(file(), "utf8"));

beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-models-")); });
afterEach(async () => { vi.unstubAllGlobals(); await fs.rm(home, { recursive: true, force: true }); });

describe("Settings model-list facts", () => {
  it("creates nothing at construction or when no key is available", async () => {
    const fetchIds = vi.fn(async () => ["gemini-3.8-flash"]);
    const lists = new ModelLists(file(), async () => null, undefined, fetchIds);
    expect(await fs.readdir(home)).toEqual([]);
    await expect(lists.load({ endpoint })).resolves.toEqual([]);
    expect(fetchIds).not.toHaveBeenCalled();
    expect(await fs.readdir(home)).toEqual([]);
  });

  it("stores filtered UTC facts, reuses them for a day, and honors manual refresh", async () => {
    let now = Date.parse("2026-10-01T00:00:00.000Z");
    const fetchIds = vi.fn(async () => ["gemini-3.8-flash", "unknown", "gemini-3.8-flash"]);
    const lists = new ModelLists(file(), async () => key, undefined, fetchIds, () => now);
    await expect(lists.load({ endpoint })).resolves.toEqual(["gemini-3.8-flash"]);
    expect(await contents()).toEqual({ gemini: { fetchedAtUtc: "2026-10-01T00:00:00.000Z", ids: ["gemini-3.8-flash"] } });
    expect(fetchIds).toHaveBeenCalledWith(endpoint, key, expect.any(AbortSignal));
    now += DAY - 1;
    await lists.load({ endpoint });
    expect(fetchIds).toHaveBeenCalledOnce();
    await lists.load({ endpoint, force: true });
    expect(fetchIds).toHaveBeenCalledTimes(2);
    now += DAY;
    await lists.load({ endpoint });
    expect(fetchIds).toHaveBeenCalledTimes(3);
  });

  it("keeps old facts on a failed refresh, logs once, and throttles another automatic try", async () => {
    const fact = { gemini: { fetchedAtUtc: "2026-09-29T00:00:00.000Z", ids: ["gemini-3.8-flash"] } };
    await fs.writeFile(file(), JSON.stringify(fact));
    const warn = vi.fn();
    const fetchIds = vi.fn(async () => { throw new Error("offline"); });
    const lists = new ModelLists(file(), async () => key, { warn }, fetchIds, () => Date.parse("2026-10-01T00:00:00.000Z"));
    await expect(lists.load({ endpoint })).resolves.toEqual(["gemini-3.8-flash"]);
    await expect(lists.load({ endpoint })).resolves.toEqual(["gemini-3.8-flash"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(fetchIds).toHaveBeenCalledOnce();
    expect(await contents()).toEqual(fact);
  });

  it("coalesces simultaneous Settings requests and uses a draft key without reading the stored key", async () => {
    let finish!: (ids: string[]) => void;
    const fetchIds = vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    const resolveKey = vi.fn(async () => key);
    const lists = new ModelLists(file(), resolveKey, undefined, fetchIds);
    const request = { endpoint, apiKey: "draft-test-key", force: true, useStoredKey: false };
    const first = lists.load(request);
    const second = lists.load(request);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(fetchIds).toHaveBeenCalledOnce());
    finish(["gemini-3.8-flash"]);
    await first;
    expect(resolveKey).not.toHaveBeenCalled();
    expect(fetchIds).toHaveBeenCalledOnce();
  });
});

describe("Gemini model-list transport", () => {
  it("follows pages with a bound and filters generic or non-generation entries", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
        { name: "models/unknown", supportedGenerationMethods: ["generateContent"] }
      ], nextPageToken: "next" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] }
      ] })));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await expect(fetchGeminiModelIds(endpoint, key, signal)).resolves.toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("pageToken=next");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${endpoint}/v1beta/models?pageSize=1000`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "GET", signal: expect.any(AbortSignal) });
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get("x-goog-api-key")).toBe(key);
  });

  it("rejects a malformed list instead of recording a false empty success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: "wrong" }))));
    await expect(fetchGeminiModelIds(endpoint, key, new AbortController().signal)).rejects.toThrow("invalid model entry");
  });
});
