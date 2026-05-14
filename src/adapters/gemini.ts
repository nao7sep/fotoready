import { GoogleGenAI } from "@google/genai";
import { normalizeSlugCandidate } from "@core/slug/rules";

export type VisionDescribeRequest = {
  imageBytes: Buffer;
  mimeType: "image/jpeg";
};

export type VisionDescribeOptions = {
  model: string;
  projectContext: string | null;
  customPromptAddendum: string | null;
};

export type VisionDescribeResult = {
  description: string;
  slugCandidates: string[];
};

export class GeminiVisionProvider {
  constructor(private readonly apiKey: string) {}

  async describe(request: VisionDescribeRequest, opts: VisionDescribeOptions): Promise<VisionDescribeResult> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const response = await ai.models.generateContent({
      model: opts.model,
      contents: [
        { inlineData: { mimeType: request.mimeType, data: request.imageBytes.toString("base64") } },
        { text: describePrompt(opts) }
      ],
      config: { responseMimeType: "application/json" }
    });
    return parseDescribe(response.text ?? "");
  }
}

function describePrompt(opts: VisionDescribeOptions): string {
  const context = opts.projectContext ? `Project context: ${opts.projectContext}\n` : "";
  const addendum = opts.customPromptAddendum ? `Additional instruction: ${opts.customPromptAddendum}\n` : "";
  return `${context}${addendum}Describe this publication image. Return strict JSON only: {"description":"...","slugs":["..."]}.

Rules:
- description is one factual sentence naming subject, setting, and notable detail.
- slugs has 3 to 5 candidates ordered short to longer/specific.
- each slug is 4 to 7 lowercase English words joined by hyphens.
- use concrete nouns and verbs only.
- avoid filler words such as photo, image, view, and shot.
- allowed slug characters are a-z, 0-9, and hyphen.`;
}

function parseDescribe(raw: string): VisionDescribeResult {
  const parsed = JSON.parse(raw) as { description?: unknown; slugs?: unknown; slugCandidates?: unknown };
  const slugs = Array.isArray(parsed.slugs) ? parsed.slugs : parsed.slugCandidates;
  if (typeof parsed.description !== "string" || !Array.isArray(slugs)) {
    throw new Error("Vision provider returned an invalid describe response.");
  }
  return {
    description: parsed.description.trim(),
    slugCandidates: slugs.map((slug) => normalizeSlugCandidate(String(slug))).filter(Boolean).slice(0, 5)
  };
}
