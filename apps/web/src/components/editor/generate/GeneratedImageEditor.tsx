import type {
  MediaItem,
  ReferenceRoleByKey,
  ReferenceTarget,
} from "@openreel/core";
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeneratedImageController,
  GeneratedImageControllerInputField,
  GeneratedImageControllerResult,
} from "../../../features/generation/generated-images/controller";
import {
  MediaMentionEditor,
  type MediaMentionOption,
} from "./mentions/MediaMentionEditor";
import { ReferenceCards } from "./references/ReferenceCards";
import {
  GenerateActionsSection,
  GenerateContextSection,
  GenerateDestinationSection,
  GenerateHeaderSection,
  GenerateJobSection,
  GenerateModelSection,
  GeneratePromptSection,
  GenerateReferenceSection,
} from "../inspector/tabs/generation/GenerateTabSections";

export interface GeneratedImageEditorLegacyModel {
  readonly id: string;
  readonly label: string;
  readonly provider?: string;
  readonly modes?: Array<"image" | "video">;
  readonly capabilities?: string[];
}

export interface GeneratedImageEditorLegacyReference {
  readonly id: string;
  readonly label: string;
  readonly origins: string[];
  readonly excluded?: boolean;
  readonly target?: ReferenceTarget;
}

export interface GeneratedImageEditorLegacyJob {
  readonly id: string;
  readonly status: string;
  readonly message?: string;
  readonly progress?: number;
  readonly error?: string;
}

export interface GeneratedImageEditorLegacyProps {
  readonly contextLabel: string;
  readonly description: string;
  readonly models: readonly GeneratedImageEditorLegacyModel[];
  readonly characterSlugs?: readonly string[];
  readonly promptErrors?: Readonly<Record<string, string>>;
  readonly references?: readonly GeneratedImageEditorLegacyReference[];
  readonly timing?: { readonly start: number; readonly end: number; readonly source: string; readonly reason?: string };
  readonly audioReason?: string;
  readonly destination: "none" | "create-linked-clip" | "replace-selected-clip-media";
  readonly onDestinationChange: (
    value: "none" | "create-linked-clip" | "replace-selected-clip-media",
  ) => void;
  readonly job?: GeneratedImageEditorLegacyJob;
  readonly submitting?: boolean;
  readonly onSaveRetry?: () => void;
  readonly onPlacementRetry?: () => void;
}

export interface GeneratedImageEditorProps {
  readonly controller: GeneratedImageController;
  readonly definitionId: string;
  readonly placement: "modal" | "inspector";
  readonly mediaItems: readonly MediaItem[];
  readonly mentionOptions: readonly MediaMentionOption[];
  readonly onOpenReference: (
    target: ReferenceTarget,
    event: ReactMouseEvent | ReactKeyboardEvent,
  ) => void;
  readonly legacy?: GeneratedImageEditorLegacyProps;
}

function fieldValue(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : "";
}

function inputValue(
  field: GeneratedImageControllerInputField,
  target: HTMLInputElement | HTMLSelectElement,
): unknown {
  if (field.type === "boolean") {
    return (target as HTMLInputElement).checked;
  }
  if (field.type === "number") {
    return target.value === "" ? undefined : Number(target.value);
  }
  return target.value;
}

function focusValidationField(
  root: HTMLElement | null,
  field: string | undefined,
) {
  if (!root || !field) return;
  const container = root.querySelector<HTMLElement>(
    `[data-validation-field="${field}"]`,
  );
  const control =
    container?.matches("input, select, textarea, button, [contenteditable], [tabindex]")
      ? container
      : container?.querySelector<HTMLElement>(
          "input, select, textarea, button, [contenteditable], [tabindex]",
        );
  control?.focus();
}

function SchemaInput({
  field,
  value,
  onChange,
}: {
  readonly field: GeneratedImageControllerInputField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}) {
  const common = {
    id: `generated-image-input-${field.key}`,
    "aria-describedby": field.description
      ? `generated-image-input-${field.key}-description`
      : undefined,
    className:
      "min-h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary",
  };

  return (
    <label
      className="grid min-w-0 gap-1 text-xs text-text-secondary"
      data-validation-field={`inputs.${field.key}`}
    >
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.type === "select" ? (
        <select
          {...common}
          aria-label={field.label}
          value={fieldValue(value)}
          onChange={(event) => onChange(inputValue(field, event.currentTarget))}
        >
          <option value="">Select…</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <input
          {...common}
          aria-label={field.label}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(inputValue(field, event.currentTarget))}
        />
      ) : (
        <input
          {...common}
          aria-label={field.label}
          type={field.type === "number" ? "number" : "text"}
          value={fieldValue(value)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => onChange(inputValue(field, event.currentTarget))}
        />
      )}
      {field.description ? (
        <span id={`generated-image-input-${field.key}-description`}>
          {field.description}
        </span>
      ) : null}
    </label>
  );
}

