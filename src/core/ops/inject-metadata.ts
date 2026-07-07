import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertParamsShape, assertRecord, assertString } from "./_shared";
import { EDITABLE_METADATA_FIELDS, type MetadataFields } from "@shared/types/settings";

type InjectMetadataParams = {
  fields: MetadataFields;
};

const injectMetadataModule: OpModule<InjectMetadataParams> = {
  type: "inject-metadata",
  label: "Inject metadata",
  pickerLabel: "Inject",
  category: "Metadata",
  previewBehavior: "show-output",
  metadataOnly: true,
  defaultParams: { fields: {} },
  validate(value) {
    const record = assertParamsShape(value, ["fields"], "inject-metadata.params");
    const fieldsRecord = assertRecord(record.fields, "inject-metadata.params.fields");
    const fields: MetadataFields = {};
    for (const key of EDITABLE_METADATA_FIELDS) {
      if (fieldsRecord[key] === undefined) continue;
      const value = assertString(fieldsRecord[key], `inject-metadata.params.fields.${key}`);
      if (value) fields[key] = value;
    }
    return {
      fields
    };
  },
  contributeMetadata(params, decision) {
    decision.inject = { ...decision.inject, ...params.fields };
  }
};

registerOp(injectMetadataModule);
