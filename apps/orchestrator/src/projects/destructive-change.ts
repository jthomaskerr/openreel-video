import type { Project } from "@openreel/core";

export const MAX_UNCONFIRMED_MEDIA_COUNT_DROP = 3;
export const MAX_UNCONFIRMED_CLIP_COUNT_DROP = 3;
export const MAX_UNCONFIRMED_TRACK_COUNT_DROP = 1;
export const MAX_UNCONFIRMED_SERIALIZED_STRUCTURAL_SIZE_DROP = 16 * 1024;

export interface StructuralMetrics {
  readonly mediaCount: number;
  readonly clipCount: number;
  readonly trackCount: number;
  readonly serializedStructuralSize: number;
}

export interface StructuralMetricDeltas {
  readonly mediaCountDelta: number;
  readonly clipCountDelta: number;
  readonly trackCountDelta: number;
  readonly serializedStructuralSizeDelta: number;
}

export interface DependentClipReference {
  readonly clipId: string;
  readonly mediaId: string;
  readonly trackId: string;
}

export interface ServerRemovalManifest {
  readonly removedMediaIds: readonly string[];
  readonly removedClipIds: readonly string[];
  readonly removedTrackIds: readonly string[];
  readonly dependentClipReferences: readonly DependentClipReference[];
}

export interface DestructiveChangeAssessment {
  readonly current: StructuralMetrics;
  readonly proposed: StructuralMetrics;
  readonly deltas: StructuralMetricDeltas;
  readonly protected: boolean;
  readonly removals: ServerRemovalManifest;
}

export interface DestructiveChangeAuthorization {
  readonly saveIntent?: "autosave" | "user" | "retry" | "recovery";
  readonly destructiveIntent?: boolean;
  readonly serverRemovalManifest?: ServerRemovalManifest;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clips(project: Project) {
  return project.timeline.tracks.flatMap((track) => track.clips);
}

/**
 * Measures only persisted project structure. Identity, display metadata and
 * timestamps are excluded so routine edits cannot manufacture a size signal.
 */
export function structuralMetrics(project: Project): StructuralMetrics {
  const structure = {
    mediaLibrary: project.mediaLibrary,
    timeline: project.timeline,
    textClips: project.textClips ?? [],
    shapeClips: project.shapeClips ?? [],
    svgClips: project.svgClips ?? [],
    stickerClips: project.stickerClips ?? [],
  };
  return {
    mediaCount: project.mediaLibrary.items.length,
    clipCount: clips(project).length,
    trackCount: project.timeline.tracks.length,
    serializedStructuralSize: Buffer.byteLength(JSON.stringify(structure), "utf8"),
  };
}

export function crossesDestructiveThreshold(deltas: StructuralMetricDeltas): boolean {
  return deltas.mediaCountDelta < -MAX_UNCONFIRMED_MEDIA_COUNT_DROP
    || deltas.clipCountDelta < -MAX_UNCONFIRMED_CLIP_COUNT_DROP
    || deltas.trackCountDelta < -MAX_UNCONFIRMED_TRACK_COUNT_DROP
    || deltas.serializedStructuralSizeDelta < -MAX_UNCONFIRMED_SERIALIZED_STRUCTURAL_SIZE_DROP;
}

function removalManifest(current: Project, proposed: Project): ServerRemovalManifest {
  const proposedMediaIds = new Set(proposed.mediaLibrary.items.map((item) => item.id));
  const proposedTrackIds = new Set(proposed.timeline.tracks.map((track) => track.id));
  const proposedClipIds = new Set(clips(proposed).map((clip) => clip.id));
  const removedClips = clips(current).filter((clip) => !proposedClipIds.has(clip.id));
  const removedMediaIds = new Set(current.mediaLibrary.items.filter((item) => !proposedMediaIds.has(item.id)).map((item) => item.id));
  const removedTrackIds = new Set(current.timeline.tracks.filter((track) => !proposedTrackIds.has(track.id)).map((track) => track.id));
  const dependentClips = clips(current).filter((clip) => !proposedClipIds.has(clip.id)
    || removedMediaIds.has(clip.mediaId)
    || removedTrackIds.has(clip.trackId));
  return {
    removedMediaIds: sorted(removedMediaIds),
    removedClipIds: sorted(removedClips.map((clip) => clip.id)),
    removedTrackIds: sorted(removedTrackIds),
    dependentClipReferences: dependentClips
      .map((clip) => ({ clipId: clip.id, mediaId: clip.mediaId, trackId: clip.trackId }))
      .sort((left, right) => compareStrings(left.clipId, right.clipId)
        || compareStrings(left.mediaId, right.mediaId)
        || compareStrings(left.trackId, right.trackId)),
  };
}

export function assessDestructiveChange(current: Project, proposed: Project): DestructiveChangeAssessment {
  const currentMetrics = structuralMetrics(current);
  const proposedMetrics = structuralMetrics(proposed);
  const deltas: StructuralMetricDeltas = {
    mediaCountDelta: proposedMetrics.mediaCount - currentMetrics.mediaCount,
    clipCountDelta: proposedMetrics.clipCount - currentMetrics.clipCount,
    trackCountDelta: proposedMetrics.trackCount - currentMetrics.trackCount,
    serializedStructuralSizeDelta: proposedMetrics.serializedStructuralSize - currentMetrics.serializedStructuralSize,
  };
  return {
    current: currentMetrics,
    proposed: proposedMetrics,
    deltas,
    protected: crossesDestructiveThreshold(deltas),
    removals: removalManifest(current, proposed),
  };
}

function canonicalManifest(manifest: ServerRemovalManifest): string {
  return JSON.stringify({
    removedMediaIds: sorted(manifest.removedMediaIds),
    removedClipIds: sorted(manifest.removedClipIds),
    removedTrackIds: sorted(manifest.removedTrackIds),
    dependentClipReferences: [...manifest.dependentClipReferences]
      .map(({ clipId, mediaId, trackId }) => ({ clipId, mediaId, trackId }))
      .sort((left, right) => compareStrings(left.clipId, right.clipId)
        || compareStrings(left.mediaId, right.mediaId)
        || compareStrings(left.trackId, right.trackId)),
  });
}

export function authorizeDestructiveChange(
  assessment: Pick<DestructiveChangeAssessment, "protected" | "deltas"> & Partial<Pick<DestructiveChangeAssessment, "removals">>,
  authorization: DestructiveChangeAuthorization,
): boolean {
  if (!assessment.protected) return true;
  if (authorization.saveIntent === "user" && authorization.destructiveIntent === true) return true;
  return assessment.removals !== undefined
    && authorization.serverRemovalManifest !== undefined
    && canonicalManifest(authorization.serverRemovalManifest) === canonicalManifest(assessment.removals);
}
