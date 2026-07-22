import type { Project } from "../../types/project";
import type { Clip, Track } from "../../types/timeline";
import { projectRange } from "./project-range";
import { createTimebase, secondsToFrameIndex } from "./timebase";
import type {
  CompatibilityAssessment,
  CompatibilityIssue,
  CompatibilityIssueSeverity,
  HandoffEntityRef,
  HandoffSelection,
  HandoffTarget,
  HandoffTargetProfile,
  MediaAvailabilityHint,
  Timebase,
} from "./types";

export type CompatibilityClassification = "supported" | "info" | "blocking" | "target-dependent";

export const COMPATIBILITY_MATRIX = [
  { code: "handoff.multitrack", classification: "supported" },
  { code: "handoff.normal-speed-media", classification: "supported" },
  { code: "handoff.selected-range", classification: "supported" },
  { code: "handoff.hidden-video-excluded", classification: "info" },
  { code: "handoff.muted-audio-excluded", classification: "info" },
  { code: "handoff.missing-media", classification: "blocking" },
  { code: "handoff.invalid-frame-rate", classification: "blocking" },
  { code: "handoff.invalid-source-range", classification: "blocking" },
  { code: "handoff.zero-frame-segment", classification: "blocking" },
  { code: "handoff.unsupported-retime", classification: "target-dependent" },
  { code: "handoff.unsupported-picture-edit", classification: "target-dependent" },
  { code: "handoff.unsupported-audio-edit", classification: "target-dependent" },
  { code: "handoff.unsupported-transition", classification: "target-dependent" },
  { code: "handoff.unsupported-generated-content", classification: "target-dependent" },
  { code: "handoff.unknown-material-edit", classification: "target-dependent" },
] as const satisfies readonly { code: string; classification: CompatibilityClassification }[];

export interface AssessHandoffOptions {
  readonly mediaAvailability: ReadonlyMap<string, MediaAvailabilityHint>;
  readonly targetProfiles: ReadonlyMap<HandoffTarget, HandoffTargetProfile>;
  readonly now?: () => number;
}

const SEVERITY_ORDER: Record<CompatibilityIssueSeverity, number> = {
  blocking: 0,
  flattening: 1,
  info: 2,
};

export function sortCompatibilityIssues(issues: readonly CompatibilityIssue[]): CompatibilityIssue[] {
  return [...issues].sort((left, right) => {
    const leftTrack = left.entity.trackIndex ?? Number.MAX_SAFE_INTEGER;
    const rightTrack = right.entity.trackIndex ?? Number.MAX_SAFE_INTEGER;
    const leftFrame = left.entity.timelineFrame ?? Number.MAX_SAFE_INTEGER;
    const rightFrame = right.entity.timelineFrame ?? Number.MAX_SAFE_INTEGER;
    return (
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      leftTrack - rightTrack ||
      leftFrame - rightFrame ||
      left.entity.id.localeCompare(right.entity.id) ||
      left.code.localeCompare(right.code)
    );
  });
}

