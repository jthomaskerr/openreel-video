import React from "react";

export type MetadataKind = "music-video" | "scene" | "character" | "style";

interface Props {
  clipId: string;
  kind: string | undefined;
}

function KindShell({ label }: { label: string }) {
  return (
    <div className="p-3 space-y-1" data-kind-shell={label}>
      <h3 className="text-xs font-semibold text-text-primary">{label}</h3>
    </div>
  );
}

function UnknownKindFallback({ kind }: { kind?: string }) {
  return (
    <div className="p-3 text-[10px] text-text-secondary" data-kind-shell="unknown">
      {kind ? `Metadata clip: ${kind}` : "Metadata clip"}
    </div>
  );
}

/**
 * Routes a selected metadata clip to its kind-specific inspector shell.
 * Unknown kinds render a minimal read-only fallback rather than crashing.
 */
export function MetadataClipInspector({ clipId: _clipId, kind }: Props) {
  switch (kind) {
    case "music-video":
      return <KindShell label="Music Video" />;
    case "scene":
      return <KindShell label="Scene" />;
    case "character":
      return <KindShell label="Character" />;
    case "style":
      return <KindShell label="Style" />;
    default:
      return <UnknownKindFallback kind={kind} />;
  }
}
