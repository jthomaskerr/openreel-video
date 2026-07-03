import { useCallback, useEffect, useMemo, useState } from "react";
import type { Clip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { ReferenceImages } from "./ReferenceImages";

interface Props { clip: Clip }

const HIDDEN_FIELDS = new Set(["payload"]);

export function DirectorNotesInspector({ clip }: Props) {
  const updateClipMetadata = useProjectStore((s) => s.updateClipMetadata);

  const payload = useMemo(() => {
    const merged: Record<string, unknown> = clip.metadata ? { ...clip.metadata } : {};
    const nestedPayload = clip.metadata?.payload;
    if (nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)) {
      Object.assign(merged, nestedPayload);
    }
    return merged;
  }, [clip.metadata]);

  const nestedPayload = useMemo(() => {
    const nextPayload: Record<string, unknown> = {};
    const rawPayload = clip.metadata?.payload;
    if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
      Object.assign(nextPayload, rawPayload);
    }
    return nextPayload;
  }, [clip.metadata]);

  const metadataFields = useMemo(
    () =>
      Object.entries(payload)
        .filter(([key]) => !HIDDEN_FIELDS.has(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    [payload],
  );

  const initialValues = useMemo(
    () =>
      Object.fromEntries(
        metadataFields.map(([key, value]) => [key, formatMetadataValue(value)]),
      ),
    [metadataFields],
  );

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialValues);

  useEffect(() => {
    setFieldValues(initialValues);
  }, [initialValues]);

  const saveField = useCallback(
    (key: string) => {
      const value = parseMetadataValue(fieldValues[key] ?? "");
      updateClipMetadata(clip.id, {
        [key]: value,
        payload: { ...nestedPayload, [key]: value },
      });
    },
    [clip.id, fieldValues, nestedPayload, updateClipMetadata],
  );

  return (
    <div className="space-y-3 p-3" data-testid="director-notes-inspector">
      <h3 className="text-sm font-semibold text-text-primary">Director Notes</h3>

      {metadataFields.map(([key]) => {
        const raw = fieldValues[key] ?? "";
        return (
          <Field key={key} label={humanizeMetadataKey(key)}>
            <textarea
              value={raw}
              onChange={(e) =>
                setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))
              }
              onBlur={() => saveField(key)}
              rows={key === "text" || key.includes("prompt") ? 5 : 3}
              placeholder={`Enter ${humanizeMetadataKey(key).toLowerCase()}…`}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
        );
      })}

      <ReferenceImages clip={clip} metadataKey="referenceImageUrls" />
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

function humanizeMetadataKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMetadataValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function parseMetadataValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}
