import "../../../test/install-local-storage-mock";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { ContextMenu, ContextMenuTrigger } from "@openreel/ui";
import { ClipContextMenu } from "./ClipContextMenu";
import { useProjectStore } from "../../../stores/project-store";

function makeClip(): Clip {
  return {
    id: "clip-1",
    type: "video",
    mediaId: "missing-media",
    trackId: "track-1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
    volume: 1,
    keyframes: []
  };
}

function makeTrack(clip: Clip): Track {
  return { id: "track-1", type: "video", name: "Video", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false };
}

function missingMedia(): MediaItem {
  return {
    id: "missing-media",
    name: "missing.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: { duration: 5, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
    thumbnailUrl: null,
  };
}

describe("ClipContextMenu missing media", () => {
  it("offers a link file action for placeholder media", () => {
    const clip = makeClip();
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [missingMedia()] },
        timeline: { ...state.project.timeline, tracks: [makeTrack(clip)] }
      }
    }));

    render(
      <ContextMenu>
        <ContextMenuTrigger>clip</ContextMenuTrigger>
        <ClipContextMenu clip={clip} track={makeTrack(clip)} onClose={vi.fn()} />
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText("clip"));

    expect(screen.getByText("Link File…")).toBeInTheDocument();
    expect(screen.getByText("Missing media placeholder")).toBeInTheDocument();
  });
});
