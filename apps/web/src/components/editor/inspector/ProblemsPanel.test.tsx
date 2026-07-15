import "../../../test/install-local-storage-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MediaItem } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useProblemStore } from "../../../stores/problem-store";
import { mediaAvailabilityRuntime } from "../../../services/media-verification";
import { ProblemsPanel } from "./ProblemsPanel";

const item: MediaItem = {
  id: "media-1",
  name: "shot.mp4",
  type: "video",
  fileHandle: null,
  blob: null,
  thumbnailUrl: null,
  metadata: { duration: 1, width: 1, height: 1, frameRate: 24, codec: "h264", sampleRate: 0, channels: 0, fileSize: 1 },
};

function seedProblemProject() {
  const project = createEmptyProject("Problems availability");
  useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [item] } } });
  useProblemStore.getState().addProblem({
    id: "problem-1",
    kind: "missing_media",
    message: "Missing shot",
    label: "shot.mp4",
    mediaId: item.id,
    projectId: project.id,
    timestamp: 1,
    resolved: false,
  });
}

afterEach(() => {
  cleanup();
  useProblemStore.getState().clearAll();
  vi.restoreAllMocks();
});

describe("ProblemsPanel media availability", () => {
  it("does not present a transient outage as missing", () => {
    seedProblemProject();
    vi.spyOn(mediaAvailabilityRuntime, "get").mockReturnValue({
      mediaId: item.id,
      status: "temporarily_unavailable",
      evidence: { authoritative: false, mapping: "unknown", object: "unknown" },
    });

    render(<ProblemsPanel />);

    expect(screen.getByText("No problems")).toBeInTheDocument();
    expect(screen.queryByText("Missing file")).toBeNull();
  });

  it("presents only confirmed absence as a missing-media problem", () => {
    seedProblemProject();
    vi.spyOn(mediaAvailabilityRuntime, "get").mockReturnValue({
      mediaId: item.id,
      status: "confirmed_missing",
      evidence: { authoritative: true, mapping: "absent", object: "absent" },
    });

    render(<ProblemsPanel />);

    expect(screen.getByText("Missing file")).toBeInTheDocument();
    expect(screen.getByText("shot.mp4")).toBeInTheDocument();
  });
});
