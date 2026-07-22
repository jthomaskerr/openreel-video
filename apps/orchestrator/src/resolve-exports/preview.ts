import {
  ResolvePreviewSchema,
  type MediaItem,
  type Project,
  type ResolvePreview,
} from "@openreel/core";

const previewClipTypes = [
  "video",
  "audio",
  "titles",
  "graphics",
  "subtitles",
  "unsupported",
] as const;

type PreviewClipType = (typeof previewClipTypes)[number];

/**
 * Media-storage facts used to derive a preview.  Render provenance belongs to
 * the backend snapshot, not to the persisted project model, because a render
 * is a derived artifact rather than editable project state.
 */
export type PreviewMediaAvailability =
  | {
    readonly status: "ready";
    readonly renderedAt?: number;
    readonly renderedRevision?: string;
  }
  | {
    readonly status: "missing";
    readonly reason: string;
    readonly renderedAt?: number;
    readonly renderedRevision?: string;
  };

function secondsToFrames(seconds: number, frameRate: number): number {
  return Math.max(0, Math.round(seconds * frameRate));
}

function projectMediaUrl(projectId: string, mediaId: string, suffix = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}${suffix}`;
}

function clipType(type: string): PreviewClipType {
  switch (type) {
    case "video":
    case "image":
      return "video";
    case "audio":
      return "audio";
    case "text":
      return "titles";
    case "shape":
    case "svg":
    case "sticker":
      return "graphics";
    default:
      return "unsupported";
  }
}

function trackType(type: string): PreviewClipType {
  switch (type) {
    case "video":
    case "image":
      return "video";
    case "audio":
      return "audio";
    case "text":
      return "titles";
    case "graphics":
      return "graphics";
    case "subtitle":
      return "subtitles";
    default:
      return "unsupported";
  }
}

function labelForClip(clipTypeValue: PreviewClipType, media: MediaItem | undefined): string {
  if (media) return media.title?.trim() || media.name;
  switch (clipTypeValue) {
    case "titles": return "Title";
    case "graphics": return "Graphic";
    case "subtitles": return "Subtitle";
    case "unsupported": return "Unsupported clip";
    default: return "Unavailable media";
  }
}

function previewForMedia(
  projectId: string,
  mediaId: string,
  media: MediaItem | undefined,
  availability: ReadonlyMap<string, PreviewMediaAvailability>,
) {
  if (!mediaId) {
    return { status: "missing" as const, reason: "This clip has no project media source" };
  }
  if (!media) {
    return { status: "missing" as const, reason: `Project media ${mediaId} is not recorded` };
  }
  const state = availability.get(mediaId);
  if (!state) {
    return { status: "missing" as const, reason: `Project media ${mediaId} has not been verified` };
  }
  if (state.status === "missing") {
    return { status: "missing" as const, reason: state.reason };
  }

  const url = projectMediaUrl(projectId, mediaId);
  switch (media.type) {
    case "video":
      return {
        status: "ready" as const,
        kind: "video" as const,
        url,
        thumbnailUrl: url,
      };
    case "audio":
      return {
        status: "ready" as const,
        kind: "audio" as const,
        url,
        waveformUrl: url,
      };
    case "image":
      return { status: "ready" as const, kind: "image" as const, url };
    default:
      return { status: "missing" as const, reason: `Media ${mediaId} cannot be previewed as ${media.type}` };
  }
}

function buildMiniTimeline(project: Project, mediaById: ReadonlyMap<string, MediaItem>) {
  const frameRate = project.settings.frameRate;
  const tracks = project.timeline.tracks.map((track, index) => ({
    id: track.id,
    index,
    type: trackType(track.type),
    clips: track.clips.map((clip) => ({
      id: clip.id,
      ...(clip.mediaId ? { mediaId: clip.mediaId } : {}),
      label: labelForClip(clipType(clip.type), mediaById.get(clip.mediaId)),
      startFrame: secondsToFrames(clip.startTime, frameRate),
      endFrame: secondsToFrames(clip.startTime + clip.duration, frameRate),
    })),
  }));
  if (project.timeline.subtitles.length > 0) {
    tracks.push({
      id: "openreel-subtitles",
      index: tracks.length,
      type: "subtitles",
      clips: project.timeline.subtitles.map((subtitle) => ({
        id: subtitle.id,
        label: subtitle.text,
        startFrame: secondsToFrames(subtitle.startTime, frameRate),
        endFrame: secondsToFrames(subtitle.endTime, frameRate),
      })),
    });
  }
  return {
    durationFrames: secondsToFrames(project.timeline.duration, frameRate),
    tracks,
  };
}

function buildClipGroups(
  project: Project,
  availability: ReadonlyMap<string, PreviewMediaAvailability>,
) {
  const frameRate = project.settings.frameRate;
  const mediaById = new Map(project.mediaLibrary.items.map((media) => [media.id, media]));
  const clipsByType = new Map<PreviewClipType, Array<{
    id: string;
    mediaId?: string;
    label: string;
    startFrame: number;
    endFrame: number;
    preview: ReturnType<typeof previewForMedia>;
  }>>();
  for (const type of previewClipTypes) clipsByType.set(type, []);

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const type = clipType(clip.type);
      const media = mediaById.get(clip.mediaId);
      clipsByType.get(type)!.push({
        id: clip.id,
        ...(clip.mediaId ? { mediaId: clip.mediaId } : {}),
        label: labelForClip(type, media),
        startFrame: secondsToFrames(clip.startTime, frameRate),
        endFrame: secondsToFrames(clip.startTime + clip.duration, frameRate),
        preview: previewForMedia(project.id, clip.mediaId, media, availability),
      });
    }
  }
  for (const subtitle of project.timeline.subtitles) {
    clipsByType.get("subtitles")!.push({
      id: subtitle.id,
      label: subtitle.text,
      startFrame: secondsToFrames(subtitle.startTime, frameRate),
      endFrame: secondsToFrames(subtitle.endTime, frameRate),
      preview: { status: "missing", reason: "Subtitles have no standalone media preview" },
    });
  }

  return previewClipTypes.flatMap((type) => {
    const clips = clipsByType.get(type)!;
    return clips.length > 0 ? [{ type, clips }] : [];
  });
}

function resolveLatestRender(
  project: Project,
  revision: string,
  availability: ReadonlyMap<string, PreviewMediaAvailability>,
) {
  const candidates = project.mediaLibrary.items
    .map((media) => ({ media, availability: availability.get(media.id) }))
    .filter((candidate) => candidate.availability?.renderedAt !== undefined)
    .sort((left, right) => (right.availability!.renderedAt! - left.availability!.renderedAt!));
  const latest = candidates[0];
  if (!latest) return { status: "missing" as const, reason: "No rendered output is available" };

  const { media, availability: state } = latest;
  if (state!.status === "missing") {
    return { status: "missing" as const, reason: state!.reason };
  }
  const previewUrl = projectMediaUrl(project.id, media.id);
  if (state!.renderedRevision !== revision) {
    return {
      status: "stale" as const,
      mediaId: media.id,
      previewUrl,
      updatedAt: state!.renderedAt!,
      stale: true as const,
      reason: state!.renderedRevision
        ? `Render belongs to revision ${state!.renderedRevision}, not ${revision}`
        : "Render revision is unavailable",
    };
  }
  return {
    status: "ready" as const,
    mediaId: media.id,
    previewUrl,
    updatedAt: state!.renderedAt!,
    stale: false as const,
  };
}

function compatibilityForPreview(groups: ReturnType<typeof buildClipGroups>) {
  let blockingIssueCount = 0;
  let warningCount = 0;
  for (const group of groups) {
    if (group.type === "unsupported") warningCount += group.clips.length;
    for (const clip of group.clips) {
      const requiresMedia = group.type === "video"
        || group.type === "audio"
        || (group.type === "graphics" && Boolean(clip.mediaId));
      if (requiresMedia && clip.preview.status === "missing") {
        blockingIssueCount += 1;
      }
    }
  }
  return {
    status: blockingIssueCount > 0 ? "blocked" as const : warningCount > 0 ? "degraded" as const : "ready" as const,
    blockingIssueCount,
    warningCount,
  };
}

export function buildResolvePreview(
  project: Project,
  revision: string,
  availability: ReadonlyMap<string, PreviewMediaAvailability>,
): ResolvePreview {
  const mediaById = new Map(project.mediaLibrary.items.map((media) => [media.id, media]));
  const miniTimeline = buildMiniTimeline(project, mediaById);
  const clipGroups = buildClipGroups(project, availability);
  return ResolvePreviewSchema.parse({
    projectId: project.id,
    revision,
    name: project.name,
    description: project.description ?? "",
    createdAt: project.createdAt,
    modifiedAt: project.modifiedAt,
    durationFrames: secondsToFrames(project.timeline.duration, project.settings.frameRate),
    frameRate: project.settings.frameRate,
    trackCount: project.timeline.tracks.length,
    clipCount: clipGroups.reduce((count, group) => count + group.clips.length, 0),
    mediaCount: project.mediaLibrary.items.length,
    render: resolveLatestRender(project, revision, availability),
    miniTimeline,
    clipGroups,
    compatibility: compatibilityForPreview(clipGroups),
  });
}
