import { useMemo, useState } from "react";
import type {
  MediaItem,
  ReferenceRoleByKey,
  ResolvedGenerationReference,
} from "@openreel/core";
import type { GenerationModelCapability } from "../../../../services/wavespeed/model-capabilities";
import {
  describeReferenceOrigins,
  getExcludedReferences,
  getReferenceRoleOptions,
  normalizeReferenceRoleLabel,
  reconcileReferenceRoles,
} from "../../../../features/generation/references/roles";
import {
  isReferenceWarningSuppressed,
  suppressReferenceWarning,
} from "../../../../stores/reference-warning-preferences";

export interface ReferenceCardsProps {
  readonly references: readonly ResolvedGenerationReference[];
  readonly mediaItems: readonly MediaItem[];
  readonly capability: GenerationModelCapability;
  readonly rolesByKey: ReferenceRoleByKey;
  readonly onRolesByKeyChange?: (rolesByKey: ReferenceRoleByKey) => void;
  readonly onSubmit?: (references: readonly ResolvedGenerationReference[]) => void;
  readonly submitLabel?: string;
}

interface PendingConfirmationState {
  readonly references: readonly ResolvedGenerationReference[];
}

function mediaLabel(media: MediaItem | undefined, reference: ResolvedGenerationReference): string {
  return media?.title || media?.name || reference.mediaVersionId;
}

function mediaDescription(media: MediaItem | undefined): string | null {
  return media?.description?.trim() || null;
}

function thumbnailUrl(media: MediaItem | undefined): string | null {
  return media?.thumbnailUrl ?? media?.originalUrl ?? null;
}

export function ReferenceCards({
  references,
  mediaItems,
  capability,
  rolesByKey,
  onRolesByKeyChange,
  onSubmit,
  submitLabel = "Continue",
}: ReferenceCardsProps) {
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmationState | null>(null);
  const [suppressOverflow, setSuppressOverflow] = useState(false);

  const mediaById = useMemo(
    () => new Map(mediaItems.map((item) => [item.id, item])),
    [mediaItems],
  );
  const reconciled = useMemo(
    () => reconcileReferenceRoles({ references, rolesByKey, capability }),
    [capability, references, rolesByKey],
  );

  const submitReferences = (nextReferences: readonly ResolvedGenerationReference[]) => {
    onSubmit?.(nextReferences);
  };

  const handleSubmit = () => {
    const excluded = getExcludedReferences(reconciled.references);
    const hasUnsuppressedExcludedReferences = excluded.some((item) => {
      if (item.warningClass !== "reference-overflow") {
        return true;
      }
      return !isReferenceWarningSuppressed(item.warningClass);
    });

    if (!hasUnsuppressedExcludedReferences) {
      submitReferences(reconciled.references);
      return;
    }

    setSuppressOverflow(false);
    setPendingConfirmation({ references: reconciled.references });
  };

  const continueAfterConfirmation = () => {
    if (suppressOverflow) {
      suppressReferenceWarning("reference-overflow");
    }

    if (pendingConfirmation) {
      submitReferences(pendingConfirmation.references);
    }
    setPendingConfirmation(null);
    setSuppressOverflow(false);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-text-primary">References</h3>
        {onSubmit ? (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-white"
            onClick={handleSubmit}
          >
            {submitLabel}
          </button>
        ) : null}
      </div>

      {reconciled.references.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {reconciled.references.map((reference) => {
            const media = mediaById.get(reference.mediaId);
            const label = mediaLabel(media, reference);
            const description = mediaDescription(media);
            const thumbnail = thumbnailUrl(media);
            const origins = describeReferenceOrigins(reference.origins).join(" • ");
            const roleOptions = getReferenceRoleOptions(reference, capability);
            const invalid = reference.status !== "active";

            return (
              <li
                key={reference.key}
                data-testid={`reference-card-${reference.key}`}
                className="overflow-hidden rounded-xl border border-border bg-background-elevated"
              >
                <div
                  data-testid={`reference-thumbnail-${reference.key}`}
                  className="aspect-square overflow-hidden bg-background-secondary"
                >
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-text-muted">
                      {label}
                    </div>
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {label}
                      </p>
                      {description ? (
                        <p className="mt-1 text-xs text-text-secondary">{description}</p>
                      ) : null}
                    </div>
                    {invalid ? (
                      <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300">
                        Excluded
                      </span>
                    ) : null}
                  </div>

                  <p className="text-xs text-text-muted">{origins}</p>

                  {roleOptions.length > 1 ? (
                    <div className="flex flex-wrap gap-2">
                      {roleOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={reference.role === option.value}
                          className={
                            reference.role === option.value
                              ? "rounded-full border border-primary bg-primary/10 px-2 py-1 text-xs text-primary"
                              : "rounded-full border border-border px-2 py-1 text-xs text-text-secondary"
                          }
                          onClick={() =>
                            onRolesByKeyChange?.({
                              ...reconciled.rolesByKey,
                              [reference.key]: option.value,
                            })
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="inline-flex rounded-full border border-border px-2 py-1 text-xs text-text-secondary">
                      {normalizeReferenceRoleLabel(reference.role)}
                    </span>
                  )}

                  <div className="space-y-1 text-xs">
                    <p className={invalid ? "text-amber-300" : "text-emerald-300"}>
                      {invalid ? "Excluded from submission" : "Available for submission"}
                    </p>
                    {reference.reason ? (
                      <p className="text-text-secondary">{reference.reason}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-text-secondary">
          No references resolved for this draft.
        </p>
      )}

      {pendingConfirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-border bg-background p-4 shadow-xl"
          >
            <div className="space-y-3">
              <div>
                <h4 className="text-base font-medium text-text-primary">
                  Some references will be excluded
                </h4>
                <p className="mt-1 text-sm text-text-secondary">
                  These references stay visible on the cards, but they will not be sent with this submit.
                </p>
              </div>

              <ul className="space-y-2">
                {getExcludedReferences(pendingConfirmation.references).map((reference) => {
                  const media = mediaById.get(reference.mediaId);
                  return (
                    <li
                      key={reference.key}
                      className="rounded-lg border border-border px-3 py-2"
                    >
                      <p className="text-sm font-medium text-text-primary">
                        {mediaLabel(media, {
                          ...reference,
                          origins: [],
                          canonicalTokens: [],
                        } as ResolvedGenerationReference)}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        {reference.reason}
                      </p>
                    </li>
                  );
                })}
              </ul>

              {getExcludedReferences(pendingConfirmation.references).some(
                (reference) => reference.warningClass === "reference-overflow",
              ) ? (
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={suppressOverflow}
                    onChange={(event) => setSuppressOverflow(event.target.checked)}
                    aria-label="Do not show again"
                  />
                  Do not show again
                </label>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary"
                  onClick={() => {
                    setPendingConfirmation(null);
                    setSuppressOverflow(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-white"
                  onClick={continueAfterConfirmation}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
