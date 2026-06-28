import type { Clip } from "@openreel/core";

export function SceneMetadataInspector({ clip }: { clip: Clip }) {
  const payload = (clip.metadata?.payload ?? clip.metadata ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-3" data-testid="scene-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Scene</h3>
      <Field label="Prompt" value={String(payload.text ?? clip.metadata?.label ?? "")} />
      <Field label="Reference Assets" value={String(payload.referenceAssetIds ?? "None")} />
      <Field label="Generate" value="Use Generate Image/Video from AI Tools for this shot." />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-text-muted">{label}</p><p className="text-xs text-text-primary">{value}</p></div>;
}
