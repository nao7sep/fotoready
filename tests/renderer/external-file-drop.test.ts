import { describe, expect, it } from "vitest";
import {
  DropHighlightLease,
  denyUnhandledExternalDrop,
  inspectImportFileDragOffer,
  localDropFiles,
} from "@renderer/external-file-drop";

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
  it("keeps a supported-name candidate neutral until Electron exposes its local path", () => {
    const jpeg = file("photo.jpg");
    const sidecar = file("photo.fotoready.json");
    const offered = transfer([
      { file: jpeg, path: "/photos/photo.jpg" },
      { file: sidecar, path: "/photos/photo.fotoready.json" }
    ]);

    expect(inspectImportFileDragOffer(offered.dataTransfer)).toBe("delivery-only");
    expect(localDropFiles([jpeg, sidecar], () => "")).toEqual({
      paths: [],
      inaccessibleNames: ["photo.jpg", "photo.fotoready.json"],
    });
    expect(localDropFiles([jpeg, sidecar], offered.pathForFile)).toEqual({
      paths: ["/photos/photo.jpg", "/photos/photo.fotoready.json"],
      inaccessibleNames: [],
    });
  });

  it("rejects URL/non-file offers but delivers unsupported files for committed feedback", () => {
    const gif = file("animation.gif");
    expect(inspectImportFileDragOffer(transfer([], ["text/uri-list", "text/plain"]).dataTransfer)).toBe("rejected");
    expect(inspectImportFileDragOffer({
      types: ["Files"],
      items: [{ kind: "string", getAsFile: () => null }]
    } as unknown as DataTransfer)).toBe("rejected");
    const unsupported = transfer([{ file: gif, path: "/photos/animation.gif" }]);
    expect(inspectImportFileDragOffer(unsupported.dataTransfer)).toBe("delivery-only");
  });

  it("allows protected Finder file data to reach drop without claiming accepted support", () => {
    expect(inspectImportFileDragOffer({ types: ["Files"], items: [] } as unknown as DataTransfer)).toBe(
      "delivery-only"
    );
    expect(inspectImportFileDragOffer({
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => null }]
    } as unknown as DataTransfer)).toBe("delivery-only");
  });

  it("rejects a supported candidate at drop when Electron cannot prove a local path", () => {
    const remote = file("remote.jpg");
    const offered = transfer([{ file: remote, path: "" }]);

    expect(inspectImportFileDragOffer(offered.dataTransfer)).toBe("delivery-only");
    expect(localDropFiles([remote], offered.pathForFile)).toEqual({
      paths: [],
      inaccessibleNames: ["remote.jpg"],
    });
  });

  it("treats an inaccessible file item as protected delivery-only data", () => {
    const dataTransfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => { throw new Error("unavailable"); } }]
    } as unknown as DataTransfer;

    expect(inspectImportFileDragOffer(dataTransfer)).toBe("delivery-only");
  });

  it("keeps only unique, supported paths and fails closed when provenance lookup throws", () => {
    const first = file("one.PNG");
    const duplicate = file("duplicate.png");
    const inaccessible = file("two.jpg");
    const paths = new Map<File, string>([
      [first, "C:\\Photos\\one.PNG"],
      [duplicate, "C:\\Photos\\one.PNG"]
    ]);

    expect(localDropFiles([first, duplicate, inaccessible], (candidate) => {
      if (candidate === inaccessible) throw new Error("not a local file");
      return paths.get(candidate) ?? "";
    })).toEqual({
      paths: ["C:\\Photos\\one.PNG"],
      inaccessibleNames: ["two.jpg"],
    });
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

describe("desktop drop boundary", () => {
  it("denies unowned data without overriding an owned import", () => {
    const unowned = {
      defaultPrevented: false,
      preventDefault(this: { defaultPrevented: boolean }) {
        this.defaultPrevented = true;
      },
      dataTransfer: { dropEffect: "copy" },
    } as unknown as DragEvent;
    denyUnhandledExternalDrop(unowned);
    expect(unowned.defaultPrevented).toBe(true);
    expect(unowned.dataTransfer?.dropEffect).toBe("none");

    const owned = {
      defaultPrevented: true,
      preventDefault() {},
      dataTransfer: { dropEffect: "copy" },
    } as unknown as DragEvent;
    denyUnhandledExternalDrop(owned);
    expect(owned.dataTransfer?.dropEffect).toBe("copy");

    const editableText = {
      defaultPrevented: false,
      preventDefault(this: { defaultPrevented: boolean }) {
        this.defaultPrevented = true;
      },
      target: { closest: () => ({}) },
      dataTransfer: { types: ["text/plain"], dropEffect: "copy" },
    } as unknown as DragEvent;
    denyUnhandledExternalDrop(editableText);
    expect(editableText.defaultPrevented).toBe(false);

    const editableFileItem = {
      defaultPrevented: false,
      preventDefault(this: { defaultPrevented: boolean }) {
        this.defaultPrevented = true;
      },
      target: { closest: () => ({}) },
      dataTransfer: { types: [], items: [{ kind: "file" }], dropEffect: "copy" },
    } as unknown as DragEvent;
    denyUnhandledExternalDrop(editableFileItem);
    expect(editableFileItem.defaultPrevented).toBe(true);
  });
});
