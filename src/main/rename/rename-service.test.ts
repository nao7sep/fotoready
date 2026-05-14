import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createEmptyProject, defaultGlobalSettings } from "@shared/defaults";
import { previewRename } from "./rename-service";

describe("previewRename", () => {
  it("rejects invalid selected templates", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-rename-test-"));
    try {
      const sourcePath = path.join(tempDir, "source.png");
      const stagedPath = path.join(tempDir, "staged.png");
      await sharp({ create: { width: 4, height: 3, channels: 3, background: "#00ff00" } }).png().toFile(sourcePath);
      await fs.copyFile(sourcePath, stagedPath);

      const project = createEmptyProject(tempDir, {});
      project.originals.push({
        id: "original-1",
        sourcePath,
        sourceHash: "source-hash",
        size: 12,
        format: "png",
        width: 4,
        height: 3,
        addedAt: "2026-05-12T09:10:11.000Z"
      });
      project.tasks.push({
        id: "task-1",
        originalId: "original-1",
        analyzeContent: true,
        outputFormatOverride: null,
        outputQualityOverride: null,
        metadataStripOverride: null,
        customSlug: null,
        pipeline: {
          specVersion: 1,
          ops: [],
          output: {
            format: "png",
            quality: 82,
            jpegProgressive: true,
            jpegChromaSubsampling: "4:2:0",
            webpMethod: 4,
            avifEffort: 4,
            pngPalette: false,
            backgroundForTransparency: "#ffffff",
            iccOutput: "tag-srgb"
          },
          appliedColorNormalization: null,
          sourceSnapshot: null,
          toolVersions: null
        },
        status: "done",
        output: {
          stagedPath,
          stagedAt: "2026-05-12T09:10:11.000Z",
          outputHash: "abcdef1234567890",
          vision: {
            description: "green square",
            slugCandidates: ["green-square"],
            model: "gemini-test",
            ranAt: "2026-05-12T09:10:11.000Z"
          },
          finalPath: null,
          renamedAt: null
        },
        error: null,
        createdAt: "2026-05-12T09:10:11.000Z",
        updatedAt: "2026-05-12T09:10:11.000Z"
      });

      const settings = defaultGlobalSettings("UTC", 1);
      settings.filenameTemplates = [
        ...settings.filenameTemplates,
        { id: "bad-template", name: "Bad template", pattern: "{slug}/bad.{ext}" }
      ];

      await expect(previewRename(project, settings, "bad-template")).rejects.toThrow(
        'Template "Bad template" is invalid: must not include path separators outside placeholders.'
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