export function GeneratedImageEditor({
  controller,
  definitionId,
  placement,
  mediaItems,
  mentionOptions,
  onOpenReference,
  legacy,
}: GeneratedImageEditorProps) {
  const [, setRevision] = useState(0);
  const [pendingAction, setPendingAction] = useState<
    "submit" | "cancel" | "retry" | "model" | null
  >(null);
  const [showValidation, setShowValidation] = useState(false);
  const [modelChangeMessage, setModelChangeMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const legacyPromptRef = useRef<HTMLTextAreaElement>(null);
  const initializingModelRef = useRef<string | null>(null);
  const state = controller.read(definitionId);
  const definition = state.definition;
  const providers = useMemo(
    () => [...new Set(state.models.map((model) => model.provider))],
    [state.models],
  );
  const selectedProvider = state.model?.provider ?? definition?.draft.provider ?? providers[0] ?? "";
  const providerModels = state.models.filter(
    (model) => model.provider === selectedProvider,
  );

  useEffect(() => {
    const defaultModel = state.models[0];
    if (!definition || definition.draft.modelId || !defaultModel) {
      initializingModelRef.current = null;
      return;
    }
    if (initializingModelRef.current === defaultModel.id) return;
    initializingModelRef.current = defaultModel.id;
    setPendingAction("model");
    setActionError(null);
    void controller
      .changeModel(definitionId, defaultModel.id)
      .then((result) => {
        if (!result.ok) {
          initializingModelRef.current = null;
          setActionError(result.message);
        }
        setRevision((revision) => revision + 1);
      })
      .catch((error: unknown) => {
        initializingModelRef.current = null;
        setActionError(error instanceof Error ? error.message : "The default model could not be selected.");
      })
      .finally(() => setPendingAction(null));
  }, [controller, definition, definitionId, state.models]);

  const refresh = () => setRevision((revision) => revision + 1);

  const runAction = async (
    kind: "submit" | "cancel" | "retry",
    action: () => Promise<GeneratedImageControllerResult>,
  ) => {
    if (pendingAction) return;
    setPendingAction(kind);
    setActionError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setActionError(result.message);
        if (result.code === "VALIDATION_FAILED") {
          setShowValidation(true);
          queueMicrotask(() =>
            focusValidationField(rootRef.current, result.issues?.[0]?.field),
          );
        }
      }
      refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Image generation failed.");
      refresh();
    } finally {
      setPendingAction(null);
    }
  };

  const persistDraft = async (
    patch: Parameters<GeneratedImageController["patchDraft"]>[1],
  ) => {
    const result = await controller.patchDraft(definitionId, patch);
    if (!result.ok) setActionError(result.message);
    refresh();
  };

  const changeModel = async (modelId: string) => {
    setPendingAction("model");
    setActionError(null);
    try {
      const result = await controller.changeModel(definitionId, modelId);
      if (result.ok) {
        setModelChangeMessage(
          result.resetFields.length
            ? `Reset fields: ${result.resetFields.join(", ")}`
            : "Compatible values were preserved.",
        );
      } else {
        setActionError(result.message);
      }
      refresh();
    } finally {
      setPendingAction(null);
    }
  };

  if (!definition) {
    return (
      <div role="alert" className="p-3 text-sm text-danger">
        Generated image definition was not found.
      </div>
    );
  }

  if (legacy) {
    const prompt = definition.draft.prompt;
    const promptErrors = Object.values(legacy.promptErrors ?? {});
    const tokenPills = [...prompt.matchAll(/@[a-z0-9_-]+/gi)].map(
      (match, index) => ({
        value: match[0],
        ariaLabel: `Character mention ${index + 1}: ${match[0]}`,
        excluded: Boolean(legacy.characterSlugs?.includes(match[0].slice(1))),
      }),
    );
    const submitLegacy = () => {
      if (
        pendingAction ||
        !prompt.trim() ||
        promptErrors.length > 0 ||
        legacy.models.length === 0
      ) {
        setShowValidation(true);
        legacyPromptRef.current?.focus();
        return;
      }
      void runAction("submit", () => controller.submit(definitionId));
    };

    return (
      <div
        ref={rootRef}
        className="min-w-0 overflow-x-hidden"
        data-placement={placement}
        data-testid="generated-image-editor"
      >
        <form
          aria-label="Generate"
          className="min-w-0 overflow-x-hidden text-sm text-text-primary"
          data-testid="generate-tab"
          onSubmit={(event) => {
            event.preventDefault();
            submitLegacy();
          }}
        >
          <GenerateHeaderSection
            contextLabel={legacy.contextLabel}
            description={legacy.description}
          />
          <GenerateModelSection
            models={[...legacy.models]}
            selectedModelId={state.model?.id ?? ""}
            onSelect={(modelId) => void changeModel(modelId)}
          />
          <GeneratePromptSection
            prompt={prompt}
            onPromptChange={(value) => void persistDraft({ prompt: value })}
            tokens={tokenPills}
            errors={promptErrors}
            firstErrorId="generate-errors"
            inputRef={legacyPromptRef}
          />
          <GenerateReferenceSection references={[...(legacy.references ?? [])]} />
          <GenerateContextSection
            timing={legacy.timing}
            audioReason={legacy.audioReason}
          />
          <GenerateDestinationSection
            value={legacy.destination}
            onChange={legacy.onDestinationChange}
          />
          <GenerateJobSection
            job={legacy.job}
            onRetry={() =>
              void runAction("retry", () => controller.retry(definitionId))
            }
            onSaveRetry={legacy.onSaveRetry}
            onPlacementRetry={legacy.onPlacementRetry}
          />
          {actionError && showValidation ? (
            <div role="alert" className="mx-3 rounded-md border border-danger/40 p-2 text-danger">
              {actionError}
            </div>
          ) : null}
          <GenerateActionsSection
            submitting={Boolean(legacy.submitting || pendingAction === "submit")}
            disabled={legacy.models.length === 0}
            submitted={Boolean(state.activeJob)}
            onCancel={() =>
              void runAction("cancel", () => controller.cancel(definitionId))
            }
          />
        </form>
      </div>
    );
  }

  const alerts = [
    ...(showValidation ? state.validation.issues.map((issue) => issue.message) : []),
    state.latestJob?.error,
    actionError,
  ].filter((message): message is string => Boolean(message));
  const active = Boolean(state.activeJob) || pendingAction === "submit";

  return (
    <div
      ref={rootRef}
      className="min-w-0 space-y-4 overflow-x-hidden p-3 text-sm text-text-primary"
      data-placement={placement}
      data-testid="generated-image-editor"
    >
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Generated image editor
        </p>
        <h2 className="text-base font-semibold text-text-primary">
          {definition.title || "Untitled generated image"}
        </h2>
      </header>

      <section
        className={`grid min-w-0 gap-3 ${placement === "modal" ? "grid-cols-2" : "grid-cols-1"}`}
        aria-label="Model"
      >
        <label className="grid gap-1 text-xs text-text-secondary">
          Provider
          <select
            aria-label="Provider"
            className="min-h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
            value={selectedProvider}
            disabled={pendingAction === "model"}
            onChange={(event) => {
              const nextModel = state.models.find(
                (model) => model.provider === event.currentTarget.value,
              );
              if (nextModel) void changeModel(nextModel.id);
            }}
          >
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-text-secondary" data-validation-field="model">
          Model
          <select
            aria-label="Generation model"
            className="min-h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
            value={state.model?.id ?? ""}
            disabled={pendingAction === "model"}
            onChange={(event) => void changeModel(event.currentTarget.value)}
          >
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {modelChangeMessage ? (
        <p role="status" aria-label="Model change" className="text-xs text-text-secondary">
          {modelChangeMessage}
        </p>
      ) : null}

      <label className="grid gap-1 text-xs text-text-secondary" data-validation-field="title">
        Title
        <input
          aria-label="Title"
          className="min-h-9 min-w-0 rounded-md border border-border bg-surface-muted px-2 text-sm text-text-primary"
          value={definition.title}
          readOnly
        />
      </label>

      <section className="grid gap-1" aria-labelledby="generated-image-prompt-label">
        <h3 id="generated-image-prompt-label" className="text-xs font-medium text-text-secondary">
          Prompt
        </h3>
        <div data-validation-field="prompt">
          <MediaMentionEditor
            value={definition.draft.prompt}
            options={mentionOptions}
            diagnostics={state.diagnostics}
            onChange={(prompt) => void persistDraft({ prompt })}
            onOpenReference={onOpenReference}
          />
        </div>
      </section>

      <ReferenceCards
        references={state.references}
        mediaItems={mediaItems}
        capability={state.model?.capability ?? state.models[0]!.capability}
        rolesByKey={definition.draft.roleByReferenceKey}
        onRolesByKeyChange={(roleByReferenceKey: ReferenceRoleByKey) =>
          void persistDraft({ roleByReferenceKey })
        }
      />

      {state.model?.capability.accepts.negativePrompt ? (
        <label className="grid gap-1 text-xs text-text-secondary">
          Negative prompt
          <textarea
            aria-label="Negative prompt"
            className="min-h-16 min-w-0 resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary"
            value={definition.draft.negativePrompt ?? ""}
            onChange={(event) =>
              void persistDraft({ negativePrompt: event.currentTarget.value })
            }
          />
        </label>
      ) : null}

      {state.model?.inputFields.length ? (
        <section
          className={`grid min-w-0 gap-3 ${placement === "modal" ? "grid-cols-2" : "grid-cols-1"}`}
          aria-label="Model parameters"
        >
          {state.model.inputFields.map((field) => (
            <SchemaInput
              key={field.key}
              field={field}
              value={definition.draft.inputs[field.key]}
              onChange={(value) => {
                const inputs = { ...definition.draft.inputs };
                if (value === undefined) delete inputs[field.key];
                else inputs[field.key] = value;
                void persistDraft({ inputs });
              }}
            />
          ))}
        </section>
      ) : null}

      {state.cost || state.limits.length ? (
        <section className="space-y-1 rounded-md border border-border bg-surface-muted p-2" aria-label="Cost and limits">
          {state.cost ? (
            <p>
              ${state.cost.amount.toFixed(2)} estimated
              {state.cost.formula ? ` · ${state.cost.formula}` : ""}
            </p>
          ) : null}
          {state.limits.map((limit) => (
            <p key={limit} className="text-xs text-text-secondary">
              {limit}
            </p>
          ))}
        </section>
      ) : null}

      {alerts.length ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger/40 bg-danger/10 p-2 text-sm text-danger">
          {alerts.map((message, index) => (
            <p key={`${message}-${index}`}>{message}</p>
          ))}
        </div>
      ) : null}

      {state.latestJob ? (
        <section
          role="status"
          aria-live="polite"
          className="space-y-2 rounded-md border border-border bg-surface-muted p-2"
        >
          <p>
            Generation {state.latestJob.status}
            {state.latestJob.progress !== undefined
              ? ` · ${state.latestJob.progress}%`
              : ""}
          </p>
          {state.latestJob.message ? (
            <p className="text-xs text-text-secondary">{state.latestJob.message}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {state.activeJob ? (
              <button
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-sm"
                disabled={pendingAction === "cancel"}
                onClick={() =>
                  void runAction("cancel", () => controller.cancel(definitionId))
                }
              >
                Cancel generation
              </button>
            ) : null}
            {state.latestJob.status === "failed" ||
            state.latestJob.status === "canceled" ? (
              <button
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-sm"
                disabled={pendingAction === "retry"}
                onClick={() =>
                  void runAction("retry", () => controller.retry(definitionId))
                }
              >
                Retry generation
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="space-y-2" aria-labelledby="generated-image-version-history">
        <h3 id="generated-image-version-history" className="text-sm font-medium">
          Version history
        </h3>
        {state.versionHistory.length ? (
          <ol className="space-y-1 text-xs text-text-secondary">
            {state.versionHistory.map((version) => (
              <li key={version.attemptId}>
                Version {version.index}: {version.attemptId}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-text-secondary">No generated versions yet.</p>
        )}
      </section>

      <button
        type="button"
        className="min-h-11 w-full rounded-md bg-primary px-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={active || !state.model}
        onClick={() =>
          void runAction("submit", () => controller.submit(definitionId))
        }
      >
        {pendingAction === "submit" ? "Generating…" : "Generate image"}
      </button>
    </div>
  );
}

export default GeneratedImageEditor;
