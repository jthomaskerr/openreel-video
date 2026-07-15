import { AlertCircle, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import type React from "react";

export function GenerateHeaderSection(props: { contextLabel: string; description: string }) {
  return (
    <section className="border-b border-border/60 px-3 py-3">
      <div className="flex items-center gap-2 font-semibold text-text-primary">
        <Sparkles size={14} aria-hidden />
        Generate
      </div>
      <p className="mt-1 text-[11px] text-text-secondary">{props.description}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">{props.contextLabel}</p>
    </section>
  );
}

export function GenerateModelSection(props: {
  models: Array<{ id: string; label: string; provider?: string; modes?: Array<"image" | "video"> }>;
  selectedModelId: string;
  onSelect: (id: string) => void;
}) {
  const selectedIndex = Math.max(0, props.models.findIndex((model) => model.id === props.selectedModelId));
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!props.models.length) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? props.models.length - 1
          : (selectedIndex + (event.key === "ArrowRight" ? 1 : -1) + props.models.length) % props.models.length;
    props.onSelect(props.models[nextIndex].id);
  };

  return (
    <section className="border-b border-border/60 px-3 py-3">
      <label className="mb-2 block text-sm font-medium text-text-primary">Model</label>
      <div
        role="listbox"
        aria-label="Generation models"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="grid gap-2 outline-none"
      >
        {props.models.map((model, index) => {
          const selected = model.id === props.selectedModelId;
          return (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selected}
              data-testid={`model-option-${model.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => props.onSelect(model.id)}
              className={[
                "min-h-11 rounded-lg border px-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary",
                selected
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-secondary text-text-secondary",
              ].join(" ")}
            >
              <span className="block text-sm font-medium">{model.label}</span>
              <span className="block text-[11px] text-text-muted">
                {model.provider ? `${model.provider} · ` : ""}
                {model.modes?.join(", ") ?? "any mode"}
                {index === 0 ? "" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {!props.models.length ? (
        <p role="alert" className="mt-2 text-sm text-red-400">
          No compatible models available.
        </p>
      ) : null}
    </section>
  );
}

export function GeneratePromptSection(props: {
  prompt: string;
  onPromptChange: (value: string) => void;
  tokens: Array<{ value: string; ariaLabel: string; excluded?: boolean }>;
  errors: string[];
  firstErrorId: string;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  return (
    <section className="border-b border-border/60 px-3 py-3">
      <label htmlFor="generate-prompt" className="mb-2 block text-sm font-medium text-text-primary">
        Prompt
      </label>
      <textarea
        ref={props.inputRef}
        id="generate-prompt"
        aria-describedby={props.errors.length ? props.firstErrorId : undefined}
        value={props.prompt}
        onChange={(event) => props.onPromptChange(event.target.value)}
        rows={4}
        placeholder="Describe the shot or asset..."
        className="w-full min-w-0 resize-y rounded-lg border border-border bg-background-secondary p-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-primary"
      />
      {props.tokens.length ? (
        <div aria-label="Character mentions" className="mt-2 flex flex-wrap gap-1">
          {props.tokens.map((token) => (
            <span
              key={token.ariaLabel}
              className={[
                "rounded-full border px-2 py-1 text-[11px] leading-none",
                token.excluded ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-primary/30 bg-primary/10 text-primary",
              ].join(" ")}
              aria-label={token.ariaLabel}
            >
              {token.value}
            </span>
          ))}
        </div>
      ) : null}
      {props.errors.length ? (
        <div id={props.firstErrorId} role="alert" aria-live="assertive" className="mt-2 space-y-1">
          <p className="text-sm font-medium text-red-400">Fix the highlighted fields before generating.</p>
          {props.errors.map((error) => (
            <p key={error} className="text-sm text-red-400">
              <AlertCircle size={12} className="mr-1 inline" aria-hidden />
              {error}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function GenerateReferenceSection(props: { references?: Array<{ id: string; label: string; origins: string[]; excluded?: boolean }> }) {
  return (
    <section className="border-b border-border/60 px-3 py-3">
      <h3 className="text-sm font-medium text-text-primary">References</h3>
      {props.references?.length ? (
        <ul className="mt-2 space-y-2">
          {props.references.map((reference) => (
            <li key={reference.id} className="min-w-0 text-sm text-text-primary">
              <div className="flex min-w-0 items-start gap-2">
                <span className={reference.excluded ? "line-through text-text-secondary" : ""}>{reference.label}</span>
                {reference.excluded ? (
                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                    excluded
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-text-muted">{reference.origins.join(" · ")}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-text-secondary">No references selected.</p>
      )}
    </section>
  );
}

export function GenerateContextSection(props: { timing?: { start: number; end: number; source: string; reason?: string }; audioReason?: string }) {
  if (!props.timing && !props.audioReason) return null;
  return (
    <section className="border-b border-border/60 px-3 py-3">
      {props.timing ? (
        <div>
          <h3 className="text-sm font-medium text-text-primary">Timing</h3>
          <p className="text-sm text-text-secondary">
            {props.timing.start.toFixed(2)}s to {props.timing.end.toFixed(2)}s from {props.timing.source}
          </p>
          {props.timing.reason ? <p className="text-sm text-text-muted">{props.timing.reason}</p> : null}
        </div>
      ) : null}
      {props.audioReason ? (
        <div className={props.timing ? "mt-3" : ""}>
          <h3 className="text-sm font-medium text-text-primary">Audio</h3>
          <p className="text-sm text-text-secondary">{props.audioReason}</p>
        </div>
      ) : null}
    </section>
  );
}

export function GenerateDestinationSection(props: {
  value: "none" | "create-linked-clip" | "replace-selected-clip-media";
  onChange: (value: "none" | "create-linked-clip" | "replace-selected-clip-media") => void;
}) {
  return (
    <section className="border-b border-border/60 px-3 py-3">
      <label htmlFor="generate-destination" className="mb-2 block text-sm font-medium text-text-primary">
        Destination
      </label>
      <select
        id="generate-destination"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as typeof props.value)}
        className="w-full min-h-11 rounded-lg border border-border bg-background-secondary px-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="none">Keep as asset</option>
        <option value="create-linked-clip">Create linked clip</option>
        <option value="replace-selected-clip-media">Replace selected clip media</option>
      </select>
    </section>
  );
}

export function GenerateJobSection(props: {
  job?: { id: string; status: string; message?: string; progress?: number; error?: string };
  onRetry?: () => void;
  onSaveRetry?: () => void;
  onPlacementRetry?: () => void;
}) {
  if (!props.job) return null;
  const failed = props.job.status === "failed";
  return (
    <section className="border-b border-border/60 px-3 py-3" aria-live="polite" role="status">
      <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
        {props.job.status === "running" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
        <span>{props.job.status}</span>
        {props.job.progress != null ? <span>{props.job.progress}%</span> : null}
      </div>
      {props.job.message ? <p className="mt-1 text-sm text-text-secondary">{props.job.message}</p> : null}
      {props.job.error ? (
        <p className="mt-1 text-sm text-red-400" role="alert">
          {props.job.error}
        </p>
      ) : null}
      {failed ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={props.onRetry} className="min-h-11 rounded-lg border border-border px-3 text-sm">
            <RotateCcw size={12} className="mr-1 inline" aria-hidden />
            Retry
          </button>
          {props.onSaveRetry ? (
            <button type="button" onClick={props.onSaveRetry} className="min-h-11 rounded-lg border border-border px-3 text-sm">
              Retry save
            </button>
          ) : null}
          {props.onPlacementRetry ? (
            <button type="button" onClick={props.onPlacementRetry} className="min-h-11 rounded-lg border border-border px-3 text-sm">
              Retry placement
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function GenerateActionsSection(props: { submitting?: boolean; disabled?: boolean; onCancel?: () => void; submitted: boolean }) {
  return (
    <div className="sticky bottom-0 flex gap-2 border-t border-border/60 bg-background p-3">
      <button
        type="submit"
        disabled={props.disabled || props.submitting}
        className="min-h-11 flex-1 rounded-lg bg-primary px-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        {props.submitting ? "Submitting…" : props.submitted ? "Submitted" : "Generate"}
      </button>
      {props.onCancel ? (
        <button
          type="button"
          aria-label="Cancel generation"
          onClick={props.onCancel}
          className="min-h-11 rounded-lg border border-border px-3 text-sm text-text-primary"
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
