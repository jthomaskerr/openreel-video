import { describe, expect, it, vi } from "vitest";
import type { HandoffSelection, WrittenArtifact } from "@openreel/core";
import { createHandoffFixtureProject } from "../../../../packages/core/src/export/handoff/__fixtures__/projects";
import {
  HandoffOperation,
  startHandoff,
  type HandoffDependencies,
} from "./export-handoff";

function dependencies(): HandoffDependencies {
  return {
    mediaResolver: {
      inspect: vi.fn(async (media) => ({
        available: true,
        source: "blob" as const,
        mediaType: media.type === "audio" ? "audio/wav" : "video/quicktime",
        byteLength: media.metadata.fileSize,
      })),
      open: vi.fn(async () => {
        throw new Error("not used by the foundation assessment tests");
      }),
    },
    resolveDestination: { createProjectDirectory: vi.fn() },
    movieDestination: { open: vi.fn() },
    exportEngine: { exportVideo: vi.fn(), cancel: vi.fn() },
    emitDiagnostic: vi.fn(),
  } satisfies HandoffDependencies;
}

function resolveSelection(): HandoffSelection {
  const project = createHandoffFixtureProject();
  return {
    projectId: project.id,
    projectModifiedAt: project.modifiedAt,
    target: "resolve",
    range: { startTime: 0, endTime: project.timeline.duration },
  };
}

function imovieSelection(): HandoffSelection {
  const project = createHandoffFixtureProject();
  return {
    projectId: project.id,
    projectModifiedAt: project.modifiedAt,
    target: "imovie",
    range: { startTime: 1, endTime: 4 },
  };
}

function artifact(relativePath: string, byteLength = 1): WrittenArtifact {
  return {
    kind: relativePath.endsWith(".fcpxml") ? "fcpxml" : relativePath.endsWith(".md") ? "report" : "media",
    relativePath,
    mediaType: relativePath.endsWith(".fcpxml") ? "application/xml" : relativePath.endsWith(".md") ? "text/markdown" : "application/octet-stream",
    byteLength,
    sha256: "test-sha256",
  };
}

describe("HandoffOperation", () => {
  it("allows only target-valid phase transitions", () => {
    const operation = new HandoffOperation("operation-1", "resolve", vi.fn());
    operation.transition("assessing", "Assessing compatibility");
    operation.transition("awaiting-destination", "Choose a folder");
    operation.transition("resolving-media", "Resolving media");
    operation.transition("packaging", "Packaging");
    operation.transition("saving", "Saving");
    operation.transition("completed", "Completed", 1);
    expect(operation.phase).toBe("completed");

    const invalid = new HandoffOperation("operation-2", "resolve", vi.fn());
    invalid.transition("assessing", "Assessing compatibility");
    expect(() => invalid.transition("rendering", "Rendering")).toThrow(/transition/i);
  });

  it("enforces monotonic finite progress within a phase", () => {
    const progress = vi.fn();
    const operation = new HandoffOperation("operation-1", "imovie", progress);
    operation.transition("assessing", "Assessing compatibility", 0);
    operation.update(0.4, "Assessing compatibility");
    expect(() => operation.update(0.3, "Going backwards")).toThrow(/monotonic/i);
    expect(() => operation.update(Number.NaN, "Invalid")).toThrow(/progress/i);
    expect(progress.mock.calls.map(([entry]) => entry.progress)).toEqual([0, 0.4]);
  });

  it("emits one terminal state and rejects later transitions", () => {
    const progress = vi.fn();
    const operation = new HandoffOperation("operation-1", "resolve", progress);
    operation.transition("assessing", "Assessing");
    operation.cancel("Cancelled by user");
    operation.cancel("Cancelled twice");
    expect(progress.mock.calls.filter(([entry]) => entry.phase === "cancelled")).toHaveLength(1);
    expect(() => operation.transition("failed", "Too late")).toThrow(/terminal/i);
  });
});

describe("startHandoff foundation", () => {
  it("returns a typed blocked result for a stale selection before destination access", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    const selection: HandoffSelection = {
      projectId: project.id,
      projectModifiedAt: 1,
      target: "resolve",
      range: { startTime: 0, endTime: project.timeline.duration },
    };
    const result = await startHandoff(project, selection, deps, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(result).toMatchObject({ status: "blocked", target: "resolve" });
    expect(result.status === "blocked" && result.assessment.issues[0].code).toBe("handoff.stale-project");
    expect(deps.resolveDestination.createProjectDirectory).not.toHaveBeenCalled();
  });

  it("returns a cancelled terminal result when aborted before assessment", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();
    const progress = vi.fn();
    const result = await startHandoff(
      project,
      {
        projectId: project.id,
        projectModifiedAt: project.modifiedAt,
        target: "imovie",
        range: { startTime: 0, endTime: project.timeline.duration },
      },
      deps,
      { signal: controller.signal, onProgress: progress },
    );
    expect(result).toMatchObject({ status: "cancelled", target: "imovie", stage: "assessing" });
    expect(progress.mock.calls.filter(([entry]) => entry.phase === "cancelled")).toHaveLength(1);
  });
});

