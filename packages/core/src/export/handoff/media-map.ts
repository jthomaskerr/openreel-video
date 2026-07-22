import type { MediaItem, Project } from "../../types/project";
import { reduceRational } from "./timebase";
import type { MediaReference } from "./types";

const UNSAFE_FILE_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

function splitExtension(name: string): { stem: string; extension: string } {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return { stem: name, extension: "" };
  return { stem: name.slice(0, lastDot), extension: name.slice(lastDot) };
}

export function sanitizeMediaFileName(sourceName: string, fallbackId: string): string {
  const basename = sourceName.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
  const sanitized = basename.replace(UNSAFE_FILE_CHARACTERS, "_").replace(/\s+/g, " ").trim();
  if (!sanitized || sanitized === "." || sanitized === "..") return `media-${fallbackId}`;
  return sanitized;
}

function collisionSafeName(candidate: string, usedLowercaseNames: Set<string>): string {
  if (!usedLowercaseNames.has(candidate.toLocaleLowerCase())) {
    usedLowercaseNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  const { stem, extension } = splitExtension(candidate);
  let suffix = 2;
  while (usedLowercaseNames.has(`${stem}-${suffix}${extension}`.toLocaleLowerCase())) suffix += 1;
  const resolved = `${stem}-${suffix}${extension}`;
  usedLowercaseNames.add(resolved.toLocaleLowerCase());
  return resolved;
}

function decodeRepeatedly(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error("Media path contains invalid percent encoding");
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function assertContainedMediaPath(relativePath: string): void {
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(relativePath)) {
    throw new Error("Media path must be relative to the Media directory");
  }
  const decoded = decodeRepeatedly(relativePath).replace(/\\/g, "/");
  const segments = decoded.split("/");
  if (segments[0] !== "Media" || segments.length !== 2 || !segments[1] || segments.some((part) => part === ".." || part === ".")) {
    throw new Error("Media path must remain contained by the Media directory");
  }
}

function toMediaReference(media: MediaItem, outputName: string): MediaReference {
  if (media.type === "srt") throw new Error(`Unsupported handoff media type for ${media.id}`);
  const relativeUrl = `Media/${encodeURIComponent(outputName)}`;
  assertContainedMediaPath(relativeUrl);
  const durationMilliseconds = Math.max(0, Math.round(media.metadata.duration * 1_000));
  return {
    mediaId: media.id,
    sourceName: media.name,
    outputName,
    relativeUrl,
    type: media.type,
    duration: durationMilliseconds > 0 ? reduceRational(durationMilliseconds, 1_000) : null,
    hasVideo: media.type === "video" || media.type === "image",
    hasAudio: media.type === "audio" || (media.type === "video" && media.metadata.channels > 0),
  };
}

export function createMediaMap(project: Project, requiredMediaIds: readonly string[]): MediaReference[] {
  const mediaById = new Map(project.mediaLibrary.items.map((media) => [media.id, media]));
  const usedLowercaseNames = new Set<string>();
  return [...new Set(requiredMediaIds)]
    .sort()
    .map((mediaId) => {
      const media = mediaById.get(mediaId);
      if (!media) throw new Error(`Required media ${mediaId} is missing from the project`);
      const sanitized = sanitizeMediaFileName(media.name, media.id);
      return toMediaReference(media, collisionSafeName(sanitized, usedLowercaseNames));
    });
}

