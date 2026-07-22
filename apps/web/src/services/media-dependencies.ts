import type { Project } from "@openreel/core";
import type { MediaDependencySummary } from "./media-import-outcome";

export function findMediaDependencies(
  project: Project,
  mediaId: string,
): MediaDependencySummary {
  const timelineClipIds = project.timeline.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.mediaId === mediaId)
      .map((clip) => clip.id),
  );
  const protectedWorkflowReferences = project.generatedImageDefinitions.flatMap(
    (definition) => {
      const references: Array<{ type: string; id: string }> = [];
      if (definition.sourceMediaVersionId === mediaId) {
        references.push({ type: "generated-image-source", id: definition.id });
      }
      if (definition.currentMediaVersionId === mediaId) {
        references.push({ type: "generated-image-current", id: definition.id });
      }
      return references;
    },
  );

  return {
    mediaId,
    timelineClipIds,
    protectedWorkflowReferences,
    total: timelineClipIds.length + protectedWorkflowReferences.length,
  };
}
