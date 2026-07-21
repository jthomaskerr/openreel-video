import type {
  MediaItem,
  PromptReferenceDiagnostic,
  ReferenceTarget,
  ResolvedGenerationReference,
} from "@openreel/core";
import type { ProjectCharacter } from "../context";
import type { GenerationReferenceDraft } from "../submit-generation";
import {
  resolveGenerationReferences,
  type ReferenceCandidate,
} from "./resolve";

interface GeneratedImageIdentity {
  readonly id: string;
  readonly assetGroupId: string;
  readonly currentMediaVersionId?: string;
}

interface ReferenceMetadataClip {
  readonly type?: string;
  readonly metadata?: Record<string, unknown>;
}

interface ReferenceMetadataTrack {
  readonly clips?: readonly ReferenceMetadataClip[];
}

export interface ResolveProjectGenerationReferencesInput {
  readonly prompt: string;
  readonly mediaItems: readonly MediaItem[];
  readonly generatedImageDefinitions: readonly GeneratedImageIdentity[];
  readonly tracks: readonly ReferenceMetadataTrack[];
  readonly source?: ReferenceCandidate;
  readonly shotReferences?: readonly ReferenceCandidate[];
  readonly roleByReferenceKey?: Readonly<Record<string, string>>;
}

export interface ProjectGenerationReferenceResolution {
  readonly references: readonly ResolvedGenerationReference[];
  readonly submissionReferences: readonly GenerationReferenceDraft[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
  readonly referenceIds: string[];
  readonly referenceTargets: Record<string, ReferenceTarget>;
}

function stringField(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function projectCharacters(tracks: readonly ReferenceMetadataTrack[]): ProjectCharacter[] {
  const byId = new Map<string, ProjectCharacter>();
  for (const track of tracks) {
    for (const clip of track.clips ?? []) {
      const metadata = clip.metadata;
      if (clip.type !== "metadata" || metadata?.kind !== "character") continue;
      const id = stringField(metadata, "characterId");
      const slug = stringField(metadata, "slug");
      const displayName = stringField(metadata, "displayName");
      if (!id || !slug || !displayName || byId.has(id)) continue;
      byId.set(id, {
        id,
        slug,
        displayName,
        ...(stringField(metadata, "primaryImageMediaId")
          ? { primaryImageMediaId: stringField(metadata, "primaryImageMediaId") }
          : {}),
        ...(stringField(metadata, "primaryImageVersionId")
          ? { primaryImageVersionId: stringField(metadata, "primaryImageVersionId") }
          : {}),
      });
    }
  }
  return [...byId.values()];
}

function missingReferenceKey(token: string, start: number): string {
  const media = /^@\{media:([^}]+)\}$/.exec(token);
  if (media?.[1]) return `reference:${media[1]}`;
  const character = /^@\{character:([^}]+)\}$/.exec(token);
  if (character?.[1]) return `reference:character:${character[1]}`;
  return `reference:missing:${start}`;
}

export function resolveProjectGenerationReferences(
  input: ResolveProjectGenerationReferencesInput,
): ProjectGenerationReferenceResolution {
  const characters = projectCharacters(input.tracks);
  const imageItems = input.mediaItems.filter((item) => item.type === "image");
  const resolution = resolveGenerationReferences({
    prompt: input.prompt,
    characters,
    mediaVersions: imageItems.map((item) => ({
      mediaId: item.assetGroupId ?? item.id,
      versionId: item.id,
      accessible: Boolean(item.blob || item.remoteUrl || item.fileHandle),
    })),
    shotReferences: input.shotReferences ?? [],
    roleByReferenceKey: input.roleByReferenceKey ?? {},
    ...(input.source ? { source: input.source } : {}),
  });
  const referenceTargets: Record<string, ReferenceTarget> = {};

  for (const reference of resolution.references) {
    if (reference.origins.includes("character")) {
      const character = characters.find((candidate) =>
        candidate.primaryImageMediaId === reference.mediaId
        && candidate.primaryImageVersionId === reference.mediaVersionId);
      referenceTargets[reference.key] = character
        ? { kind: "character", id: character.id }
        : { kind: "missing", token: reference.canonicalTokens[0] ?? reference.key };
      continue;
    }
    const definitions = input.generatedImageDefinitions.filter((definition) =>
      definition.assetGroupId === reference.mediaId);
    if (definitions.length === 1) {
      referenceTargets[reference.key] = {
        kind: "generated-image",
        definitionId: definitions[0]!.id,
      };
      continue;
    }
    const media = imageItems.find((item) =>
      item.id === reference.mediaVersionId
      && (item.assetGroupId ?? item.id) === reference.mediaId);
    referenceTargets[reference.key] = media
      ? { kind: "imported-image", mediaId: media.id }
      : { kind: "missing", token: reference.canonicalTokens[0] ?? reference.key };
  }

  const referenceIds = resolution.references.map((reference) => reference.key);
  for (const diagnostic of resolution.diagnostics) {
    const token = input.prompt.slice(diagnostic.start, diagnostic.end);
    const key = missingReferenceKey(token, diagnostic.start);
    if (referenceTargets[key]) continue;
    referenceIds.push(key);
    referenceTargets[key] = { kind: "missing", token };
  }

  return {
    references: resolution.references,
    submissionReferences: resolution.references.map((reference) => ({
      ...reference,
      origins: reference.origins.map((origin) => origin === "prompt-media" ? "user" : origin),
    })),
    diagnostics: resolution.diagnostics,
    referenceIds,
    referenceTargets,
  };
}
