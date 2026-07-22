import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { HandoffResult, HandoffSelection } from "@openreel/core";
import { createHandoffFixtureProject } from "../../../../../packages/core/src/export/handoff/__fixtures__/projects";
import { HandoffExportDialog, type RunHandoff } from "./HandoffExportDialog";

const project = createHandoffFixtureProject();

function failedResult(target: "resolve" | "imovie" = "resolve"): HandoffResult {
  return {
    status: "failed",
    target,
    failure: {
      code: "test.failure",
      stage: "awaiting-destination",
      message: "Choose a writable destination and retry.",
      entity: null,
      retryable: true,
    },
    writtenArtifacts: [],
  };
}

function completedResolveResult(): HandoffResult {
  return {
    status: "completed",
    target: "resolve",
    artifacts: [
      { kind: "media", relativePath: "Media/Camera.mov", mediaType: "video/quicktime", byteLength: 10, sha256: "abc" },
      { kind: "fcpxml", relativePath: "Fixture.fcpxml", mediaType: "application/xml", byteLength: 20, sha256: "def" },
    ],
    report: {
      schemaVersion: "1.0",
      project: { id: project.id, name: project.name },
      target: { id: "resolve", label: "DaVinci Resolve", mode: "editable", contractVersion: "fcpxml-1.10", applicationVersions: [] },
      range: { startFrame: 0, endFrame: 180, durationFrames: 180, frameRate: "30/1", startDisplay: "0 frames", endDisplay: "180 frames", durationDisplay: "180 frames" },
      artifacts: [],
      issues: [],
      unsupportedItems: [],
      result: { status: "completed", summary: "Resolve folder ready" },
      generatedAt: "2026-07-22T00:00:00.000Z",
    },
  };
}

function completedImovieResult(): HandoffResult {
  const completed = completedResolveResult();
  if (completed.status !== "completed") throw new Error("Expected completed fixture");
  const flatteningIssue = {
    code: "handoff.flattened-effect",
    severity: "flattening" as const,
    entity: { kind: "clip" as const, id: "clip-1", label: "Title clip", trackIndex: 0, timelineFrame: 30 },
    message: "The title is baked into the movie.",
    action: "Use Resolve when editable titles are required.",
    retryable: false,
    details: {},
  };
  return {
    ...completed,
    target: "imovie",
    artifacts: [{ kind: "movie", relativePath: "Fixture-imovie.mov", mediaType: "video/quicktime", byteLength: 100, sha256: "abc" }],
    report: {
      ...completed.report,
      target: { id: "imovie", label: "iMovie", mode: "flattened", contractVersion: "mov-h264-aac-1.0", applicationVersions: [] },
      issues: [flatteningIssue],
      unsupportedItems: [flatteningIssue],
    },
  };
}

