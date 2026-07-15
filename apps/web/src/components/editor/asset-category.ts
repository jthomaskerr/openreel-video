import type { MediaItem } from "@openreel/core";
import { normalizeSceneProjectionMetadata } from "@openreel/music-video-domain";

export type AssetCategory =
  | "video"
  | "audio"
  | "image"
  | "scene"
  | "character"
  | "note"
  | "style"
  | "music-video"
  | "metadata";

export interface ResolvedAssetCategory {
  category: AssetCategory;
  label: string;
  isMetadata: boolean;
  metadataKind?: string;
}

const METADATA_LABELS: Record<string, string> = {
  scene: "Scenes",
  character: "Characters",
  note: "Notes",
  style: "Styles",
  "music-video": "Music Videos",
  section: "Scenes",
  continuity_note: "Characters",
  visual_motif: "Styles",
};

export function resolveAssetCategory(item: MediaItem): ResolvedAssetCategory {
  const metadataKind = readMetadataKind(item);
  if (metadataKind) {
    const category = normalizeMetadataKind(metadataKind);
    return {
      category,
      label: METADATA_LABELS[metadataKind] ?? METADATA_LABELS[category] ?? "Metadata",
      isMetadata: true,
      metadataKind,
    };
  }

  if (item.type === "video") return { category: "video", label: "Videos", isMetadata: false };
  if (item.type === "audio") return { category: "audio", label: "Audio", isMetadata: false };
  return { category: "image", label: "Images", isMetadata: false };
}

function normalizeMetadataKind(kind: string): AssetCategory {
  if (kind === "section") return "scene";
  if (kind === "continuity_note") return "character";
  if (kind === "visual_motif") return "style";
  if (kind === "scene" || kind === "character" || kind === "note" || kind === "style" || kind === "music-video") return kind;
  return "metadata";
}

function readMetadataKind(item: MediaItem): string | undefined {
  const raw = item.sourceFile?.folder;
  if (!raw?.trim().startsWith("{")) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (normalizeSceneProjectionMetadata(parsed)) return "scene";
    return typeof parsed["kind"] === "string" && parsed["kind"].trim()
      ? parsed["kind"]
      : undefined;
  } catch {
    return undefined;
  }
}
