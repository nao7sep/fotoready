export type VisionInput = {
  imageBytes: Buffer;
  mimeType: "image/jpeg";
};

export type VisionOptions = {
  model: string;
  projectContext: string | null;
  customPromptAddendum: string | null;
};

export type VisionDescribe = {
  description: string;
  slugCandidates: string[];
};

export type SlugInput = {
  description: string;
  currentStagedFilename: string;
  conflictsWith: string[];
};

export type SlugOptions = VisionOptions & {
  registerHint: string;
};

export interface VisionProvider {
  describe(input: VisionInput, opts: VisionOptions): Promise<VisionDescribe>;
  resolveSlugs(items: SlugInput[], opts: SlugOptions): Promise<string[]>;
}
