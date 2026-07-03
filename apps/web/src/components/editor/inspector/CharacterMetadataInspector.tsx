import { useCallback, useMemo, useState } from "react";
import type { Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { ReferenceImages } from "./ReferenceImages";

interface Props { clip: Clip }

export function CharacterMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);
  const payload = useMemo(() => {
    const merged: Record<string, unknown> = clip.metadata ? { ...clip.metadata } : {};
    const nestedPayload = clip.metadata?.payload;
    if (nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)) {
      Object.assign(merged, nestedPayload);
    }
    return merged;
  }, [clip.metadata]);

  const [name, setName] = useState(String(payload.name ?? clip.metadata?.label ?? ""));
  const [description, setDescription] = useState(String(payload.text ?? payload.description ?? ""));

  const save = useCallback(() => {
    updateClipMetadata(clip.id, {
      label: name || "Character",
      name: name || undefined,
      text: description || undefined,
      description: description || undefined,
      payload: { ...payload, name: name || undefined, text: description || undefined, description: description || undefined },
    });
  }, [clip.id, name, description, payload, updateClipMetadata]);

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
        <textarea
          value={description}
          onChange={(e) => { setDescription(e.target.value); }}
          onBlur={save}
          placeholder="Appearance, role, notes…"
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </Field>

      <ReferenceImages clip={clip} metadataKey="referenceImageUrls" />
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