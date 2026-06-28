import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "../../../stores/project-store";
import { addTimelineMetadataClip, type MetadataClipStore } from "../timeline/metadata-clips";
import type { NeuralFramesImportResult, NeuralFramesStoryboard } from "@openreel/music-video-domain";
import type { MediaItem } from "@openreel/core";

/** Map NeuralFrames MetadataBlockKind → MetadataKind for timeline clips. */
function blockKindToMetadataKind(kind: string): string {
  if (kind === "section") return "scene";
  if (kind === "continuity_note") return "character";
  if (kind === "visual_motif") return "style";
  return kind;
}

interface Props {
  openreelProjectId: string;
  orchestratorUrl: string;
  onImported?: () => void;
}

export const NeuralFramesImportTab: React.FC<Props> = ({
  orchestratorUrl,
  onImported,
}) => {
  const { addTrack, addClip, addPlaceholderMedia, replacePlaceholderMedia, addGeneratedMedia, renameTrack } = useProjectStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setStatus("loading");
    setProgress("Parsing…");
    setMessage("");

    let raw: NeuralFramesStoryboard;
    try {
      raw = JSON.parse(await file.text()) as NeuralFramesStoryboard;
    } catch {
      setStatus("error");
      setMessage("Not valid JSON.");
      return;
    }

    let result: NeuralFramesImportResult;
    try {
      setProgress("Importing scenes…");
      const res = await fetch(`${orchestratorUrl}/api/import/neuralframes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });
      const data = (await res.json()) as NeuralFramesImportResult & { error?: string };
      if (!res.ok || data.error) {
        setStatus("error");
        setMessage(data.error ?? "Import failed");
        return;
      }
      result = data;
    } catch (e) {
      setStatus("error");
      setMessage((e as Error).message);
      return;
    }

    // ── Each MetadataTrack → real metadata clips via addTimelineMetadataClip ──
    const storeIface: MetadataClipStore = {
      get project() { return useProjectStore.getState().project; },
      addTrack,
      renameTrack,
      addGeneratedMedia,
      addClip,
    };

    for (const track of result.metadataTracks) {
      setProgress(`Creating track "${track.label}"…`);
      for (const block of track.blocks) {
        const duration = (block.endSeconds ?? block.startSeconds + 1) - block.startSeconds;
        await addTimelineMetadataClip(storeIface, {
          trackName: track.label,
          kind: blockKindToMetadataKind(block.kind),
          label: block.label,
          color: block.color ?? "#94a3b8",
          startTime: block.startSeconds,
          duration,
          metadata: {
            text: block.text,
            importSource: block.importSource,
            importId: block.importId,
            source: block.source,
          },
        });
      }
    }

    // ── Scene images → media library, flagged as generated ───────────────────
    let imageCount = 0;
    for (let i = 0; i < result.generatedAssets.length; i++) {
      const asset = result.generatedAssets[i];
      if (!asset.outputPath) continue;

      const mediaId = uuidv4();
      const name = `${result.title} — Scene ${i + 1}.jpg`;

      setProgress(`Adding image ${i + 1} / ${result.generatedAssets.length}…`);

      const placeholder: MediaItem = {
        id: mediaId,
        name,
        type: "image",
        fileHandle: null,
        blob: null,
        metadata: { duration: 0, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
        thumbnailUrl: asset.outputPath,
        waveformData: null,
        isPlaceholder: false,
      };
      addPlaceholderMedia(placeholder);

      // Fetch blob in background; clip.metadata.isGenerated marks it in the timeline
      fetch(asset.outputPath)
        .then((r) => r.blob())
        .then((blob) => replacePlaceholderMedia(mediaId, blob, name))
        .catch((err) => console.warn(`[NF] image ${i + 1}:`, err));

      imageCount++;
    }

    setStatus("done");
    setMessage(
      `${result.metadataTracks.length} tracks · ${result.shots.length} blocks · ${imageCount} images in media library`,
    );
    setTimeout(() => onImported?.(), 600);
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-white/50 text-xs">
        Import a Neural Frames storyboard. Each scene group becomes a metadata
        track; scene images land in the media library.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        disabled={status === "loading"}
        className="w-full border border-dashed border-white/20 hover:border-blue-400/60 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg py-8 flex flex-col items-center gap-2 text-white/40 hover:text-white/70 transition-colors cursor-pointer"
      >
        <Upload size={20} />
        <span className="text-xs">
          {status === "loading"
            ? progress
            : fileName || "Click or drop a .storyboard.json file"}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {status === "done" && (
        <div className="rounded bg-green-500/10 border border-green-500/20 px-3 py-2 text-green-300 text-xs">
          ✓ {message}
        </div>
      )}
      {status === "error" && (
        <div className="rounded bg-red-500/10 border border-red-500/20 px-3 py-2 text-red-300 text-xs">
          ✕ {message}
        </div>
      )}
    </div>
  );
};
