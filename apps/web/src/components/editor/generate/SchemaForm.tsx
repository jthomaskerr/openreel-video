/**
 * SchemaForm — renders a form dynamically from a WaveSpeed JSON Schema.
 *
 * Supports: textarea (x-ui-component=textarea), select (enum), number (slider),
 * string input, uploader (url input for image/video fields), array of urls.
 * Fields are rendered in x-order-properties order when present.
 */

import { Input, Label, Slider, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import type { SchemaProperty } from "../../../services/wavespeed/index";

interface SchemaFormProps {
  schema: {
    properties: Record<string, SchemaProperty>;
    required?: string[];
    "x-order-properties"?: string[];
  };
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Fields to skip (already handled by the parent, e.g. image uploader) */
  skip?: string[];
}

function fieldOrder(schema: SchemaFormProps["schema"]): string[] {
  const order = schema["x-order-properties"];
  const keys = Object.keys(schema.properties);
  if (!order) return keys;
  const ordered = order.filter((k) => k in schema.properties);
  const rest = keys.filter((k) => !order.includes(k));
  return [...ordered, ...rest];
}

function FieldLabel({ name, prop, required }: { name: string; prop: SchemaProperty; required?: boolean }) {
  const label = prop.title ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Label className="text-xs text-text-secondary mb-1 block">
      {label}{required && <span className="text-red-400 ml-0.5">*</span>}
    </Label>
  );
}

function TextField({
  prop, value, onChange, rows,
}: { name?: string; prop: SchemaProperty; value: string; onChange: (v: string) => void; rows?: number }) {
  if (rows && rows > 1) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={prop.maxLength}
        placeholder={prop.description}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={prop.maxLength}
      placeholder={prop.description}
      className="text-xs h-7"
    />
  );
}

function EnumField({ prop, value, onChange }: { prop: SchemaProperty; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {prop.enum!.map((opt) => (
          <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberField({ prop, value, onChange }: { prop: SchemaProperty; value: number; onChange: (v: number) => void }) {
  const min = prop.minimum ?? 0;
  const max = prop.maximum ?? 100;
  return (
    <div className="flex items-center gap-3">
      <Slider
        min={min}
        max={max}
        step={prop.type === "integer" ? 1 : (max - min) / 100}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
      <span className="text-xs text-text-secondary w-10 text-right tabular-nums">{value}</span>
    </div>
  );
}

/** URL input for uploader-type fields (image/video URLs) */
function UrlField({ prop, value, onChange }: { prop: SchemaProperty; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={prop.description ?? "https://…"}
      className="text-xs h-7 font-mono"
    />
  );
}

export function SchemaForm({ schema, values, onChange, skip = [] }: SchemaFormProps) {
  const keys = fieldOrder(schema).filter((k) => !skip.includes(k));

  function set(key: string, val: unknown) {
    onChange({ ...values, [key]: val });
  }

  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const prop = schema.properties[key];
        if (!prop) return null;
        const isRequired = schema.required?.includes(key) ?? false;
        const rawVal = key in values ? values[key] : prop.default;
        const uiComp = prop["x-ui-component"];

        return (
          <div key={key}>
            <FieldLabel name={key} prop={prop} required={isRequired} />
            {prop.description && (
              <p className="text-[10px] text-text-muted mb-1">{prop.description}</p>
            )}

            {/* Enum → Select */}
            {prop.enum && (
              <EnumField prop={prop} value={String(rawVal ?? prop.default ?? prop.enum[0])} onChange={(v) => set(key, v)} />
            )}

            {/* Numeric → Slider (only when bounded) */}
            {!prop.enum && (prop.type === "integer" || prop.type === "number") && prop.maximum != null && (
              <NumberField prop={prop} value={Number(rawVal ?? prop.default ?? prop.minimum ?? 0)} onChange={(v) => set(key, v)} />
            )}

            {/* Unbounded integer/number → plain input */}
            {!prop.enum && (prop.type === "integer" || prop.type === "number") && prop.maximum == null && (
              <Input
                type="number"
                value={String(rawVal ?? prop.default ?? "")}
                min={prop.minimum}
                onChange={(e) => set(key, prop.type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
                className="text-xs h-7"
              />
            )}

            {/* String with uploader → URL input */}
            {prop.type === "string" && !prop.enum && (uiComp === "uploader" || uiComp === "uploaders" || prop.format === "uri") && (
              <UrlField prop={prop} value={String(rawVal ?? "")} onChange={(v) => set(key, v)} />
            )}

            {/* Plain string → textarea or input */}
            {prop.type === "string" && !prop.enum && uiComp !== "uploader" && uiComp !== "uploaders" && prop.format !== "uri" && (
              <TextField
                name={key}
                prop={prop}
                value={String(rawVal ?? "")}
                onChange={(v) => set(key, v)}
                rows={prop["x-rows"]}
              />
            )}

            {/* Boolean → checkbox */}
            {prop.type === "boolean" && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(rawVal ?? prop.default ?? false)}
                  onChange={(e) => set(key, e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-xs text-text-secondary">Enable</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
