import type { Clip } from "@openreel/core";
import { MusicVideoMetadataInspector } from "./MusicVideoMetadataInspector";
import { SceneMetadataInspector } from "./SceneMetadataInspector";
import { CharacterMetadataInspector } from "./CharacterMetadataInspector";
import { StyleMetadataInspector } from "./StyleMetadataInspector";

export type MetadataKind = "music-video" | "scene" | "character" | "style";

interface Props {
  clip: Clip;
  kind: string | undefined;
}

function UnknownKindFallback({ kind }: { kind?: string }) {
  return (
    <div className="p-3 text-[10px] text-text-secondary" data-kind-shell="unknown">
      {kind ? `Metadata clip: ${kind}` : "Metadata clip"}
    </div>
  );
}

/**
 * Routes a selected metadata clip to its kind-specific inspector.
 * Unknown kinds render a minimal read-only fallback rather than crashing.
 */
export function MetadataClipInspector({ clip, kind }: Props) {
  switch (kind) {
    case "music-video":
      return <MusicVideoMetadataInspector clip={clip} />;
    case "scene":
      return <SceneMetadataInspector clip={clip} />;
    case "character":
      return <CharacterMetadataInspector clip={clip} />;
    case "style":
      return <StyleMetadataInspector clip={clip} />;
    default:
      return <UnknownKindFallback kind={kind} />;
  }
}
