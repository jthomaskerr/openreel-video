import type { Clip } from "@openreel/core";

export function CharacterMetadataInspector({ clip }: { clip: Clip }) {
  const payload = (clip.metadata?.payload ?? clip.metadata ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-3" data-testid="character-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Character</h3>
      <Field label="Name" value={String(clip.metadata?.label ?? payload.name ?? "Character")} />
      <Field label="Description" value={String(payload.text ?? payload.description ?? "")} />
      <Field label="Reference Images" value={String(payload.referenceAssetIds ?? "None")} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-text-muted">{label}</p><p className="text-xs text-text-primary">{value}</p></div>;
}
