import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertArray, assertOneOf, assertParamsShape } from "./_shared";
import type { MetadataField, MetadataStripMode } from "@shared/types/settings";

const METADATA_FIELDS = ["author", "copyright", "orientation", "colorspace"] as const satisfies readonly MetadataField[];

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
  defaultParams: { keep: [...METADATA_FIELDS] },
  validate(value) {
    const record = assertParamsShape(value, ["keep"], "strip-metadata.params");
    const fields = assertArray(record.keep, "strip-metadata.params.keep").map((field, index) =>
      assertOneOf(field, `strip-metadata.params.keep[${index}]`, METADATA_FIELDS)
    );
    return { keep: [...new Set(fields)] };
  },
  contributeMetadata(params, decision) {
    decision.keep = params.keep;
  }
};

registerOp(stripMetadataModule);