describe("HandoffExportDialog", () => {
  it("starts a valid handoff in exactly three primary activations", async () => {
    const onStart = vi.fn<Parameters<RunHandoff>, ReturnType<RunHandoff>>(async (selection) =>
      failedResult(selection.target),
    );
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Continue editing</button>
          <HandoffExportDialog
            isOpen={open}
            onClose={() => setOpen(false)}
            project={project}
            onStart={onStart}
          />
        </>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
    fireEvent.click(screen.getByRole("button", { name: /iMovie/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));

    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onStart.mock.calls[0][0]).toMatchObject({
      target: "imovie",
      range: { startTime: 0, endTime: 12 },
    });
  });

  it("explains editable Resolve and flattened iMovie targets", () => {
    render(
      <HandoffExportDialog isOpen onClose={vi.fn()} project={project} onStart={vi.fn()} />,
    );
    expect(screen.getByText(/editable timeline with collected media/i)).toBeInTheDocument();
    expect(screen.getByText(/flattened MOV that preserves the rendered picture and sound/i)).toBeInTheDocument();
  });

  it("supports full-project and selected-range choices", async () => {
    const onStart = vi.fn(async (selection: HandoffSelection) => failedResult(selection.target));
    render(
      <HandoffExportDialog
        isOpen
        onClose={vi.fn()}
        project={project}
        selectedRange={{ startTime: 3, endTime: 8 }}
        onStart={onStart}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /iMovie/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Selected range/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0].range).toEqual({ startTime: 3, endTime: 8 });
  });

  it("shows preflight progress and completion state", async () => {
    const onStart: RunHandoff = async (selection, options) => {
      options.onProgress({
        operationId: "test",
        target: selection.target,
        phase: "assessing",
        progress: 0.5,
        processedCount: 1,
        totalCount: 2,
        message: "Checked media 1 of 2",
      });
      return {
        status: "completed",
        target: selection.target,
        report: {
          schemaVersion: "1.0",
          project: { id: project.id, name: project.name },
          target: {
            id: selection.target,
            label: "iMovie",
            mode: "flattened",
            contractVersion: "mov-h264-aac-1.0",
            applicationVersions: [],
          },
          range: {
            startFrame: 0,
            endFrame: 360,
            durationFrames: 360,
            frameRate: "30/1",
            startDisplay: "00:00:00:00",
            endDisplay: "00:00:12:00",
            durationDisplay: "00:00:12:00",
          },
          artifacts: [],
          issues: [],
          unsupportedItems: [],
          result: { status: "completed", summary: "Handoff complete" },
          generatedAt: "2026-07-22T00:00:00.000Z",
        },
        artifacts: [],
      };
    };
    render(<HandoffExportDialog isOpen onClose={vi.fn()} project={project} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /iMovie/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));
    expect(await screen.findByText(/Handoff complete/i)).toBeInTheDocument();
  });

  it("cancels an active operation through AbortSignal", async () => {
    const onStart: RunHandoff = async (selection, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener(
          "abort",
          () => resolve({ status: "cancelled", target: selection.target, stage: "assessing", writtenArtifacts: [] }),
          { once: true },
        );
      });
    render(<HandoffExportDialog isOpen onClose={vi.fn()} project={project} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /iMovie/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Cancel handoff/i }));
    expect(await screen.findByText(/Handoff cancelled/i)).toBeInTheDocument();
  });

  it("routes Resolve through the backend project picker without calling the browser handoff", async () => {
    const onStart = vi.fn(async () => completedResolveResult());
    render(
      <HandoffExportDialog
        isOpen
        onClose={vi.fn()}
        project={project}
        onStart={onStart}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /DaVinci Resolve/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));
    expect(await screen.findByRole("heading", { name: /Open an OpenReel project in DaVinci Resolve/i })).toBeVisible();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("labels recoverable failures with a retry action", async () => {
    const onStart: RunHandoff = vi
      .fn<Parameters<RunHandoff>, ReturnType<RunHandoff>>()
      .mockResolvedValueOnce(failedResult())
      .mockResolvedValueOnce(completedResolveResult());
    render(<HandoffExportDialog isOpen onClose={vi.fn()} project={project} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /iMovie/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));
    expect(await screen.findByRole("button", { name: /Retry handoff/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry handoff/i }));
    expect(await screen.findByText(/Handoff complete/i)).toBeInTheDocument();
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("shows stable issue severity, affected identity, and corrective action without writing", async () => {
    const onStart: RunHandoff = vi.fn(async (selection) => ({
      status: "blocked" as const,
      target: selection.target,
      assessment: {
        assessmentId: "blocked-1",
        target: selection.target,
        selection,
        timebase: {
          sourceFrameRate: 30,
          framesPerSecondNumerator: 30,
          framesPerSecondDenominator: 1,
          frameDurationNumerator: 1,
          frameDurationDenominator: 30,
        },
        status: "blocked" as const,
        issues: [{
          code: "handoff.missing-media",
          severity: "blocking" as const,
          entity: { kind: "media" as const, id: "media-1", label: "Camera A.mov", trackIndex: 0, timelineFrame: 30 },
          message: "Required media is missing.",
          action: "Relink Camera A.mov, then retry.",
          retryable: true,
          details: {},
        }],
        includedTrackIds: [],
        includedClipIds: [],
        requiredMediaIds: ["media-1"],
        createdAt: 1,
      },
    }));
    render(<HandoffExportDialog isOpen onClose={vi.fn()} project={project} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /iMovie/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));
    expect(await screen.findByText(/Blocking/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Camera A\.mov/)).toHaveLength(2);
    expect(screen.getByText(/Relink Camera A\.mov, then retry/i)).toBeInTheDocument();
    expect(screen.getByText(/Track 1.*frame 30/i)).toBeInTheDocument();
  });

  it("discloses iMovie dimensions, orientation, and flattened-only changes on completion", async () => {
    render(
      <HandoffExportDialog
        isOpen
        onClose={vi.fn()}
        project={project}
        onStart={vi.fn(async () => completedImovieResult())}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /iMovie/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start handoff/i }));
    expect(await screen.findByText(/Flattened MOV/i)).toBeInTheDocument();
    expect(screen.getByText(/1920 × 1080.*landscape/i)).toBeInTheDocument();
    expect(screen.getByText(/The title is baked into the movie/i)).toBeInTheDocument();
    expect(screen.getByText(/Use Resolve when editable titles are required/i)).toBeInTheDocument();
  });
});
