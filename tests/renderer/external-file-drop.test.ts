import { describe, expect, it } from "vitest";
import { acceptsLocalFileDrag, DropHighlightLease, localImportPaths } from "@renderer/external-file-drop";

function file(name: string): File {
  return { name } as File;
}

function transfer(
  files: Array<{ file: File; path: string }>,
  types: string[] = ["Files"]
): { dataTransfer: DataTransfer; pathForFile: (file: File) => string } {
  const paths = new Map(files.map((entry) => [entry.file, entry.path]));
  return {
    dataTransfer: {
      types,
      items: files.map((entry) => ({ kind: "file", getAsFile: () => entry.file }))
    } as unknown as DataTransfer,
    pathForFile: (candidate) => paths.get(candidate) ?? ""
  };
}

describe("external file-drop acceptance", () => {
  it("accepts supported local image and sidecar files", () => {
    const jpeg = file("photo.jpg");
    const sidecar = file("photo.fotoready.json");
    const offered = transfer([
      { file: jpeg, path: "/photos/photo.jpg" },
      { file: sidecar, path: "/photos/photo.fotoready.json" }
    ]);

    expect(acceptsLocalFileDrag(offered.dataTransfer, offered.pathForFile)).toBe(true);
    expect(localImportPaths([jpeg, sidecar], offered.pathForFile)).toEqual([
      "/photos/photo.jpg",
      "/photos/photo.fotoready.json"
    ]);
  });

  it("rejects text/URL drags, remote Files, and unsupported local files", () => {
    const remote = file("remote.jpg");
    const gif = file("animation.gif");
    expect(acceptsLocalFileDrag(transfer([], ["text/uri-list", "text/plain"]).dataTransfer, () => "")).toBe(false);
    expect(acceptsLocalFileDrag(transfer([{ file: remote, path: "" }]).dataTransfer, () => "")).toBe(false);
    const unsupported = transfer([{ file: gif, path: "/photos/animation.gif" }]);
    expect(acceptsLocalFileDrag(unsupported.dataTransfer, unsupported.pathForFile)).toBe(false);
  });

  it("fails closed when a malformed drag item cannot expose its file", () => {
    const dataTransfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => { throw new Error("unavailable"); } }]
    } as unknown as DataTransfer;

    expect(acceptsLocalFileDrag(dataTransfer, () => "/photos/photo.jpg")).toBe(false);
  });

  it("keeps only unique, supported paths and fails closed when provenance lookup throws", () => {
    const first = file("one.PNG");
    const duplicate = file("duplicate.png");
    const inaccessible = file("two.jpg");
    const paths = new Map<File, string>([
      [first, "C:\\Photos\\one.PNG"],
      [duplicate, "C:\\Photos\\one.PNG"]
    ]);

    expect(localImportPaths([first, duplicate, inaccessible], (candidate) => {
      if (candidate === inaccessible) throw new Error("not a local file");
      return paths.get(candidate) ?? "";
    })).toEqual(["C:\\Photos\\one.PNG"]);
  });
});

describe("DropHighlightLease", () => {
  it("renews one lease and independently clears a cancelled OS drag", () => {
    const changes: boolean[] = [];
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;
    const lease = new DropHighlightLease(
      (active) => changes.push(active),
      (callback) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      (handle) => callbacks.delete(handle),
      10
    );

    lease.renew();
    lease.renew();
    expect(changes).toEqual([true]);
    expect([...callbacks.keys()]).toEqual([2]);

    callbacks.get(2)!(); // no drop, leave, or dragend: the renewable lease expires
    expect(changes).toEqual([true, false]);
    expect(callbacks.size).toBe(0);
  });

  it("clears synchronously on ordinary leave/drop cleanup", () => {
    const changes: boolean[] = [];
    const callbacks = new Map<number, () => void>();
    const lease = new DropHighlightLease(
      (active) => changes.push(active),
      (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      (handle) => callbacks.delete(handle)
    );

    lease.renew();
    lease.clear();
    expect(changes).toEqual([true, false]);
    expect(callbacks.size).toBe(0);
  });

  it("disposes without publishing a state update during unmount", () => {
    const changes: boolean[] = [];
    const callbacks = new Map<number, () => void>();
    const lease = new DropHighlightLease(
      (active) => changes.push(active),
      (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      (handle) => callbacks.delete(handle)
    );

    lease.renew();
    lease.dispose();
    expect(changes).toEqual([true]);
    expect(callbacks.size).toBe(0);
  });
});
