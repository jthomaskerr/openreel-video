import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetadataClipInspector } from "./MetadataClipInspector";

const CLIP_ID = "clip-meta-01";

describe("MetadataClipInspector routing", () => {
  it("renders music video inspector shell for kind music-video", () => {
    render(<MetadataClipInspector clipId={CLIP_ID} kind="music-video" />);
    expect(screen.getByText("Music Video")).toBeInTheDocument();
  });

  it("renders scene inspector shell for kind scene", () => {
    render(<MetadataClipInspector clipId={CLIP_ID} kind="scene" />);
    expect(screen.getByText("Scene")).toBeInTheDocument();
  });

  it("renders character inspector shell for kind character", () => {
    render(<MetadataClipInspector clipId={CLIP_ID} kind="character" />);
    expect(screen.getByText("Character")).toBeInTheDocument();
  });

  it("renders style inspector shell for kind style", () => {
    render(<MetadataClipInspector clipId={CLIP_ID} kind="style" />);
    expect(screen.getByText("Style")).toBeInTheDocument();
  });

  it("renders fallback for unknown kind without crash", () => {
    render(<MetadataClipInspector clipId={CLIP_ID} kind="unknown-kind" />);
    expect(screen.getByText(/unknown-kind/)).toBeInTheDocument();
  });

  it("renders fallback for undefined kind without crash", () => {
    render(<MetadataClipInspector clipId={CLIP_ID} kind={undefined} />);
    expect(screen.getByText(/Metadata clip/)).toBeInTheDocument();
  });
});
