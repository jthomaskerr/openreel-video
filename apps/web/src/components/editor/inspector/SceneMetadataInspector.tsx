import { useCallback, useMemo, useState } from "react";
import type { Clip } from "@openreel/core";
import { User, Edit2 } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { ReferenceImages } from "./ReferenceImages";

interface Props { clip: Clip }

/** A character name + clip ID resolved from the project's character tracks. */
interface CharacterRef {
  clipId: string;
  trackId: string;
  /** The character's NeuralFrames ID (used as the token inside the prompt) */
  characterId: string;
  name: string;
  thumbnailUrl: string | null;
}

/** One segment of a parsed prompt — either plain text or a character reference. */
type PromptToken =
  | { kind: "text"; value: string }
  | { kind: "character"; ref: CharacterRef };

function parsePrompt(text: string, characters: CharacterRef[]): PromptToken[] {
  if (!text || characters.length === 0) return [{ kind: "text", value: text }];

  const refsByToken = new Map<string, CharacterRef>();
  for (const character of characters) {
    refsByToken.set(character.characterId.toLowerCase(), character);
    refsByToken.set(character.name.toLowerCase().replace(/\s+/g, "_"), character);
  }

  const tokens: PromptToken[] = [];
  const pattern = /@([A-Za-z0-9_.-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const ref = refsByToken.get(match[1].toLowerCase());
    if (!ref) continue;
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    tokens.push({ kind: "character", ref });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ kind: "text", value: text }];
}

export function SceneMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);
  const tracks = useProjectStore((s) => s.project.timeline.tracks);
  const select = useUIStore((s) => s.select);

  const payload = useMemo(() => {
    const merged: Record<string, unknown> = clip.metadata ? { ...clip.metadata } : {};
    const nestedPayload = clip.metadata?.payload;
    if (nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)) {
      Object.assign(merged, nestedPayload);
    }
    return merged;
  }, [clip.metadata]);
  const [prompt, setPrompt] = useState(
    String(payload.prompt ?? payload.text ?? clip.metadata?.label ?? ""),
  );
  const [editing, setEditing] = useState(false);

  const save = useCallback(() => {
    updateClipMetadata(clip.id, {
      label: prompt.slice(0, 60) || "Scene",
      prompt: prompt || undefined,
      text: prompt || undefined,
      payload: { ...payload, prompt: prompt || undefined, text: prompt || undefined },
    });
    setEditing(false);
  }, [clip.id, prompt, payload, updateClipMetadata]);

  // Collect character refs: character tracks have clips using the same media item,
  // with metadata.kind === "character". The character ID is stored as metadata.importId.
  const characters = useMemo<CharacterRef[]>(() => {
    const refs: CharacterRef[] = [];
    for (const track of tracks) {
      for (const c of track.clips) {
        const meta: Record<string, unknown> = c.metadata ? { ...c.metadata } : {};
        const nestedPayload = c.metadata?.payload;
        if (nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)) {
          Object.assign(meta, nestedPayload);
        }
        if (meta.kind !== "character") continue;
        const characterId = String(meta.importId ?? "");
        const name = String(meta.name ?? meta.label ?? "");
        if (!characterId || !name) continue;
        // Only add once per character ID (multiple clips share the same character)
        if (!refs.some((r) => r.characterId === characterId)) {
          refs.push({
            clipId: c.id,
            trackId: track.id,
            characterId,
            name,
            thumbnailUrl: String(meta.thumbnailUrl ?? "") || null,
          });
        }
      }
    }
    return refs;
  }, [tracks]);

  const tokens = useMemo(
    () => parsePrompt(prompt, characters),
    [prompt, characters],
  );

  // Reference image URL stored in clip metadata from the scene reference image


  return (
    <div className="space-y-3" data-testid="scene-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Scene</h3>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-text-muted">Prompt</p>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-[10px] text-text-muted hover:text-text-primary flex items-center gap-0.5"
              title="Edit prompt"
            >
              <Edit2 size={10} />
              <span>Edit</span>
            </button>
          )}
        </div>

        {editing ? (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="Scene description / generation prompt"
            className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            autoFocus
          />
        ) : (
          <div
            className="text-[11px] text-text-primary leading-relaxed rounded border border-border bg-background-secondary px-2 py-1.5 min-h-[2rem] cursor-text"
            onClick={() => setEditing(true)}
          >
            {tokens.length === 0 || (tokens.length === 1 && tokens[0]?.kind === "text" && !tokens[0].value) ? (
              <span className="text-text-muted">Scene description / generation prompt</span>
            ) : (
              tokens.map((token, i) =>
                token.kind === "text" ? (
                  <span key={i}>{token.value}</span>
                ) : (
                  <CharacterPill
                    key={i}
                    ref_={token.ref}
                    onSelect={() =>
                      select({ type: "clip", id: token.ref.clipId, trackId: token.ref.trackId })
                    }
                  />
                ),
              )
            )}
          </div>
        )}
      </div>

      <ReferenceImages clip={clip} metadataKey="referenceImageUrls" title="Scene Reference Images" />

      <p className="text-[10px] text-text-muted">
        Use Generate Image/Video from AI Tools for this shot.
      </p>
    </div>
  );
}

function CharacterPill({
  ref_,
  onSelect,
}: {
  ref_: CharacterRef;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      title={`Select ${ref_.name} clip`}
      className="inline-flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-300 hover:bg-purple-500/20 transition-colors"
    >
      {ref_.thumbnailUrl ? (
        <img
          src={ref_.thumbnailUrl}
          alt={ref_.name}
          className="w-3 h-3 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <User size={10} className="flex-shrink-0" />
      )}
      <span>{ref_.name}</span>
    </button>
  );
}

