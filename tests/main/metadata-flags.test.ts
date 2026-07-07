import { describe, expect, it } from "vitest";
import { nextMetadataFlags, type MetadataFlags } from "@main/metadata-flags";

const flags = (generateDescription: boolean, generateSlug: boolean): MetadataFlags => ({
  generateDescription,
  generateSlug
});

describe("nextMetadataFlags", () => {
  describe("generateSlug change", () => {
    it("turning slug on forces description on", () => {
      expect(nextMetadataFlags(flags(false, false), { field: "generateSlug", value: true })).toEqual(
        flags(true, true)
      );
    });

    it("turning slug off leaves description as it was (on)", () => {
      expect(nextMetadataFlags(flags(true, true), { field: "generateSlug", value: false })).toEqual(
        flags(true, false)
      );
    });

    it("turning slug off leaves description as it was (off)", () => {
      expect(nextMetadataFlags(flags(false, true), { field: "generateSlug", value: false })).toEqual(
        flags(false, false)
      );
    });
  });

  describe("generateDescription change", () => {
    it("turning description on while slug is off", () => {
      expect(
        nextMetadataFlags(flags(false, false), { field: "generateDescription", value: true })
      ).toEqual(flags(true, false));
    });

    it("cannot clear description while slug is on", () => {
      expect(
        nextMetadataFlags(flags(true, true), { field: "generateDescription", value: false })
      ).toEqual(flags(true, true));
    });

    it("clears description when slug is off", () => {
      expect(
        nextMetadataFlags(flags(true, false), { field: "generateDescription", value: false })
      ).toEqual(flags(false, false));
    });
  });

  it("does not mutate the input flags", () => {
    const current = flags(false, false);
    nextMetadataFlags(current, { field: "generateSlug", value: true });
    expect(current).toEqual(flags(false, false));
  });
});