function stableDigest(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `assessment-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function projectEntity(project: Project): HandoffEntityRef {
  return { kind: "project", id: project.id, label: project.name, trackIndex: null, timelineFrame: null };
}

function trackEntity(track: Track, trackIndex: number): HandoffEntityRef {
  return { kind: "track", id: track.id, label: track.name, trackIndex, timelineFrame: null };
}

function clipEntity(clip: Clip, trackIndex: number, timebase: Timebase): HandoffEntityRef {
  return {
    kind: "clip",
    id: clip.id,
    label: clip.id,
    trackIndex,
    timelineFrame: Number.isFinite(clip.startTime) && clip.startTime >= 0 ? secondsToFrameIndex(clip.startTime, timebase) : null,
  };
}

function issue(
  code: string,
  severity: CompatibilityIssueSeverity,
  entity: HandoffEntityRef,
  message: string,
  action: string,
  retryable = false,
): CompatibilityIssue {
  return { code, severity, entity, message, action, retryable, details: {} };
}

function targetDependentSeverity(target: HandoffTarget): CompatibilityIssueSeverity {
  return target === "resolve" ? "blocking" : "flattening";
}

function hasPictureEdit(clip: Clip): boolean {
  const transform = clip.transform;
  return Boolean(
    (clip.effects?.length ?? 0) ||
      (clip.keyframes?.length ?? 0) ||
      clip.blendMode ||
      (clip.blendOpacity !== undefined && clip.blendOpacity !== 1) ||
      clip.stabilization ||
      (transform &&
        (transform.position.x !== 0.5 ||
          transform.position.y !== 0.5 ||
          transform.scale.x !== 1 ||
          transform.scale.y !== 1 ||
          transform.rotation !== 0 ||
          transform.opacity !== 1))
  );
}

function hasAudioEdit(clip: Clip): boolean {
  return Boolean(
    (clip.audioEffects?.length ?? 0) ||
      clip.automation ||
      clip.fade ||
      (clip.volume !== undefined && clip.volume !== 1),
  );
}

function safeTimebase(project: Project, issues: CompatibilityIssue[]): Timebase {
  try {
    return createTimebase(project.settings.frameRate);
  } catch {
    issues.push(
      issue(
        "handoff.invalid-frame-rate",
        "blocking",
        projectEntity(project),
        `Frame rate ${String(project.settings.frameRate)} cannot be represented safely.`,
        "Choose a supported integer or NTSC frame rate.",
      ),
    );
    return createTimebase(30);
  }
}

export function assessHandoff(
  project: Project,
  selection: HandoffSelection,
  options: AssessHandoffOptions,
): CompatibilityAssessment {
  const profile = options.targetProfiles.get(selection.target);
  if (!profile) throw new Error(`Unknown handoff target profile: ${selection.target}`);

  const issues: CompatibilityIssue[] = [];
  const timebase = safeTimebase(project, issues);

  if (selection.projectId !== project.id || selection.projectModifiedAt !== project.modifiedAt) {
    issues.push(
      issue(
        "handoff.stale-project",
        "blocking",
        projectEntity(project),
        "The project changed after this handoff selection was created.",
        "Assess the current project again.",
        true,
      ),
    );
  }

  let projection: ReturnType<typeof projectRange>;
  try {
    projection = projectRange(project, selection.range, timebase);
  } catch (cause) {
    issues.push(
      issue(
        "handoff.zero-frame-segment",
        "blocking",
        projectEntity(project),
        cause instanceof Error ? cause.message : "The selected range cannot be represented.",
        "Choose a range at least one frame long.",
      ),
    );
    projection = { frameRange: { startFrame: 0, endFrame: 1, durationFrames: 1 }, tracks: [], clips: [] };
  }

  project.timeline.tracks.forEach((track, trackIndex) => {
    if (track.type === "video" && track.hidden) {
      issues.push(
        issue(
          "handoff.hidden-video-excluded",
          "info",
          trackEntity(track, trackIndex),
          `${track.name} is hidden and will be excluded.`,
          "Show the track to include it.",
        ),
      );
    }
    if (track.type === "audio" && track.muted) {
      issues.push(
        issue(
          "handoff.muted-audio-excluded",
          "info",
          trackEntity(track, trackIndex),
          `${track.name} is muted and will be excluded.`,
          "Unmute the track to include it.",
        ),
      );
    }

    if (track.transitions.length > 0) {
      issues.push(
        issue(
          "handoff.unsupported-transition",
          targetDependentSeverity(selection.target),
          trackEntity(track, trackIndex),
          "Transitions cannot be represented in the editable Resolve contract.",
          selection.target === "resolve" ? "Remove transitions or choose iMovie MOV." : "Review the flattened MOV output.",
        ),
      );
    }

    for (const clip of track.clips) {
      const entity = clipEntity(clip, trackIndex, timebase);
      if ((clip.speed !== undefined && clip.speed !== 1) || clip.reversed || clip.smoothSlowMo) {
        issues.push(
          issue(
            "handoff.unsupported-retime",
            targetDependentSeverity(selection.target),
            entity,
            "This clip uses retiming that the editable Resolve contract cannot preserve.",
            selection.target === "resolve" ? "Reset clip speed or choose iMovie MOV." : "Review the flattened MOV output.",
          ),
        );
      }
      if (hasPictureEdit(clip)) {
        issues.push(
          issue(
            "handoff.unsupported-picture-edit",
            targetDependentSeverity(selection.target),
            entity,
            "This clip has picture edits that the editable Resolve contract cannot preserve.",
            selection.target === "resolve" ? "Remove the edits or choose iMovie MOV." : "Review the flattened MOV output.",
          ),
        );
      }
      if (hasAudioEdit(clip)) {
        issues.push(
          issue(
            "handoff.unsupported-audio-edit",
            targetDependentSeverity(selection.target),
            entity,
            "This clip has audio edits that the editable Resolve contract cannot preserve.",
            selection.target === "resolve" ? "Remove the edits or choose iMovie MOV." : "Review the flattened MOV output.",
          ),
        );
      }

      const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
      if (media && (clip.inPoint < 0 || clip.outPoint > media.metadata.duration || clip.outPoint <= clip.inPoint)) {
        issues.push(
          issue(
            "handoff.invalid-source-range",
            "blocking",
            entity,
            "The clip source range is outside the known media duration.",
            "Trim the clip within the source media duration.",
          ),
        );
      }
    }
  });

  const hasGeneratedContent = Boolean(
    project.textClips?.length ||
      project.shapeClips?.length ||
      project.svgClips?.length ||
      project.stickerClips?.length ||
      project.timeline.subtitles.length,
  );
  if (hasGeneratedContent) {
    issues.push(
      issue(
        "handoff.unsupported-generated-content",
        targetDependentSeverity(selection.target),
        projectEntity(project),
        "Generated text, graphics, stickers, or subtitles are not editable in the Resolve contract.",
        selection.target === "resolve" ? "Remove generated content or choose iMovie MOV." : "Review the flattened MOV output.",
      ),
    );
  }

  const requiredMediaIds = [...new Set(projection.clips.map((clip) => clip.mediaId))].sort();
  for (const mediaId of requiredMediaIds) {
    const media = project.mediaLibrary.items.find((item) => item.id === mediaId);
    if (!media || options.mediaAvailability.get(mediaId)?.available !== true) {
      issues.push(
        issue(
          "handoff.missing-media",
          "blocking",
          {
            kind: "media",
            id: mediaId,
            label: media?.name ?? mediaId,
            trackIndex: projection.clips.find((clip) => clip.mediaId === mediaId)?.trackIndex ?? null,
            timelineFrame: projection.clips.find((clip) => clip.mediaId === mediaId)?.timelineRange.startFrame ?? null,
          },
          `${media?.name ?? mediaId} is unavailable for this handoff.`,
          "Relink the media and assess again.",
          true,
        ),
      );
    }
  }

  const sortedIssues = sortCompatibilityIssues(issues);
  const status = sortedIssues.some((entry) => entry.severity === "blocking") ? "blocked" : "ready";
  const assessmentId = stableDigest(
    JSON.stringify({
      projectId: project.id,
      projectModifiedAt: project.modifiedAt,
      target: selection.target,
      range: selection.range,
      matrix: profile.issueMatrixVersion,
    }),
  );

  return {
    assessmentId,
    target: selection.target,
    selection,
    timebase,
    status,
    issues: sortedIssues,
    includedTrackIds: projection.tracks.map((track) => track.id),
    includedClipIds: projection.clips.map((clip) => clip.clipId),
    requiredMediaIds,
    createdAt: options.now?.() ?? Date.now(),
  };
}
