import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Clip } from "@openreel/core";
import { MetadataClipInspector } from "./MetadataClipInspector";

function makeClip(kind?: string): Clip {
  return {
    id: "clip-meta-01",
    type: "metadata",
    trackId: "metadata-track",
    mediaId: "media-1",
    startTime: 0,
    duration: 12,
    inPoint: 0,
    outPoint: 12,
    speed: 1,
    volume: 1,
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    effects: [],
    audioEffects: [],
    keyframes: [],
    metadata: kind ? { kind, label: kind, payload: { text: `${kind} text`, loraId: "lora-1" } } : {},
  };
}

describe("MetadataClipInspector routing", () => {
  it("renders music video workflow sections for kind music-video", () => {
    render(<MetadataClipInspector clip={makeClip("music-video")} kind="music-video" />);
    expect(screen.getByText("Music Video Workflow")).toBeInTheDocument();
    expect(screen.getByText("Brief")).toBeInTheDocument();
    expect(screen.getByText("Audio Analysis")).toBeInTheDocument();
    expect(screen.getByText("Storyboard")).toBeInTheDocument();
    expect(screen.getByText("Characters")).toBeInTheDocument();
    expect(screen.getByText("Reference Images")).toBeInTheDocument();
    expect(screen.getByText("Generation Jobs")).toBeInTheDocument();
    expect(screen.getByText("Shot Generation")).toBeInTheDocument();
  });

  it("renders scene inspector for kind scene", () => {
    render(<MetadataClipInspector clip={makeClip("scene")} kind="scene" />);
    expect(screen.getByTestId("scene-metadata-inspector")).toBeInTheDocument();
    expect(screen.getByText(/no usable scene ID/i)).toBeInTheDocument();
  });

  it("renders character inspector for kind character", () => {
    render(<MetadataClipInspector clip={makeClip("character")} kind="character" />);
    expect(screen.getByTestId("character-metadata-inspector")).toBeInTheDocument();
    expect(screen.getByTestId("reference-images")).toBeInTheDocument();
  });

  it("renders style inspector for kind style", () => {
    render(<MetadataClipInspector clip={makeClip("style")} kind="style" />);
    expect(screen.getByTestId("style-metadata-inspector")).toBeInTheDocument();
    expect(screen.getByText("LoRA / Style Inputs")).toBeInTheDocument();
  });
  it("renders note inspector for kind note", () => {
    render(<MetadataClipInspector clip={makeClip("note")} kind="note" />);
    expect(screen.getByTestId("note-metadata-inspector")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
  });


  it("renders fallback for unknown kind without crash", () => {
    render(<MetadataClipInspector clip={makeClip("unknown-kind")} kind="unknown-kind" />);
    expect(screen.getByText(/unknown-kind/)).toBeInTheDocument();
  });

  it("renders fallback for undefined kind without crash", () => {
    render(<MetadataClipInspector clip={makeClip()} kind={undefined} />);
    expect(screen.getByText(/Metadata clip/)).toBeInTheDocument();
  });
});
