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
  id: string,
  name?: string,
  settings?: Partial<ProjectSettings>,
): Project {
  if (!id.trim()) throw new Error("A backend-managed project identity is required");
  const now = Date.now();
  const projectName = name || generateProjectName();
  return {
    id,
    name: projectName,
    createdAt: now,
    modifiedAt: now,
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...settings },
    mediaLibrary: { items: [] },
    generatedImageDefinitions: [],
    timeline: createDefaultTimeline(),
  };
}

export function createNoActiveProjectGuard(): Project {
  return new Proxy(Object.create(null) as Project, {
    get(_target, property) {
      throw new Error(`No active project; attempted to read ${String(property)}`);
    },
    set() {
      throw new Error("No active project; attempted to mutate project state");
    },
  });
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
