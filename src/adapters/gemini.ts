import { GoogleGenAI } from "@google/genai";
import { normalizeSlugCandidate } from "@core/slug/rules";

export type VisionDescribeRequest = {
  imageBytes: Buffer;
  mimeType: "image/jpeg";
};

export type VisionDescribeOptions = {
  model: string;
  descriptionPrompt: string;
  slugPrompt: string;
  generateSlug: boolean;
};

export type VisionDescribeResult = {
  description: string;
  slugCandidates: string[];
};

export class GeminiVisionProvider {
  constructor(private readonly apiKey: string) {}

  async describe(request: VisionDescribeRequest, opts: VisionDescribeOptions): Promise<VisionDescribeResult> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const descriptionResponse = await ai.models.generateContent({
      model: opts.model,
      contents: [
        { inlineData: { mimeType: request.mimeType, data: request.imageBytes.toString("base64") } },
        { text: descriptionPrompt(opts.descriptionPrompt) }
      ]
    });
    const description = parseDescription(descriptionResponse.text ?? "");
    if (!opts.generateSlug) {
      return {
        description,
        slugCandidates: []
      };
    }
    const slugResponse = await ai.models.generateContent({
      model: opts.model,
      contents: [{ text: slugPrompt(description, opts.slugPrompt) }],
      config: { responseMimeType: "application/json" }
    });
    return {
      description,
      slugCandidates: parseSlugs(slugResponse.text ?? "")
    };
  }
}

function descriptionPrompt(prompt: string): string {
  return `${prompt.trim()}\n\nReturn one sentence only. Do not use bullet points or JSON.`;
}

function slugPrompt(description: string, prompt: string): string {
  return `${prompt.trim()}\n\nDescription: ${description}\n\nReturn strict JSON only: {"slugs":["..."]}.`;
}

function parseDescription(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("Vision provider returned an empty description response.");
  }
  return normalized;
}

function parseSlugs(raw: string): string[] {
  const parsed = JSON.parse(raw) as { slugs?: unknown; slugCandidates?: unknown };
  const slugs = Array.isArray(parsed.slugs) ? parsed.slugs : parsed.slugCandidates;
  if (!Array.isArray(slugs)) {
    throw new Error("Vision provider returned an invalid slug response.");
  }
  return slugs.map((slug) => normalizeSlugCandidate(String(slug))).filter(Boolean).slice(0, 5);
}
