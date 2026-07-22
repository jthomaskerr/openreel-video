import { describe, expect, it, vi } from "vitest";
import type { HandoffSelection, Project, VideoExportSettings, WrittenArtifact } from "@openreel/core";
import { createHandoffFixtureProject } from "../../../../packages/core/src/export/handoff/__fixtures__/projects";
import { startHandoff, type HandoffDependencies } from "../services/export-handoff";

function written(relativePath: string, byteLength: number): WrittenArtifact {
  return {
    kind: relativePath.endsWith(".fcpxml") ? "fcpxml" : relativePath.endsWith(".md") ? "report" : "media",
    relativePath,
    mediaType: relativePath.endsWith(".fcpxml") ? "application/xml" : relativePath.endsWith(".md") ? "text/markdown" : "application/octet-stream",
    byteLength,
    sha256: "integration-sha256",
  };
}

function selection(project: Project, target: "resolve" | "imovie", startTime = 0, endTime = project.timeline.duration): HandoffSelection {
  return { projectId: project.id, projectModifiedAt: project.modifiedAt, target, range: { startTime, endTime } };
}

function integrationDependencies() {
  const files = new Map<string, string>();
  const settings: VideoExportSettings[] = [];
  const destinationCalls = { resolve: 0, imovie: 0 };
  const dependencies: HandoffDependencies = {
    mediaResolver: {
      inspect: vi.fn(async (media) => ({ available: true, source: "blob" as const, mediaType: media.type === "audio" ? "audio/wav" : "video/quicktime", byteLength: media.metadata.fileSize })),
      open: vi.fn(async (media) => ({
        mediaId: media.id,
        fileName: media.name,
        mediaType: media.type === "audio" ? "audio/wav" : "video/quicktime",
        byteLength: 1,
        stream: () => new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(media.id));
            controller.close();
          },
        }),
      })),
    },
    resolveDestination: {
      createProjectDirectory: vi.fn(async () => {
        destinationCalls.resolve += 1;
        return {
          async write(relativePath: string, body: string | ReadableStream<Uint8Array>) {
            const value = typeof body === "string" ? body : "<streamed-media>";
            files.set(relativePath, value);
            return written(relativePath, value.length);
          },
          close: vi.fn(async () => undefined),
        };
      }),
    },
    movieDestination: {
      open: vi.fn(async () => {
        destinationCalls.imovie += 1;
        return {} as FileSystemWritableFileStream;
      }),
    },
    exportEngine: {
      exportVideo: vi.fn(async function* (_project, value) {
        settings.push(value as VideoExportSettings);
        yield {
          phase: "rendering" as const,
          progress: 0.5,
          estimatedTimeRemaining: 1,
          currentFrame: 45,
          totalFrames: 90,
          bytesWritten: 1_024,
          currentBitrate: 5_000,
          framesPerSecond: 30,
          elapsedRenderingTime: 1,
          estimateConfidence: "observed" as const,
          visibility: "visible" as const,
          backgroundThroughputRatio: null,
          backgroundDegraded: false,
        };
        return { success: true, stats: { duration: 3, framesRendered: 90, averageSpeed: 1, fileSize: 2_048, averageBitrate: 5_000 } };
      }),
      cancel: vi.fn(),
    },
    emitDiagnostic: vi.fn(),
  };
  return { dependencies, files, settings, destinationCalls };
}

describe("export handoff coordinator integration", () => {
  it("creates equivalent full Resolve structures twice and rebases a selected range", async () => {
    const project = createHandoffFixtureProject();
    const first = integrationDependencies();
    const firstResult = await startHandoff(project, selection(project, "resolve"), first.dependencies, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    const second = integrationDependencies();
    const secondResult = await startHandoff(project, selection(project, "resolve"), second.dependencies, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    if (firstResult.status === "failed") throw firstResult.failure.cause;
    expect(firstResult.status).toBe("completed");
    expect(secondResult.status).toBe("completed");
    expect([...first.files.keys()]).toEqual([...second.files.keys()]);
    const normalizeGeneratedAt = (entries: [string, string][]) =>
      entries.map(([path, value]) => [path, value.replace(/Generated: .*$/m, "Generated: <timestamp>")]);
    expect(normalizeGeneratedAt([...first.files.entries()])).toEqual(
      normalizeGeneratedAt([...second.files.entries()]),
    );
    expect([...first.files.keys()].filter((path) => path.startsWith("Media/"))).toHaveLength(2);

    const selected = integrationDependencies();
    const selectedResult = await startHandoff(project, selection(project, "resolve", 1, 4), selected.dependencies, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(selectedResult.status).toBe("completed");
    const xml = [...selected.files.entries()].find(([path]) => path.endsWith(".fcpxml"))?.[1];
    expect(xml).toContain('duration="3s"');
    expect(xml).toContain('offset="0s"');
  });

  it.each([
    ["horizontal", 1920, 1080],
    ["vertical", 1080, 1920],
    ["square", 1080, 1080],
  ])("renders a selected-range %s iMovie MOV with project geometry and mixed audio", async (_name, width, height) => {
    const base = createHandoffFixtureProject();
    const project = { ...base, settings: { ...base.settings, width, height } };
    const harness = integrationDependencies();
    const result = await startHandoff(project, selection(project, "imovie", 1, 4), harness.dependencies, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(result).toMatchObject({ status: "completed", target: "imovie" });
    expect(harness.settings).toHaveLength(1);
    expect(harness.settings[0]).toMatchObject({
      format: "mov",
      codec: "h264",
      width,
      height,
      audioSettings: { format: "aac", sampleRate: 48_000, channels: 2 },
      range: { startTime: 1, endTime: 4 },
    });
  });

  it("never prompts or writes when a fresh assessment blocks a stale project selection", async () => {
    const project = createHandoffFixtureProject();
    const harness = integrationDependencies();
    const stale = { ...selection(project, "resolve"), projectModifiedAt: project.modifiedAt - 1 };
    const result = await startHandoff(project, stale, harness.dependencies, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(result.status).toBe("blocked");
    expect(harness.destinationCalls).toEqual({ resolve: 0, imovie: 0 });
    expect(harness.files.size).toBe(0);
  });

  it("retries a recoverable copy failure without treating partial output as ready", async () => {
    const project = createHandoffFixtureProject();
    const first = integrationDependencies();
    const writerFactory = first.dependencies.resolveDestination.createProjectDirectory as ReturnType<typeof vi.fn>;
    writerFactory.mockResolvedValueOnce({
      write: vi.fn(async () => { throw new Error("copy failed"); }),
      close: vi.fn(async () => undefined),
    });
    const failed = await startHandoff(project, selection(project, "resolve"), first.dependencies, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(failed).toMatchObject({ status: "failed", failure: { retryable: true } });
    expect(failed.status === "failed" && failed.writtenArtifacts).toEqual([]);

    const retry = integrationDependencies();
    const completed = await startHandoff(project, selection(project, "resolve"), retry.dependencies, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(completed.status).toBe("completed");
    expect([...retry.files.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(/\.fcpxml$/),
      "compatibility-report.md",
    ]));
  });
});
