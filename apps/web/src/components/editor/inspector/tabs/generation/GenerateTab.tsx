import React, { useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { generationDraftKey, useGenerationDraftStore, type GenerationDraftState } from "../../../../../features/generation/drafts";

export interface GenerateModel { id: string; label: string; provider?: string; modes?: Array<"image" | "video">; capabilities?: string[]; }
export interface GenerateReference { id: string; label: string; origins: string[]; excluded?: boolean; }
export interface GenerateJob { id: string; status: string; message?: string; progress?: number; error?: string; }
export interface GenerateTabProps {
  projectId?: string; shotId?: string; draftId?: string; context?: "shot" | "clip" | "asset" | "empty" | "unsupported";
  mode?: "image" | "video"; models?: GenerateModel[]; compatibleModelIds?: string[]; modelId?: string; onModelChange?: (id: string) => void;
  prompt?: string; onPromptChange?: (value: string) => void; characterSlugs?: string[]; promptErrors?: Record<string, string>;
  references?: GenerateReference[]; timing?: { start: number; end: number; source: string; reason?: string }; audioReason?: string;
  destination?: "none" | "create-linked-clip" | "replace-selected-clip-media"; job?: GenerateJob; submitting?: boolean;
  onSubmit?: (draft: GenerationDraftState) => void | Promise<void>; onCancel?: () => void; onRetry?: () => void; onSaveRetry?: () => void; onPlacementRetry?: () => void;
}

const section = "border-b border-border/60 py-3";
export const GenerateTab: React.FC<GenerateTabProps> = (props) => {
  const key = generationDraftKey({ projectId: props.projectId, shotId: props.shotId, draftId: props.draftId });
  const stored = useGenerationDraftStore((s) => s.drafts[key]);
  const save = useGenerationDraftStore((s) => s.saveDraft);
  const draft = stored ?? useGenerationDraftStore.getState().getDraft(key);
  const [prompt, setPrompt] = useState(props.prompt ?? draft.prompt);
  const [selectedModel, setSelectedModel] = useState(props.modelId ?? draft.modelId ?? props.models?.[0]?.id ?? "");
  const [submitted, setSubmitted] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const models = useMemo(() => (props.compatibleModelIds ? (props.models ?? []).filter((m) => props.compatibleModelIds!.includes(m.id)) : props.models ?? []), [props.models, props.compatibleModelIds]);
  const tokens = useMemo(() => [...prompt.matchAll(/@[a-z0-9_-]+/gi)].map((m) => m[0]), [prompt]);
  const errors = Object.values(props.promptErrors ?? {});
  const setModel = (id: string) => { setSelectedModel(id); save(key, { modelId: id }); props.onModelChange?.(id); };
  const updatePrompt = (value: string) => { setPrompt(value); save(key, { prompt: value }); props.onPromptChange?.(value); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (props.submitting || submitted) return; if (!prompt.trim() || errors.length) { promptRef.current?.focus(); return; } const next = { ...draft, key, modelId: selectedModel, prompt, updatedAt: Date.now() }; setSubmitted(true); await props.onSubmit?.(next); };
  if (props.context === "unsupported") return <div role="status" className="p-3 text-xs text-text-secondary">Generate is unavailable for this selection.</div>;
  return <form aria-label="Generate" onSubmit={submit} className="min-w-0 overflow-x-hidden text-xs text-text-primary" data-testid="generate-tab">
    <div className={section + " px-3"}><div className="flex items-center gap-2 font-semibold"><Sparkles size={14} aria-hidden /> Generate</div><p className="mt-1 text-[11px] text-text-secondary">{props.context === "shot" ? "Create a shot-aware image or video." : "Create a new visual asset."}</p></div>
    <div className={section + " space-y-2 px-3"}><label htmlFor="generate-model" className="font-medium">Model</label><select id="generate-model" aria-label="Model" value={selectedModel} onChange={(e) => setModel(e.target.value)} className="w-full min-h-9 rounded border border-border bg-background-secondary px-2 focus:outline-none focus:ring-2 focus:ring-primary">{models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.provider ? ` · ${m.provider}` : ""}</option>)}</select>{models.length === 0 && <p role="alert" className="text-red-400">No compatible models available.</p>}</div>
    <div className={section + " space-y-2 px-3"}><label htmlFor="generate-prompt" className="font-medium">Prompt</label><textarea ref={promptRef} id="generate-prompt" aria-describedby="generate-errors" value={prompt} onChange={(e) => updatePrompt(e.target.value)} rows={4} className="w-full resize-y rounded border border-border bg-background-secondary p-2 focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Describe the shot…" />{tokens.length > 0 && <div aria-label="Character mentions" className="flex flex-wrap gap-1">{tokens.map((token, i) => <span key={`${token}-${i}`} className="rounded-full bg-primary/15 px-2 py-1 text-[10px] text-primary">{token}</span>)}</div>}{errors.length > 0 && <div id="generate-errors" role="alert" className="space-y-1 text-red-400">{errors.map((error) => <p key={error}><AlertCircle size={12} className="mr-1 inline" />{error}</p>)}</div>}</div>
    <div className={section + " space-y-2 px-3"}><div className="font-medium">References</div>{props.references?.length ? <ul className="space-y-1">{props.references.map((ref) => <li key={ref.id} className={ref.excluded ? "text-text-secondary line-through" : ""}><span>{ref.label}</span><span className="ml-1 text-[10px] text-text-secondary">{ref.origins.join(" · ")}</span>{ref.excluded && <span className="ml-1 text-amber-400">excluded</span>}</li>)}</ul> : <p className="text-text-secondary">No references selected.</p>}</div>
    {(props.timing || props.audioReason) && <div className={section + " space-y-2 px-3"}>{props.timing && <div><span className="font-medium">Timing</span><span className="ml-2 text-text-secondary">{props.timing.start.toFixed(2)}–{props.timing.end.toFixed(2)}s · {props.timing.source}</span>{props.timing.reason && <p className="text-text-secondary">{props.timing.reason}</p>}</div>}{props.audioReason && <p><span className="font-medium">Audio</span><span className="ml-2 text-text-secondary">{props.audioReason}</span></p>}</div>}
    <div className={section + " space-y-2 px-3"}><label htmlFor="generate-destination" className="font-medium">Destination</label><select id="generate-destination" value={props.destination ?? draft.placementPolicy} onChange={(e) => save(key, { placementPolicy: e.target.value as GenerationDraftState["placementPolicy"] })} className="w-full min-h-9 rounded border border-border bg-background-secondary px-2"><option value="none">Keep as asset</option><option value="create-linked-clip">Create linked clip</option><option value="replace-selected-clip-media">Replace selected clip media</option></select></div>
    {props.job && <div className={section + " px-3"} role="status" aria-live="polite"><div className="flex items-center gap-2 font-medium">{props.job.status === "running" && <Loader2 size={13} className="animate-spin" aria-hidden />}{props.job.status}{props.job.progress != null && <span>{props.job.progress}%</span>}</div>{props.job.message && <p className="text-text-secondary">{props.job.message}</p>}{props.job.error && <p role="alert" className="text-red-400">{props.job.error}</p>}{props.job.status === "failed" && <div className="mt-2 flex gap-2"><button type="button" onClick={props.onRetry} className="min-h-9 rounded border border-border px-2"><RotateCcw size={12} className="mr-1 inline" />Retry</button>{props.onSaveRetry && <button type="button" onClick={props.onSaveRetry} className="min-h-9 rounded border border-border px-2">Retry save</button>}{props.onPlacementRetry && <button type="button" onClick={props.onPlacementRetry} className="min-h-9 rounded border border-border px-2">Retry placement</button>}</div>}</div>}
    <div className="sticky bottom-0 flex gap-2 bg-background p-3"><button type="submit" disabled={props.submitting || submitted || models.length === 0} className="min-h-10 flex-1 rounded bg-primary px-3 font-medium text-black disabled:cursor-not-allowed disabled:opacity-50">{props.submitting ? "Submitting…" : submitted ? "Submitted" : "Generate"}</button>{props.onCancel && <button type="button" aria-label="Cancel generation" onClick={props.onCancel} className="min-h-10 rounded border border-border px-3"><X size={14} /></button>}</div>
  </form>;
};

export default GenerateTab;
