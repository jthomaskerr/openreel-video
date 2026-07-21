import * as React from "react";
import { Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import type { ReferenceTarget } from "@openreel/core";
import {
  openReferenceTarget,
  referencePlacementFromEvent,
} from "../../../../../features/references/navigation";
import type {
  GenerationError,
  GenerationJob,
  GenerationPlacementPolicy,
} from "@openreel/music-video-domain/generation";
import type { GenerationAudioProvenance } from "../../../../../features/generation/audio";
import type { GenerationEntryContextResult } from "../../../../../features/generation/context/scene-generation";
import type {
  GenerationReferenceCommand,
  GenerationReferenceRecoveryState,
} from "../../../../../features/generation/drafts/v2";
import {
  allowedRecoveryActionsForJob,
  type RecoveryAction,
} from "../../../../../features/generation/recovery/state-machine";
import {
  resolveGenerationRecoveryPresentation,
  type GenerationRecoveryPresentationAction,
} from "./generation-recovery-presentation";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const ACTION_BUTTON =
  `min-h-11 rounded-lg border border-border px-3 text-sm text-text-primary ${FOCUS_RING}`;
const BYTE_FORMATTER = new Intl.NumberFormat("en-US");

export type GenerateAudioPresentation =
  | { kind: "ready"; provenance: GenerationAudioProvenance }
  | { kind: "unsupported" }
  | { kind: "zero-work"; reason: string }
  | { kind: "capability-unknown"; error: GenerationError }
  | { kind: "pending" };

export interface GenerateValidationError {
  field: "model" | "prompt";
  id: string;
  message: string;
}

export function GenerateHeaderSection(props: {
  contextLabel: string;
  description: string;
}) {
  return (
    <section className="min-w-0 border-b border-border/60 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2 font-semibold text-text-primary">
        <Sparkles size={14} aria-hidden />
        <span className="break-words [overflow-wrap:anywhere]">Generate</span>
      </div>
      <p className="mt-1 break-words text-[11px] text-text-secondary [overflow-wrap:anywhere]">
        {props.description}
      </p>
      <p className="mt-1 break-words text-[10px] uppercase tracking-wide text-text-muted [overflow-wrap:anywhere]">
        {props.contextLabel}
      </p>
    </section>
  );
}

export function GenerateValidationSummary(props: {
  errors: GenerateValidationError[];
  onSelectField: (field: GenerateValidationError["field"]) => void;
}) {
  if (!props.errors.length) return null;
  return (
    <section
      role="alert"
      aria-labelledby="generate-errors-heading"
      className="min-w-0 border-b border-red-500/30 bg-red-500/5 px-3 py-3"
    >
      <h3 id="generate-errors-heading" className="text-sm font-medium text-red-300">
        Generation form errors
      </h3>
      <ul className="mt-2 min-w-0 space-y-1">
        {props.errors.map((error) => (
          <li key={error.id} id={error.id} className="min-w-0">
            <button
              type="button"
              onClick={() => props.onSelectField(error.field)}
              className={`min-h-11 max-w-full break-words text-left text-sm text-red-300 underline [overflow-wrap:anywhere] ${FOCUS_RING}`}
            >
              {error.message}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GenerateModelSection(props: {
  models: Array<{
    id: string;
    label: string;
    provider?: string;
    modes?: Array<"image" | "video">;
  }>;
  selectedModelId: string;
  onSelect: (id: string) => void;
  inputRef: React.RefObject<HTMLDivElement>;
  invalid: boolean;
  describedBy?: string;
}) {
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const selectedIndex = props.models.findIndex(
    (model) => model.id === props.selectedModelId,
  );
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!props.models.length) return;
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? props.models.length - 1
          : selectedIndex < 0
            ? forward
              ? 0
              : props.models.length - 1
            : (selectedIndex + (forward ? 1 : -1) + props.models.length) %
              props.models.length;
    const next = props.models[nextIndex];
    if (!next) return;
    props.onSelect(next.id);
    const nextElement = optionRefs.current.get(next.id);
    nextElement?.focus();
    nextElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  return (
    <section className="min-w-0 border-b border-border/60 px-3 py-3">
      <h3 className="mb-2 block text-sm font-medium text-text-primary">
        Model
      </h3>
      <div
        ref={props.inputRef}
        role="listbox"
        aria-label="Generation models"
        aria-orientation="vertical"
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        aria-activedescendant={
          selectedIndex >= 0
            ? `generate-model-option-${props.selectedModelId}`
            : undefined
        }
        tabIndex={selectedIndex >= 0 ? -1 : 0}
        onKeyDown={onKeyDown}
        className={`grid min-w-0 max-w-full gap-2 ${FOCUS_RING}`}
      >
        {props.models.map((model) => {
          const selected = model.id === props.selectedModelId;
          return (
            <button
              key={model.id}
              ref={(element) => {
                if (element) optionRefs.current.set(model.id, element);
                else optionRefs.current.delete(model.id);
              }}
              id={`generate-model-option-${model.id}`}
              type="button"
              role="option"
              aria-selected={selected}
              data-testid={`model-option-${model.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => props.onSelect(model.id)}
              className={[
                `min-h-11 min-w-0 max-w-full rounded-lg border px-3 text-left transition-colors motion-reduce:transition-none ${FOCUS_RING}`,
                selected
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-secondary text-text-secondary",
              ].join(" ")}
            >
              <span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">
                {model.label}
              </span>
              <span className="block break-words text-[11px] text-text-muted [overflow-wrap:anywhere]">
                {model.provider ? `${model.provider} · ` : ""}
                {model.modes?.join(", ") ?? "any mode"}
              </span>
            </button>
          );
        })}
      </div>
      {!props.models.length ? (
        <p className="mt-2 break-words text-sm text-red-400 [overflow-wrap:anywhere]">
          No compatible generation model is available.
        </p>
      ) : null}
    </section>
  );
}

export function GeneratePromptSection(props: {
  prompt: string;
  onPromptChange: (value: string) => void;
  tokens: Array<{ value: string; ariaLabel: string; excluded?: boolean }>;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  invalid: boolean;
  describedBy?: string;
}) {
  return (
    <section className="min-w-0 border-b border-border/60 px-3 py-3">
      <label htmlFor="generate-prompt" className="mb-2 block text-sm font-medium text-text-primary">
        Prompt
      </label>
      <textarea
        ref={props.inputRef}
        id="generate-prompt"
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        value={props.prompt}
        onChange={(event) => props.onPromptChange(event.target.value)}
        rows={4}
        placeholder="Describe the shot or asset..."
        className={`min-w-0 max-w-full w-full resize-y rounded-lg border border-border bg-background-secondary p-2 text-sm text-text-primary ${FOCUS_RING}`}
      />
      {props.tokens.length ? (
        <div aria-label="Character mentions" className="mt-2 flex min-w-0 max-w-full flex-wrap gap-1">
          {props.tokens.map((token) => (
            <span
              key={token.ariaLabel}
              className={[
                "max-w-full break-words rounded-full border px-2 py-1 text-[11px] leading-none [overflow-wrap:anywhere]",
                token.excluded
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-primary/30 bg-primary/10 text-primary",
              ].join(" ")}
              aria-label={token.ariaLabel}
            >
              {token.value}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function GenerateReferenceSection(props: {
  recovery?: GenerationReferenceRecoveryState;
  labels?: Readonly<Record<string, string>>;
  onCommand?: (command: GenerationReferenceCommand, label: string) => void;
  references?: Array<{
    id: string;
    label: string;
    origins: string[];
    excluded?: boolean;
    target?: ReferenceTarget;
  }>;
}) {
  const references = props.recovery?.references ?? [];
  return (
    <section className="min-w-0 border-b border-border/60 px-3 py-3">
      <h3 className="text-sm font-medium text-text-primary">References</h3>
      {props.references?.length ? (
        <ul aria-label="Selected references" className="mt-2 grid gap-2">
          {props.references.map((reference) => {
            const content = (
              <div className="space-y-2">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span
                    className={[
                      "min-w-0 truncate text-sm font-medium",
                      reference.excluded
                        ? "line-through text-text-secondary"
                        : "text-text-primary",
                    ].join(" ")}
                  >
                    {reference.label}
                  </span>
                  {reference.excluded ? (
                    <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                      excluded
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] text-text-muted">
                  {reference.origins.join(" · ")}
                </p>
                {reference.target ? (
                  <p className="text-[11px] text-text-secondary">
                    Click to edit. Hold Shift to open in the inspector.
                  </p>
                ) : null}
              </div>
            );

            return (
              <li key={reference.id} className="min-w-0">
                {reference.target ? (
                  <button
                    type="button"
                    data-testid={`generate-reference-trigger-${reference.id}`}
                    onClick={(event) =>
                      openReferenceTarget(
                        reference.target!,
                        referencePlacementFromEvent(event),
                        { invoker: event.currentTarget },
                      )
                    }
                    className="w-full rounded-xl border border-border bg-background-elevated p-3 text-left transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="rounded-xl border border-border bg-background-elevated p-3">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {references.length ? (
        <ol
          aria-label="Reference recovery"
          className="mt-2 min-w-0 max-w-full space-y-2"
        >
          {references.map((reference) => {
            const label = props.labels?.[reference.id] ?? reference.mediaId;
            const failed =
              reference.state === "failed" || reference.preparationStatus === "failed";
            const dispatch = (action: GenerationReferenceCommand["action"]) => {
              if (!props.recovery || !props.onCommand) return;
              props.onCommand(
                {
                  action,
                  projectId: props.recovery.projectId,
                  jobId: props.recovery.jobId,
                  referenceId: reference.id,
                },
                label,
              );
            };

            return (
              <li
                key={reference.id}
                data-testid={`generation-reference-card-${reference.id}`}
                className="min-w-0 max-w-full rounded-lg border border-border bg-background-secondary p-3 text-sm text-text-primary"
              >
                <div className="flex min-w-0 max-w-full flex-wrap items-start gap-2">
                  <span className="break-words font-medium [overflow-wrap:anywhere]">{label}</span>
                  {!reference.active ? (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                      Deactivated
                    </span>
                  ) : null}
                  <span className="text-[11px] text-text-muted">Order {reference.order}</span>
                </div>
                <p className="mt-1 break-words text-[11px] text-text-muted [overflow-wrap:anywhere]">
                  Origins: {reference.origins.join(", ")}
                </p>
                {reference.errorHistory.length ? (
                  <div
                    role={failed ? "alert" : undefined}
                    aria-label={failed ? `${label} reference error` : undefined}
                    className="mt-2 break-words text-sm text-red-300 [overflow-wrap:anywhere]"
                  >
                    <ol
                      aria-label={`${label} reference error history`}
                      className="space-y-1"
                    >
                      {reference.errorHistory.map((error, index) => (
                        <li key={`${error.code}-${error.field ?? ""}-${index}`}>
                          <span className="font-medium">{error.code}</span>: {error.message}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                {failed ? (
                  <div
                    data-testid={`generation-reference-actions-${reference.id}`}
                    className="mt-3 flex min-w-0 max-w-full flex-wrap gap-2"
                  >
                    <button
                      type="button"
                      aria-label={`Retry ${label}`}
                      disabled={!props.onCommand}
                      onClick={() => dispatch("retry")}
                      className={`${ACTION_BUTTON} min-w-11 disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <RotateCcw size={13} className="mr-1 inline" aria-hidden />
                      Retry
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      disabled={!props.onCommand}
                      onClick={() => dispatch("remove")}
                      className={`${ACTION_BUTTON} min-w-11 disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      aria-label={`Deactivate ${label}`}
                      disabled={!reference.active || !props.onCommand}
                      onClick={() => dispatch("deactivate")}
                      className={`${ACTION_BUTTON} min-w-11 disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      Deactivate
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : !props.references?.length ? (
        <p className="mt-2 text-sm text-text-secondary">No references selected.</p>
      ) : null}
    </section>
  );
}

const entryContextTitle = (result: GenerationEntryContextResult) => {
  switch (result.entryContext.kind) {
    case "new-asset":
      return { title: "New asset", detail: "No shot, clip, range, or audio source is inferred." };
    case "unplaced-shot":
      return {
        title: "Unplaced shot",
        detail: `Shot ${result.entryContext.shotId} has no selected linked projection.`,
      };
    case "unlinked-range":
      return {
        title: "Unlinked range",
        detail: `Range ${result.entryContext.rangeId}${
          result.entryContext.destinationTrackId
            ? ` on track ${result.entryContext.destinationTrackId}`
            : ""
        }.`,
      };
    case "linked-projection":
      return {
        title: "Linked projection",
        detail: `Clip ${result.entryContext.clipId} linked to shot ${result.entryContext.shotId}.`,
      };
  }
};

function AudioPresentation(props: {
  contextResult?: GenerationEntryContextResult;
  presentation?: GenerateAudioPresentation;
  legacyReason?: string;
}) {
  const presentation =
    props.presentation ??
    (props.contextResult?.entryContext.kind === "linked-projection"
      ? props.contextResult.audioEligible
        ? ({ kind: "pending" } as const)
        : ({ kind: "unsupported" } as const)
      : props.contextResult
        ? ({
            kind: "zero-work",
            reason:
              props.contextResult.entryContext.kind === "unlinked-range"
                ? "This range has no linked projection audio source."
                : "This entry context has no selected projection audio source.",
          } as const)
        : undefined);

  if (!presentation && !props.legacyReason) return null;
  return (
    <div className="mt-3 min-w-0 max-w-full">
      <h3 className="text-sm font-medium text-text-primary">Audio</h3>
      {presentation?.kind === "ready" ? (
        <div className="mt-1 min-w-0 space-y-1 text-sm text-text-secondary">
          <p className="break-words [overflow-wrap:anywhere]">
            Source media {presentation.provenance.sourceMediaId}, version{" "}
            {presentation.provenance.sourceVersionId}, clip {presentation.provenance.sourceClipId}.
          </p>
          <p className="break-words [overflow-wrap:anywhere]">
            Requested project range {presentation.provenance.requestedProjectRange.startSeconds.toFixed(2)}s to{" "}
            {presentation.provenance.requestedProjectRange.endSeconds.toFixed(2)}s.
          </p>
          <p className="break-words [overflow-wrap:anywhere]">
            Requested source range {presentation.provenance.requestedSourceRange.startSeconds.toFixed(2)}s to{" "}
            {presentation.provenance.requestedSourceRange.endSeconds.toFixed(2)}s; actual source range{" "}
            {presentation.provenance.actualSourceRange.startSeconds.toFixed(2)}s to{" "}
            {presentation.provenance.actualSourceRange.endSeconds.toFixed(2)}s.
          </p>
          <p className="break-words [overflow-wrap:anywhere]">
            {presentation.provenance.format}, {BYTE_FORMATTER.format(presentation.provenance.byteLength)} bytes, SHA-256{" "}
            {presentation.provenance.sha256}.
          </p>
        </div>
      ) : null}
      {presentation?.kind === "unsupported" ? (
        <div className="mt-1 min-w-0 space-y-1 text-sm text-text-secondary">
          <p>The selected model does not support audio.</p>
          <p className="break-words [overflow-wrap:anywhere]">
            No audio resolution, extraction, cache, upload, or provider audio work will run.
          </p>
        </div>
      ) : null}
      {presentation?.kind === "zero-work" ? (
        <div className="mt-1 min-w-0 space-y-1 text-sm text-text-secondary">
          <p className="break-words [overflow-wrap:anywhere]">{presentation.reason}</p>
          <p>No audio resolution, extraction, cache, upload, or provider audio work will run.</p>
        </div>
      ) : null}
      {presentation?.kind === "capability-unknown" ? (
        <p role="alert" className="mt-1 break-words text-sm text-red-300 [overflow-wrap:anywhere]">
          {presentation.error.code}: {presentation.error.message}
        </p>
      ) : null}
      {presentation?.kind === "pending" ? (
        <p className="mt-1 text-sm text-text-secondary">
          Audio is eligible from this projection; provenance will appear after preparation.
        </p>
      ) : null}
      {!presentation && props.legacyReason ? (
        <p className="mt-1 break-words text-sm text-text-secondary [overflow-wrap:anywhere]">
          {props.legacyReason}
        </p>
      ) : null}
    </div>
  );
}

export function GenerateContextSection(props: {
  contextResult?: GenerationEntryContextResult;
  audioPresentation?: GenerateAudioPresentation;
  timing?: { start: number; end: number; source: string; reason?: string };
  audioReason?: string;
}) {
  if (!props.contextResult && !props.timing && !props.audioReason && !props.audioPresentation) {
    return null;
  }
  const context = props.contextResult ? entryContextTitle(props.contextResult) : undefined;
  const timing = props.contextResult?.timing;
  return (
    <section className="min-w-0 max-w-full border-b border-border/60 px-3 py-3">
      {context ? (
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text-primary">Context</h3>
          <p className="mt-1 font-medium text-text-secondary">{context.title}</p>
          <p className="break-words text-sm text-text-muted [overflow-wrap:anywhere]">{context.detail}</p>
        </div>
      ) : null}
      {timing ? (
        <div className={context ? "mt-3 min-w-0" : "min-w-0"}>
          <h3 className="text-sm font-medium text-text-primary">Timing</h3>
          <p className="text-sm text-text-secondary">
            {timing.startSeconds.toFixed(2)}s to {timing.endSeconds.toFixed(2)}s from {timing.source}
          </p>
          <p className="text-sm text-text-muted">Duration {timing.durationSeconds.toFixed(2)}s.</p>
          {props.contextResult?.projection ? (
            <p className="break-words text-sm text-text-muted [overflow-wrap:anywhere]">
              Projection trim {props.contextResult.projection.inPoint.toFixed(2)}s to{" "}
              {props.contextResult.projection.outPoint.toFixed(2)}s; timeline start{" "}
              {props.contextResult.projection.startTime.toFixed(2)}s, duration{" "}
              {props.contextResult.projection.duration.toFixed(2)}s.
            </p>
          ) : null}
        </div>
      ) : props.timing ? (
        <div className={context ? "mt-3 min-w-0" : "min-w-0"}>
          <h3 className="text-sm font-medium text-text-primary">Timing</h3>
          <p className="break-words text-sm text-text-secondary [overflow-wrap:anywhere]">
            {props.timing.start.toFixed(2)}s to {props.timing.end.toFixed(2)}s from {props.timing.source}
          </p>
          {props.timing.reason ? (
            <p className="break-words text-sm text-text-muted [overflow-wrap:anywhere]">
              {props.timing.reason}
            </p>
          ) : null}
        </div>
      ) : null}
      {props.contextResult?.errors.length || props.contextResult?.warnings.length ? (
        <div className="mt-3 min-w-0 space-y-1">
          {[...(props.contextResult?.errors ?? []), ...(props.contextResult?.warnings ?? [])].map(
            (diagnostic) => (
              <p
                key={`${diagnostic.code}-${diagnostic.token ?? ""}`}
                className="break-words text-sm text-amber-300 [overflow-wrap:anywhere]"
              >
                {diagnostic.code}
                {diagnostic.token ? `: ${diagnostic.token}` : ""}
              </p>
            ),
          )}
        </div>
      ) : null}
      <AudioPresentation
        contextResult={props.contextResult}
        presentation={props.audioPresentation}
        legacyReason={props.audioReason}
      />
    </section>
  );
}

const PLACEMENT_LABELS: Record<GenerationPlacementPolicy, string> = {
  none: "Library only",
  "create-linked-clip": "Create linked clip",
  "replace-selected-clip-media": "Replace selected clip media",
};

export function GenerateDestinationSection(props: {
  value: GenerationPlacementPolicy;
  defaultValue: GenerationPlacementPolicy;
  onChange: (value: GenerationPlacementPolicy) => void;
}) {
  return (
    <section className="min-w-0 max-w-full border-b border-border/60 px-3 py-3">
      <label htmlFor="generate-destination" className="mb-1 block text-sm font-medium text-text-primary">
        Placement
      </label>
      <p id="generate-placement-default" className="mb-2 text-sm text-text-muted">
        Default: {PLACEMENT_LABELS[props.defaultValue]}
      </p>
      <select
        id="generate-destination"
        aria-describedby="generate-placement-default"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as GenerationPlacementPolicy)}
        className={`min-h-11 min-w-0 max-w-full w-full rounded-lg border border-border bg-background-secondary px-3 text-sm text-text-primary ${FOCUS_RING}`}
      >
        {Object.entries(PLACEMENT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </section>
  );
}

const recoveryCallbackAvailable = (
  action: GenerationRecoveryPresentationAction,
  callbacks: {
    onEdit?: () => void;
    onRevalidate?: () => void;
    onRetryItem?: (category: "reference" | "audio") => void;
    onRecoveryAction?: (action: RecoveryAction) => void;
  },
) => {
  if (action === "edit") return Boolean(callbacks.onEdit);
  if (action === "revalidate") return Boolean(callbacks.onRevalidate);
  if (action === "retry-item") return Boolean(callbacks.onRetryItem);
  return Boolean(callbacks.onRecoveryAction);
};

export function GenerateJobSection(props: {
  job?: GenerationJob;
  progress?: number;
  message?: string;
  announcement?: { id: number; message: string };
  operationalError?: string;
  terminalErrorExplanation?: string;
  onEdit?: () => void;
  onRevalidate?: () => void;
  onRetryItem?: (category: "reference" | "audio") => void;
  onRecoveryAction?: (action: RecoveryAction) => void;
}) {
  const recovery = props.job ? resolveGenerationRecoveryPresentation(props.job) : undefined;
  const displayedError = recovery?.error ?? props.job?.error;
  const active =
    props.job && ["queued", "submitting", "running", "finalizing"].includes(props.job.status);
  const runRecovery = (action: GenerationRecoveryPresentationAction) => {
    if (action === "edit") props.onEdit?.();
    else if (action === "revalidate") props.onRevalidate?.();
    else if (action === "retry-item") {
      if (recovery?.category === "reference" || recovery?.category === "audio") {
        props.onRetryItem?.(recovery.category);
      }
    } else {
      props.onRecoveryAction?.(action);
    }
  };
  const explanation =
    recovery && !recovery.action && props.terminalErrorExplanation
      ? props.terminalErrorExplanation
      : recovery?.explanation;

  return (
    <section
      aria-labelledby="generation-status-heading"
      className="min-w-0 max-w-full border-b border-border/60 px-3 py-3"
    >
      <h3 id="generation-status-heading" className="text-sm font-medium text-text-primary">
        Status
      </h3>
      <div
        role="status"
        aria-label="Generation status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-1 min-w-0 max-w-full space-y-1"
      >
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          {active ? (
            <Loader2
              size={13}
              data-testid="generation-status-spinner"
              className="animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : null}
          <span className="break-words [overflow-wrap:anywhere]">
            {props.job?.status ?? "Ready to generate"}
          </span>
          {props.progress != null ? <span>{props.progress}%</span> : null}
        </div>
        {props.message ? (
          <p className="break-words text-sm text-text-secondary [overflow-wrap:anywhere]">
            {props.message}
          </p>
        ) : null}
        {props.announcement ? (
          <p
            key={props.announcement.id}
            className="break-words text-sm text-text-secondary [overflow-wrap:anywhere]"
          >
            {props.announcement.message}
          </p>
        ) : null}
      </div>
      {displayedError || recovery?.action ? (
        <div
          role="alert"
          aria-label="Generation error"
          className="mt-3 min-w-0 max-w-full rounded-lg border border-red-500/30 bg-red-500/5 p-3"
        >
          {displayedError ? (
            <>
              <p className="break-words text-sm font-medium text-red-300 [overflow-wrap:anywhere]">
                {displayedError.code}
              </p>
              <p className="break-words text-sm text-red-300 [overflow-wrap:anywhere]">
                {displayedError.message}
              </p>
            </>
          ) : null}
          {displayedError?.field ? (
            <p className="break-words text-[11px] text-red-200 [overflow-wrap:anywhere]">
              Field: {displayedError.field}
            </p>
          ) : null}
          {explanation ? (
            <p className="mt-2 break-words text-sm text-text-secondary [overflow-wrap:anywhere]">
              {explanation}
            </p>
          ) : null}
          {recovery?.action && recovery.actionLabel ? (
            <button
              type="button"
              disabled={
                !recoveryCallbackAvailable(recovery.action, {
                  onEdit: props.onEdit,
                  onRevalidate: props.onRevalidate,
                  onRetryItem: props.onRetryItem,
                  onRecoveryAction: props.onRecoveryAction,
                })
              }
              onClick={() => runRecovery(recovery.action!)}
              className={`mt-3 ${ACTION_BUTTON} min-w-11 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {recovery.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {props.operationalError ? (
        <p
          role="alert"
          aria-label="Generation action error"
          className="mt-3 break-words text-sm text-red-300 [overflow-wrap:anywhere]"
        >
          {props.operationalError}
        </p>
      ) : null}
    </section>
  );
}

export function GenerateActionsSection(props: {
  submitting?: boolean;
  disabled?: boolean;
  submitted: boolean;
  job?: GenerationJob;
  onRecoveryAction?: (action: RecoveryAction) => void;
}) {
  const errorRecovery = props.job
    ? resolveGenerationRecoveryPresentation(props.job)
    : undefined;
  const cancelAllowed =
    props.job &&
    Boolean(props.onRecoveryAction) &&
    errorRecovery?.category !== "cancellation" &&
    allowedRecoveryActionsForJob(props.job).includes("cancel");
  return (
    <div
      data-testid="generation-actions"
      className="sticky bottom-0 flex min-w-0 max-w-full flex-wrap gap-2 border-t border-border/60 bg-background p-3"
    >
      <button
        type="submit"
        disabled={props.disabled || props.submitting || props.submitted}
        className={`min-h-11 min-w-0 flex-[1_1_10rem] rounded-lg bg-primary px-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        {props.submitting ? "Submitting…" : props.submitted ? "Submitted" : "Generate"}
      </button>
      {cancelAllowed ? (
        <button
          type="button"
          aria-label="Cancel generation"
          disabled={!props.onRecoveryAction}
          onClick={() => props.onRecoveryAction?.("cancel")}
          className={`${ACTION_BUTTON} min-w-11 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
