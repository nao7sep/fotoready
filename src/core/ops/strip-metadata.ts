import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertArray, assertOneOf, assertParamsShape } from "./_shared";
import { METADATA_KEEP_GROUPS, type MetadataStripMode } from "@shared/types/settings";

type StripMetadataParams = {
  keep: MetadataStripMode;
};

const stripMetadataModule: OpModule<StripMetadataParams> = {
  type: "strip-metadata",
  label: "Strip metadata",
  pickerLabel: "Strip",
  category: "Metadata",
  previewBehavior: "show-output",
  metadataOnly: true,
  defaultParams: { keep: [] },
  validate(value) {
    const record = assertParamsShape(value, ["keep"], "strip-metadata.params");
    const fields: MetadataStripMode = assertArray(record.keep, "strip-metadata.params.keep").flatMap((field, index) => {
      if (field === "author" || field === "copyright") return ["editorial"];
      if (field === "orientation" || field === "colorspace") return [];
      return [assertOneOf(field, `strip-metadata.params.keep[${index}]`, METADATA_KEEP_GROUPS)];
    }) as MetadataStripMode;
    return { keep: [...new Set(fields)] };
  },
  contributeMetadata(params, decision) {
    decision.keep = params.keep;
  }
};

registerOp(stripMetadataModule);