describe("startHandoff Resolve package", () => {
  it("resolves each media item once, streams media before metadata, closes, then completes", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    const calls: string[] = [];
    deps.mediaResolver.open = vi.fn(async (media) => ({
      mediaId: media.id,
      fileName: media.name,
      mediaType: media.type === "audio" ? "audio/wav" : "video/quicktime",
      byteLength: media.metadata.fileSize,
      stream: () => {
        calls.push(`stream:${media.id}`);
        return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } });
      },
    }));
    const writer = {
      write: vi.fn(async (relativePath: string) => {
        calls.push(`write:${relativePath}`);
        return artifact(relativePath);
      }),
      close: vi.fn(async () => { calls.push("close"); }),
    };
    deps.resolveDestination.createProjectDirectory = vi.fn(async () => writer);
    const progress = vi.fn((entry) => calls.push(`progress:${entry.phase}`));

    const result = await startHandoff(project, resolveSelection(), deps, {
      signal: new AbortController().signal,
      onProgress: progress,
    });

    if (result.status === "failed") throw result.failure.cause;
    expect(result.status).toBe("completed");
    expect(deps.mediaResolver.open).toHaveBeenCalledTimes(project.mediaLibrary.items.length);
    expect(new Set((deps.mediaResolver.open as ReturnType<typeof vi.fn>).mock.calls.map(([media]) => media.id)).size).toBe(project.mediaLibrary.items.length);
    const paths = writer.write.mock.calls.map(([relativePath]) => relativePath);
    expect(paths.slice(0, project.mediaLibrary.items.length).every((path) => path.startsWith("Media/"))).toBe(true);
    expect(paths.at(-2)).toMatch(/\.fcpxml$/);
    expect(paths.at(-1)).toBe("compatibility-report.md");
    expect(calls.indexOf("close")).toBeLessThan(calls.indexOf("progress:completed"));
  });

  it("maps denied directory permission without writing", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    deps.resolveDestination.createProjectDirectory = vi.fn(async () => {
      throw new DOMException("native path must stay private", "NotAllowedError");
    });
    const result = await startHandoff(project, resolveSelection(), deps, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "handoff.permission-denied", stage: "awaiting-destination", retryable: true },
    });
    expect(deps.mediaResolver.open).not.toHaveBeenCalled();
  });

  it("closes a partially written directory after a media copy failure", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    deps.mediaResolver.open = vi.fn(async (media) => ({
      mediaId: media.id,
      fileName: media.name,
      mediaType: "video/quicktime",
      byteLength: 1,
      stream: () => new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    }));
    const writer = {
      write: vi.fn(async () => { throw new Error("copy failed /private/secret.mov"); }),
      close: vi.fn(async () => undefined),
    };
    deps.resolveDestination.createProjectDirectory = vi.fn(async () => writer);
    const result = await startHandoff(project, resolveSelection(), deps, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(result).toMatchObject({ status: "failed", failure: { stage: "resolving-media", retryable: true } });
    expect(writer.close).toHaveBeenCalledTimes(1);
  });

  it("preserves completed partial artifacts and emits stage-specific safe diagnostics", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    deps.mediaResolver.open = vi.fn(async (media) => ({
      mediaId: media.id,
      fileName: "/private/secret.mov?token=credential",
      mediaType: "video/quicktime",
      byteLength: 1,
      stream: () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }),
    }));
    let writes = 0;
    const writer = {
      write: vi.fn(async (relativePath: string) => {
        writes += 1;
        if (writes === 2) throw new Error("copy failed /private/secret.mov?token=credential");
        return artifact(relativePath);
      }),
      close: vi.fn(async () => undefined),
    };
    deps.resolveDestination.createProjectDirectory = vi.fn(async () => writer);
    const result = await startHandoff(project, resolveSelection(), deps, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "handoff.media-copy-failed", stage: "resolving-media", retryable: true },
      writtenArtifacts: [expect.objectContaining({ kind: "media" })],
    });
    const serializedEvents = JSON.stringify((deps.emitDiagnostic as ReturnType<typeof vi.fn>).mock.calls);
    expect(serializedEvents).not.toMatch(/private|credential|token=/i);
  });

  it("emits every successful Resolve lifecycle event with safe relative identities", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    deps.mediaResolver.open = vi.fn(async (media) => ({
      mediaId: media.id,
      fileName: media.name,
      mediaType: "video/quicktime",
      byteLength: 1,
      stream: () => new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    }));
    const writer = {
      write: vi.fn(async (relativePath: string) => artifact(relativePath)),
      close: vi.fn(async () => undefined),
    };
    deps.resolveDestination.createProjectDirectory = vi.fn(async () => writer);
    await startHandoff(project, resolveSelection(), deps, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    const names = (deps.emitDiagnostic as ReturnType<typeof vi.fn>).mock.calls.map(([event]) => event.name);
    expect(names).toEqual(expect.arrayContaining([
      "handoff.assessment.completed",
      "handoff.destination.selected",
      "handoff.media.resolve.completed",
      "handoff.artifact.write.started",
      "handoff.artifact.write.completed",
      "handoff.completed",
    ]));
  });
});

