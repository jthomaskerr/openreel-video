import { useCallback, useMemo, useState } from "react";
import type { Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { ReferenceImages } from "./ReferenceImages";

interface Props { clip: Clip }

export function StyleMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);
  const payload = useMemo(() => {
    const merged: Record<string, unknown> = clip.metadata ? { ...clip.metadata } : {};
    const nestedPayload = clip.metadata?.payload;
    if (nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)) {
      Object.assign(merged, nestedPayload);
    }
    return merged;
  }, [clip.metadata]);

  const [stylePrompt, setStylePrompt] = useState(String(payload.text ?? payload.description ?? clip.metadata?.label ?? ""));
  const [loraInfo, setLoraInfo] = useState(String(payload.loraId ?? payload.loraIds ?? ""));

  const save = useCallback(() => {
    updateClipMetadata(clip.id, {
      label: stylePrompt.slice(0, 60) || "Style",
      text: stylePrompt || undefined,
      description: stylePrompt || undefined,
      loraId: loraInfo || undefined,
      payload: { ...payload, text: stylePrompt || undefined, description: stylePrompt || undefined, loraId: loraInfo || undefined },
    });
  }, [clip.id, stylePrompt, loraInfo, payload, updateClipMetadata]);

  return (
    <div className="space-y-3" data-testid="style-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Style</h3>

      <Field label="Style Prompt">
        <textarea
          value={stylePrompt}
          onChange={(e) => { setStylePrompt(e.target.value); }}
          onBlur={save}
          placeholder="Visual style description"
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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


      <ReferenceImages clip={clip} metadataKey="trainingImageUrls" />
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