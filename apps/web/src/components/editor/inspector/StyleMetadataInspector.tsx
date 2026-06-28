import type { Clip } from "@openreel/core";

export function StyleMetadataInspector({ clip }: { clip: Clip }) {
  const payload = (clip.metadata?.payload ?? clip.metadata ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-3" data-testid="style-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Style</h3>
      <Field label="Style Prompt" value={String(payload.text ?? clip.metadata?.label ?? "")} />
      <Field label="LoRA / Style Inputs" value={String(payload.loraId ?? payload.loraIds ?? "None")} />
      <Field label="Generation Input" value="Applies as optional generation context for selected timeline range." />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-text-muted">{label}</p><p className="text-xs text-text-primary">{value}</p></div>;
}
