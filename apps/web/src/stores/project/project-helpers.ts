import { v4 as uuidv4 } from "uuid";
import type { Project, ProjectSettings, Timeline } from "@openreel/core";
import { generateProjectName } from "../../utils/project-names";

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  sampleRate: 48000,
  channels: 2,
};

export function createDefaultTimeline(): Timeline {
  return {
    tracks: [],
    subtitles: [],
    duration: 0,
    markers: [],
  };
}

export function createEmptyProject(
  name?: string,
  settings?: Partial<ProjectSettings>,
): Project {
  const now = Date.now();
  const projectName = name || generateProjectName();
  return {
    id: uuidv4(),
    name: projectName,
    createdAt: now,
    modifiedAt: now,
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...settings },
    mediaLibrary: { items: [] },
    generatedImageDefinitions: [],
    timeline: createDefaultTimeline(),
  };
}

/** Non-editable startup value used until a backend project is confirmed. */
export function createUnresolvedProject(): Project {
  const now = Date.now();
  return {
    id: "unresolved",
    name: "Unresolved project",
    createdAt: now,
    modifiedAt: now,
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    mediaLibrary: { items: [] },
    generatedImageDefinitions: [],
    timeline: createDefaultTimeline(),
  };
}

export function calculateTimelineDuration(project: Project): number {
  let maxEnd = 0;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd > maxEnd) {
        maxEnd = clipEnd;
      }
    }
  }
  return maxEnd;
}
