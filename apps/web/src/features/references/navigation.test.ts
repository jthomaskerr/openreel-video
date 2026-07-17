import { describe, expect, it } from "vitest";
import type { MediaItem } from "@openreel/core";

import {
  type ReferenceEditorRoute,
  referencePlacementFromEvent,
  resolveReferenceEditorRoute,
} from "./navigation";

interface TestClip {
  id: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

interface TestTrack {
  id: string;
  clips: readonly TestClip[];
}

interface TestDefinition {
  id: string;
  currentMediaVersionId?: string | null;
}

function image(
  id: string,
  overrides: Partial<Omit<MediaItem, "thumbnailUrl">> & {
    thumbnailUrl?: string | null;
  } = {},
): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 1024,
      height: 1024,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
    ...overrides,
    thumbnailUrl: overrides.thumbnailUrl ?? null,
  };
}

function snapshot(input: {
  readonly mediaItems?: readonly MediaItem[];
  readonly tracks?: readonly TestTrack[];
  readonly definitions?: readonly TestDefinition[];
} = {}) {
  const mediaItems = [...(input.mediaItems ?? [])];

  return {
    project: {
      timeline: {
        tracks: [...(input.tracks ?? [])],
      },
      generatedImageDefinitions: [...(input.definitions ?? [])],
    },
    getMediaItem(mediaId: string) {
      return mediaItems.find((item) => item.id === mediaId);
    },
  };
}

function expectRoute<TEditor extends ReferenceEditorRoute["editor"]>(
  route: ReferenceEditorRoute,
  editor: TEditor,
): Extract<ReferenceEditorRoute, { editor: TEditor }> {
  expect(route.editor).toBe(editor);
  return route as Extract<ReferenceEditorRoute, { editor: TEditor }>;
}

describe("reference navigation", () => {
  it("routes a normal click to the modal and a Shift-click to the inspector", () => {
    expect(referencePlacementFromEvent({ shiftKey: false })).toBe("modal");
    expect(referencePlacementFromEvent({ shiftKey: true })).toBe("inspector");
  });

  it("opens the character editor by stable character id and matching character clip", () => {
    const route = resolveReferenceEditorRoute(
      snapshot({
        tracks: [
          {
            id: "track-1",
            clips: [
              {
                id: "clip-character-1",
                type: "metadata",
                metadata: {
                  kind: "character",
                  characterId: "character-1",
                },
              },
            ],
          },
        ],
      }),
      { kind: "character", id: "character-1" },
    );

    const characterRoute = expectRoute(route, "character");
    expect(characterRoute.characterId).toBe("character-1");
    expect(characterRoute.clipId).toBe("clip-character-1");
    expect(characterRoute.trackId).toBe("track-1");
  });

  it("selects the generated-image editor when a referenced image belongs to a generated definition", () => {
    const route = resolveReferenceEditorRoute(
      snapshot({
        mediaItems: [image("media-generated-1", { title: "Generated still" })],
        definitions: [
          {
            id: "definition-1",
            currentMediaVersionId: "media-generated-1",
          },
        ],
      }),
      { kind: "imported-image", mediaId: "media-generated-1" },
    );

    const generatedRoute = expectRoute(route, "generated-image");
    expect(generatedRoute.definitionId).toBe("definition-1");
    expect(generatedRoute.mediaId).toBe("media-generated-1");
  });

  it("keeps imported images on the image inspector when they are not backed by a generated definition", () => {
    const route = resolveReferenceEditorRoute(
      snapshot({
        mediaItems: [image("media-imported-1", { title: "Mood board" })],
      }),
      { kind: "imported-image", mediaId: "media-imported-1" },
    );

    const importedRoute = expectRoute(route, "imported-image");
    expect(importedRoute.mediaId).toBe("media-imported-1");
  });

  it("returns structured recovery for missing targets instead of guessing a replacement", () => {
    const missingMedia = resolveReferenceEditorRoute(
      snapshot(),
      { kind: "imported-image", mediaId: "media-missing-1" },
    );
    const missingCharacter = resolveReferenceEditorRoute(
      snapshot(),
      { kind: "character", id: "character-missing-1" },
    );
    const unresolvedPill = resolveReferenceEditorRoute(
      snapshot(),
      { kind: "missing", token: "@{character:character-missing-1}" },
    );

    expect(expectRoute(missingMedia, "missing").issue).toMatchObject({
      code: "MEDIA_NOT_FOUND",
      details: { mediaId: "media-missing-1" },
    });
    expect(expectRoute(missingCharacter, "missing").issue).toMatchObject({
      code: "CHARACTER_CLIP_NOT_FOUND",
      details: { characterId: "character-missing-1" },
    });
    expect(expectRoute(unresolvedPill, "missing").issue).toMatchObject({
      code: "UNRESOLVED_REFERENCE",
      details: { token: "@{character:character-missing-1}" },
    });
  });

  it("returns structured recovery when a generated-image definition disappears", () => {
    const route = resolveReferenceEditorRoute(
      snapshot({
        mediaItems: [image("media-generated-1")],
      }),
      { kind: "generated-image", definitionId: "definition-missing-1" },
    );

    expect(expectRoute(route, "missing").issue).toMatchObject({
      code: "DEFINITION_NOT_FOUND",
      details: { definitionId: "definition-missing-1" },
    });
  });
});
