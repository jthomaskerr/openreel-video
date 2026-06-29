import { useCallback, useState } from "react";
import type { Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";

interface Props { clip: Clip }

export function SceneMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);
  const payload = (clip.metadata?.payload ?? clip.metadata ?? {}) as Record<string, unknown>;

  const [prompt, setPrompt] = useState(String(payload.text ?? clip.metadata?.label ?? ""));
  const [refAssets, setRefAssets] = useState(String(payload.referenceAssetIds ?? ""));

  const save = useCallback(() => {
    updateClipMetadata(clip.id, {
      label: prompt.slice(0, 60) || "Scene",
      payload: { ...payload, text: prompt || undefined, referenceAssetIds: refAssets || undefined },
    });
  }, [clip.id, prompt, refAssets, payload, updateClipMetadata]);

  return (
    <div className="space-y-3" data-testid="scene-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Scene</h3>

      <Field label="Prompt">
        <Input
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Scene description / generation prompt"
          className="text-xs h-8"
        />
      </Field>

      <Field label="Reference Asset IDs">
        <Input
          value={refAssets}
          onChange={(e) => { setRefAssets(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Comma-separated asset IDs"
          className="text-xs h-8"
        />
      </Field>

      <p className="text-[10px] text-text-muted">
        Use Generate Image/Video from AI Tools for this shot.
      </p>
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