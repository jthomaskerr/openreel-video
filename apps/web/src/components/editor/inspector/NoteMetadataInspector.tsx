import { useCallback, useState, useMemo } from "react";
import type { Clip } from "@openreel/core";
import { Input } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";

interface Props { clip: Clip }

/** Reserved keys handled separately (label, color) or structural (kind, payload). */
const RESERVED_KEYS: Record<string, true> = {
  kind: true,
  label: true,
  color: true,
  payload: true,
};

/** Keys whose values are long-form prose → use a textarea. */
const TEXTAREA_KEY_PATTERNS = [
  "text", "prompt", "idea", "description", "note", "brief", "style",
];

function isTextareaKey(key: string): boolean {
  const lower = key.toLowerCase();
  return TEXTAREA_KEY_PATTERNS.some((p) => lower.includes(p));
}

function isColorValue(value: unknown): boolean {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function humanLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function NoteMetadataInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);

  const reservedColor = String(clip.metadata?.color ?? "#94a3b8");
  const payload = (clip.metadata?.payload ?? {}) as Record<string, unknown>;

  // Collect all editable fields: top-level metadata + payload, deduplicated
  const allFields = useMemo(() => {
    const seen = new Set<string>();
    const fields: Array<[string, unknown]> = [];

    const add = (key: string, value: unknown) => {
      if (RESERVED_KEYS[key] || seen.has(key)) return;
      if (typeof value !== "string" && typeof value !== "number") return;
      seen.add(key);
      fields.push([key, value]);
    };

    // Top-level metadata first
    if (clip.metadata) {
      for (const [key, value] of Object.entries(clip.metadata)) {
        add(key, value);
      }
    }
    // Then payload (deduped by seen)
    for (const [key, value] of Object.entries(payload)) {
      add(key, value);
    }

    return fields;
  }, [clip.metadata, payload]);

  const [label, setLabel] = useState(String(clip.metadata?.label ?? "Note"));
  const [color, setColor] = useState(reservedColor);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(allFields.map(([k, v]) => [k, String(v ?? "")])),
  );

  const saveReserved = useCallback(() => {
    updateClipMetadata(clip.id, { label: label || "Note", color });
  }, [clip.id, label, color, updateClipMetadata]);

  const saveField = useCallback(
    (key: string) => {
      const value = fieldValues[key] ?? "";
      updateClipMetadata(clip.id, {
        [key]: value || undefined,
        payload: { ...payload, [key]: value || undefined },
      });
    },
    [clip.id, fieldValues, payload, updateClipMetadata],
  );

  return (
    <div className="space-y-3 p-3" data-testid="note-metadata-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Note</h3>

      {/* ── Reserved fields ────────────────────────────────────── */}
      <Field label="Label">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveReserved}
          onKeyDown={(e) => { if (e.key === "Enter") saveReserved(); }}
          placeholder="Note label"
          className="text-xs h-8"
        />
      </Field>

      <Field label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              updateClipMetadata(clip.id, { color: e.target.value });
            }}
            className="w-6 h-6 rounded border border-border cursor-pointer"
          />
          <span className="text-[10px] font-mono text-text-muted uppercase">{color}</span>
        </div>
      </Field>

      {/* ── All metadata fields ───────────────────────────────── */}
      {allFields.map(([key]) => {
        const raw = fieldValues[key] ?? "";
        const asColor = isColorValue(raw);
        const isArea = isTextareaKey(key);

        if (asColor) {
          return (
            <Field key={key} label={humanLabel(key)}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={raw}
                  onChange={(e) => {
                    setFieldValues((prev) => ({ ...prev, [key]: e.target.value }));
                    updateClipMetadata(clip.id, {
                      [key]: e.target.value,
                      payload: { ...payload, [key]: e.target.value },
                    });
                  }}
                  className="w-6 h-6 rounded border border-border cursor-pointer"
                />
                <span className="text-[10px] font-mono text-text-muted uppercase">{raw}</span>
              </div>
            </Field>
          );
        }

        if (isArea) {
          return (
            <Field key={key} label={humanLabel(key)}>
              <textarea
                value={raw}
                onChange={(e) =>
                  setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))
                }
                onBlur={() => saveField(key)}
                rows={Math.min(8, Math.max(3, raw.split("\n").length))}
                placeholder={`Enter ${humanLabel(key).toLowerCase()}…`}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </Field>
          );
        }

        return (
          <Field key={key} label={humanLabel(key)}>
            <Input
              value={raw}
              onChange={(e) =>
                setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))
              }
              onBlur={() => saveField(key)}
              onKeyDown={(e) => { if (e.key === "Enter") saveField(key); }}
              placeholder={`Enter ${humanLabel(key).toLowerCase()}…`}
              className="text-xs h-8"
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
