import { useCallback, useState } from "react";
import type { Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";

interface Props { clip: Clip }

export function NoteMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);
  const payload = (clip.metadata?.payload ?? clip.metadata ?? {}) as Record<string, unknown>;

  const [label, setLabel] = useState(String(clip.metadata?.label ?? "Note"));
  const [text, setText] = useState(String(payload.text ?? ""));

  const save = useCallback(() => {
    updateClipMetadata(clip.id, {
      label: label || "Note",
      payload: { ...payload, text: text || undefined },
    });
  }, [clip.id, label, text, payload, updateClipMetadata]);

  return (
    <div className="space-y-3" data-testid="note-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Note</h3>

      <Field label="Label">
        <Input
          value={label}
          onChange={(e) => { setLabel(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Note label"
          className="text-xs h-8"
        />
      </Field>

      <Field label="Note Text">
        <Input
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Director note, lyric, or production reminder"
          className="text-xs h-8"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-text-muted">{label}</p>
      {children}
    </div>
  );
}
