import { describe, expect, it } from "vitest";
import type { MediaItem } from "@openreel/core";
import {
  canonicalCharacterToken,
  canonicalMediaToken,
} from "./resolve";
import { resolveProjectGenerationReferences } from "./project-resolution";

function image(id: string, assetGroupId: string): MediaItem {
  return {
    id,
    assetGroupId,
    isCurrent: true,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: new Blob([id], { type: "image/png" }),
    metadata: {
      duration: 0,
      width: 1,
      height: 1,
      frameRate: 0,
      codec: "image/png",
      sampleRate: 0,
      channels: 0,
      fileSize: id.length,
    },
    thumbnailUrl: null,
  };
}

describe("resolveProjectGenerationReferences", () => {
  it("derives stable resolver IDs, typed navigation targets, and submission metadata from live project identity", () => {
    const imported = image("version-imported", "asset-imported");
    const generated = image("version-generated", "asset-generated");
    const character = image("version-character", "asset-character");
    const prompt = [
      canonicalMediaToken(imported.id),
      canonicalMediaToken(generated.id),
      canonicalCharacterToken("character-1"),
    ].join(" ");

    const result = resolveProjectGenerationReferences({
      prompt,
      mediaItems: [imported, generated, character],
      generatedImageDefinitions: [
        { id: "definition-1", assetGroupId: "asset-generated", currentMediaVersionId: generated.id },
      ],
      tracks: [
        {
          clips: [
            {
              type: "metadata",
              metadata: {
                kind: "character",
                characterId: "character-1",
                slug: "hero",
                displayName: "Hero",
                primaryImageMediaId: "asset-character",
                primaryImageVersionId: character.id,
              },
            },
          ],
        },
      ],
      roleByReferenceKey: {
        "reference:version-imported": "style",
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.referenceIds).toEqual([
      "reference:version-imported",
      "reference:version-generated",
      "reference:version-character",
    ]);
    expect(result.referenceTargets).toEqual({
      "reference:version-imported": { kind: "imported-image", mediaId: imported.id },
      "reference:version-generated": { kind: "generated-image", definitionId: "definition-1" },
      "reference:version-character": { kind: "character", id: "character-1" },
    });
    expect(result.references).toEqual([
      expect.objectContaining({
        key: "reference:version-imported",
        mediaId: "asset-imported",
        mediaVersionId: imported.id,
        role: "style",
        canonicalTokens: [canonicalMediaToken(imported.id)],
        order: 0,
      }),
      expect.objectContaining({ key: "reference:version-generated", order: 1 }),
      expect.objectContaining({
        key: "reference:version-character",
        origins: ["character"],
        canonicalTokens: [canonicalCharacterToken("character-1")],
        order: 2,
      }),
    ]);
    expect(result.submissionReferences).toEqual([
      expect.objectContaining({
        key: "reference:version-imported",
        origins: ["user"],
        role: "style",
        canonicalTokens: [canonicalMediaToken(imported.id)],
        order: 0,
      }),
      expect.objectContaining({ key: "reference:version-generated", origins: ["user"] }),
      expect.objectContaining({ key: "reference:version-character", origins: ["character"] }),
    ]);
  });
});
