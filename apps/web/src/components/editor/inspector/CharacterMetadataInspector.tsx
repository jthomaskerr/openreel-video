import { useCallback, useState } from "react";
import type { Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";

interface Props { clip: Clip }

export function CharacterMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);
  const payload = (clip.metadata?.payload ?? clip.metadata ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(String(payload.name ?? clip.metadata?.label ?? ""));
  const [description, setDescription] = useState(String(payload.text ?? payload.description ?? ""));
  const [refImages, setRefImages] = useState(String(payload.referenceAssetIds ?? ""));

  const save = useCallback(() => {
    updateClipMetadata(clip.id, {
      label: name || "Character",
      payload: { ...payload, name: name || undefined, text: description || undefined, referenceAssetIds: refImages || undefined },
    });
  }, [clip.id, name, description, refImages, payload, updateClipMetadata]);

  return (
    <div className="space-y-3" data-testid="character-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Character</h3>

      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Character name"
          className="text-xs h-8"
        />
      </Field>

      <Field label="Description">
        <Input
          value={description}
          onChange={(e) => { setDescription(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Appearance, role, notes…"
          className="text-xs h-8"
        />
      </Field>

      <Field label="Reference Image IDs">
        <Input
          value={refImages}
          onChange={(e) => { setRefImages(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Comma-separated asset IDs"
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