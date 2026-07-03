import { useCallback, useState } from "react";
import type { Clip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

interface Props { clip: Clip }

/** Director-specific fields from neuralframes note blocks. */
const DIRECTOR_FIELDS = [
  { key: "storyboard_prompt", label: "Storyboard Prompt" },
  { key: "video_idea", label: "Video Idea" },
  { key: "storyboard_style_prompt", label: "Storyboard Style Prompt" },
  { key: "text", label: "Text" },
] as const;

export function DirectorNotesInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);

  const payload = (clip.metadata?.payload ?? {}) as Record<string, unknown>;

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      DIRECTOR_FIELDS.map(({ key }) => [key, String(payload[key] ?? "")]),
    ),
  );

  const saveField = useCallback(
    (key: string) => {
      const value = fieldValues[key] ?? "";
      updateClipMetadata(clip.id, {
        [key]: value,
        payload: { ...payload, [key]: value },
      });
    },
    [clip.id, fieldValues, payload, updateClipMetadata],
  );

  return (
    <div className="space-y-3 p-3" data-testid="director-notes-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Director Notes</h3>

      {DIRECTOR_FIELDS.map(({ key, label }) => {
        const raw = fieldValues[key] ?? "";
        return (
          <Field key={key} label={label}>
            <textarea
              value={raw}
              onChange={(e) =>
                setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))
              }
              onBlur={() => saveField(key)}
              rows={3}
              placeholder={`Enter ${label.toLowerCase()}…`}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}
