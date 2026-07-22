import type { Project } from "../../types/project";
import type { VideoExportSettings } from "../types";
import type { HandoffSelection } from "./types";

export function createImovieExportProfile(
  project: Project,
  selection: HandoffSelection,
): VideoExportSettings {
  if (selection.target !== "imovie") throw new Error("iMovie settings require the iMovie handoff target");
  if (selection.projectId !== project.id || selection.projectModifiedAt !== project.modifiedAt) {
    throw new Error("iMovie settings cannot be created from a stale project selection");
  }

  const audioSettings = Object.freeze({
    format: "aac" as const,
    sampleRate: 48_000 as const,
    bitDepth: 16 as const,
    bitrate: 192,
    channels: 2 as const,
  });
  const range = Object.freeze({ ...selection.range });
  return Object.freeze({
    format: "mov" as const,
    codec: "h264" as const,
    width: project.settings.width,
    height: project.settings.height,
    frameRate: project.settings.frameRate,
    bitrate: 5_000,
    bitrateMode: "cbr" as const,
    quality: 80,
    keyframeInterval: Math.max(1, Math.round(project.settings.frameRate * 2)),
    audioSettings,
    range,
  });
}
