export type SourceJpegFacts = {
  jpegQualityEstimate: { value: number; method: "metadata" | "dqt-match" } | null;
};

export function detectJpegQuality(_bytes: Buffer): SourceJpegFacts {
  return {
    jpegQualityEstimate: null
  };
}
