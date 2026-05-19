import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertParamsShape, assertRecord, assertString } from "./_shared";

type InjectMetadataParams = {
  fields: Record<string, string>;
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
    return {
      fields: Object.fromEntries(
        Object.entries(fieldsRecord).map(([key, entry]) => [key, assertString(entry, `inject-metadata.params.fields.${key}`)])
      )
    };
  },
  contributeMetadata(params, decision) {
    decision.inject = { ...decision.inject, ...params.fields };
  }
};

registerOp(injectMetadataModule);
