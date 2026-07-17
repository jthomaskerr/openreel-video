import { describe, expect, it, vi } from "vitest";
import { createExportDiagnostics } from "./export-diagnostics";

describe("createExportDiagnostics", () => {
  it("emits only allowlisted fields", () => {
    const sink = vi.fn();
    const diagnostics = createExportDiagnostics(sink);

    diagnostics.emit({
      event: "export-start",
      browser: "WebKit 26.5",
      codec: "h264",
      width: 854,
      height: 480,
      frameRate: 30,
      totalFrames: 120,
      requestedAcceleration: "no-preference",
      media: new Uint8Array([1, 2, 3]),
      path: "file:///private/video.mp4",
      url: "https://example.test/video?signature=secret",
      authorization: "Bearer secret",
    } as never);

    expect(sink).toHaveBeenCalledWith({
      event: "export-start",
      browser: "WebKit 26.5",
      codec: "h264",
      width: 854,
      height: 480,
      frameRate: 30,
      totalFrames: 120,
      requestedAcceleration: "no-preference",
    });
  });

  it("normalizes errors without retaining sensitive text", () => {
    const sink = vi.fn();
    const diagnostics = createExportDiagnostics(sink);

    diagnostics.error(
      "decoder-initialization",
      new Error("file:///private/video.mp4?signature=secret authorization=Bearer"),
    );

    expect(sink).toHaveBeenCalledWith({
      event: "export-error",
      phase: "decoder-initialization",
      code: "EXPORT_ERROR",
      message: "Export failed during decoder-initialization",
    });
  });
});
