import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";

vi.mock("@openreel/core", () => ({
  getDeviceProfile: vi.fn(() => new Promise(() => {})),
  estimateExportTime: vi.fn(),
  runBenchmark: vi.fn(),
  getCodecRecommendations: vi.fn(() => []),
  formatDeviceSummary: vi.fn(() => ""),
  shouldRecommendBenchmark: vi.fn(() => false),
}));

vi.mock("../../services/export-presets", () => {
  const preset = {
    id: "test-preset",
    name: "Test Preset",
    description: "Deterministic test preset",
    platform: "YouTube",
    aspectRatio: "16:9",
    recommended: true,
    settings: {
      format: "mp4",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 8000,
      bitrateMode: "vbr",
      quality: 90,
      keyframeInterval: 60,
      audioSettings: {
        format: "aac",
        sampleRate: 48000,
        bitDepth: 16,
        bitrate: 256,
        channels: 2,
      },
    },
  };
  return {
    exportPresetsManager: {
      getAllPresets: () => [preset],
      getPlatforms: () => ["YouTube"],
      getRecommendedPresets: () => [preset],
    },
  };
});

describe("ExportDialog section range", () => {
  it("exports the selected timeline section for both video and audio", () => {
    const onExport = vi.fn();
    const onClose = vi.fn();
    render(
      <ExportDialog
        isOpen
        onClose={onClose}
        onExport={onExport}
        duration={10}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Test Preset/ }));
    fireEvent.change(screen.getByLabelText("Start (seconds)"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("End (seconds)"), {
      target: { value: "4.5" },
    });
    const startExport = screen.getByRole("button", { name: "Start Export" });
    expect(startExport).toBeEnabled();
    fireEvent.click(startExport);

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        range: { startTime: 2, endTime: 4.5 },
        audioSettings: expect.objectContaining({
          range: { startTime: 2, endTime: 4.5 },
        }),
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks reversed or zero-length sections", () => {
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        onExport={vi.fn()}
        duration={10}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Test Preset/ }));
    fireEvent.change(screen.getByLabelText("Start (seconds)"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("End (seconds)"), {
      target: { value: "5" },
    });

    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start Export" })).toBeDisabled();
  });
});
