import { useCallback, useState } from "react";
import type { Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";

interface Props { clip: Clip }

export function StyleMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);
  const payload = (clip.metadata?.payload ?? clip.metadata ?? {}) as Record<string, unknown>;

  const [stylePrompt, setStylePrompt] = useState(String(payload.text ?? clip.metadata?.label ?? ""));
  const [loraInfo, setLoraInfo] = useState(String(payload.loraId ?? payload.loraIds ?? ""));

  const save = useCallback(() => {
    updateClipMetadata(clip.id, {
      label: stylePrompt.slice(0, 60) || "Style",
      payload: { ...payload, text: stylePrompt || undefined, loraId: loraInfo || undefined },
    });
  }, [clip.id, stylePrompt, loraInfo, payload, updateClipMetadata]);

  return (
    <div className="space-y-3" data-testid="style-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Style</h3>

      <Field label="Style Prompt">
        <Input
          value={stylePrompt}
          onChange={(e) => { setStylePrompt(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Visual style description"
          className="text-xs h-8"
        />
      </Field>

      <Field label="LoRA / Style Inputs">
        <Input
          value={loraInfo}
          onChange={(e) => { setLoraInfo(e.target.value); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="LoRA ID or comma-separated list"
          className="text-xs h-8"
        />
      </Field>

      <p className="text-[10px] text-text-muted">
        Applies as optional generation context for selected timeline range.
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