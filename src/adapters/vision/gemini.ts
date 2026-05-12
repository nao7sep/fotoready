import { GoogleGenAI } from "@google/genai";
import type { SlugInput, SlugOptions, VisionDescribe, VisionInput, VisionOptions, VisionProvider } from "./provider";
import { normalizeSlugCandidate } from "@core/slug/rules";

export class GeminiVisionProvider implements VisionProvider {
  constructor(private readonly apiKey: string) {}

  async describe(input: VisionInput, opts: VisionOptions): Promise<VisionDescribe> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const response = await ai.models.generateContent({
      model: opts.model,
      contents: [
        {
          inlineData: {
            mimeType: input.mimeType,
            data: input.imageBytes.toString("base64")
          }
        },
        { text: describePrompt(opts) }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    return parseDescribe(response.text ?? "");
  }

  async resolveSlugs(items: SlugInput[], opts: SlugOptions): Promise<string[]> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const response = await ai.models.generateContent({
      model: opts.model,
      contents: resolveSlugsPrompt(items, opts),
      config: {
        responseMimeType: "application/json"
      }
    });
    const parsed = JSON.parse(response.text ?? "{}") as { slugs?: unknown };
    if (!Array.isArray(parsed.slugs)) return [];
    return parsed.slugs.map((slug) => normalizeSlugCandidate(String(slug))).filter(Boolean);
  }
}

function describePrompt(opts: VisionOptions): string {
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

function resolveSlugsPrompt(items: SlugInput[], opts: SlugOptions): string {
  return `Resolve filename slug collisions. Return strict JSON only: {"slugs":["..."]}.
Register hint: ${opts.registerHint}
Project context: ${opts.projectContext ?? ""}
Items:
${JSON.stringify(items, null, 2)}

Rules:
- Return one slug per item in the same order.
- Avoid all conflictsWith values.
- Match the length and detail of the register hint.
- Lowercase a-z, 0-9, and hyphen only.`;
}

function parseDescribe(raw: string): VisionDescribe {
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