describe("startHandoff iMovie movie", () => {
  it("forwards the immutable iMovie profile and selected range to the existing exporter", async () => {
    const project = createHandoffFixtureProject();
    const deps = dependencies();
    const writable = {} as FileSystemWritableFileStream;
    deps.movieDestination.open = vi.fn(async () => writable);
    deps.exportEngine.exportVideo = vi.fn(async function* (_project, settings, output) {
      expect(_project).toBe(project);
      expect(output).toBe(writable);
      expect(settings).toMatchObject({
        format: "mov",
        codec: "h264",
        width: project.settings.width,
        height: project.settings.height,
        frameRate: project.settings.frameRate,
        audioSettings: { format: "aac", sampleRate: 48_000, channels: 2 },
        range: { startTime: 1, endTime: 4 },
      });
      expect(Object.isFrozen(settings)).toBe(true);
      yield {
        phase: "rendering" as const,
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 45,
        totalFrames: 90,
        bytesWritten: 512,
        currentBitrate: 5_000,
        framesPerSecond: 30,
        elapsedRenderingTime: 1,
        estimateConfidence: "observed" as const,
        visibility: "visible" as const,
        backgroundThroughputRatio: null,
        backgroundDegraded: false,
      };
      return { success: true, stats: { duration: 3, framesRendered: 90, averageSpeed: 1, fileSize: 1_024, averageBitrate: 5_000 } };
    });

    const result = await startHandoff(project, imovieSelection(), deps, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });

    expect(result).toMatchObject({ status: "completed", target: "imovie" });
    expect(deps.movieDestination.open).toHaveBeenCalledWith(expect.stringMatching(/\.mov$/), "video/quicktime");
    const eventNames = (deps.emitDiagnostic as ReturnType<typeof vi.fn>).mock.calls.map(([event]) => event.name);
    expect(eventNames).toEqual(expect.arrayContaining([
      "handoff.assessment.completed",
      "handoff.destination.selected",
      "handoff.render.progress",
      "handoff.completed",
    ]));
  });

  it("maps file-save cancellation and export failure to visible retryable outcomes", async () => {
    const project = createHandoffFixtureProject();
    const cancelled = dependencies();
    cancelled.movieDestination.open = vi.fn(async () => { throw new DOMException("cancelled", "AbortError"); });
    const cancelResult = await startHandoff(project, imovieSelection(), cancelled, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(cancelResult).toMatchObject({ status: "cancelled", target: "imovie", stage: "awaiting-destination" });
    expect((cancelled.emitDiagnostic as ReturnType<typeof vi.fn>).mock.calls.map(([event]) => event.name)).toContain(
      "handoff.cancelled",
    );

    const failed = dependencies();
    failed.movieDestination.open = vi.fn(async () => ({} as FileSystemWritableFileStream));
    failed.exportEngine.exportVideo = vi.fn(async function* () {
      yield {
        phase: "encoding" as const,
        progress: 0.5,
        estimatedTimeRemaining: 1,
        currentFrame: 45,
        totalFrames: 90,
        bytesWritten: 512,
        currentBitrate: 5_000,
        framesPerSecond: 30,
        elapsedRenderingTime: 1,
        estimateConfidence: "observed" as const,
        visibility: "visible" as const,
        backgroundThroughputRatio: null,
        backgroundDegraded: false,
      };
      return {
        success: false,
        error: {
          code: "FRAME_ENCODE_FAILED" as const,
          phase: "encoding" as const,
          message: "native secret must not leak",
          recoverable: true,
        },
      };
    });
    const failResult = await startHandoff(project, imovieSelection(), failed, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(failResult).toMatchObject({ status: "failed", failure: { stage: "rendering", retryable: true } });
    expect((failed.emitDiagnostic as ReturnType<typeof vi.fn>).mock.calls.map(([event]) => event.name)).toContain(
      "handoff.failed",
    );
  });
});
