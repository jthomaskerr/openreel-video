import type {
  ReferenceOrigin,
  ReferenceRoleByKey,
  ReferenceStatus,
  ResolvedGenerationReference,
} from "@openreel/core";
import type { GenerationModelCapability } from "../../../services/wavespeed/model-capabilities";
import type { ReferenceWarningClass } from "../../../stores/reference-warning-preferences";

export type CanonicalReferenceRole = "source-image" | "reference-images";

export interface ReferenceRoleOption {
  readonly value: CanonicalReferenceRole;
  readonly label: string;
}

export interface ExcludedReference {
  readonly key: string;
  readonly mediaId: string;
  readonly mediaVersionId: string;
  readonly order: number;
  readonly role: string;
  readonly status: Exclude<ReferenceStatus, "active">;
  readonly reason: string;
  readonly warningClass: ReferenceWarningClass;
}

const SOURCE_ROLE_OPTION: ReferenceRoleOption = {
  value: "source-image",
  label: "Source image",
};

const REFERENCE_ROLE_OPTION: ReferenceRoleOption = {
  value: "reference-images",
  label: "Reference image",
};

function titleCase(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function canonicalizeReferenceRole(
  role: string | undefined,
  reference: ResolvedGenerationReference,
): CanonicalReferenceRole | undefined {
  if (!role) return undefined;
  if (role === "source-image" || role === "reference-images") return role;
  if (role === "source") return "source-image";
  if (role === "character" || role === "prompt-media" || role === "shot") {
    return "reference-images";
  }
  if (reference.origins.includes("source") && role === "input") {
    return "source-image";
  }
  return undefined;
}

function nextWarningClass(status: Exclude<ReferenceStatus, "active">): ReferenceWarningClass {
  return status === "overflow" ? "reference-overflow" : "reference-excluded";
}

function incompatibleReason(role: string): string {
  return `This model does not accept ${normalizeReferenceRoleLabel(role)} for this reference.`;
}

function overflowReason(maximum: number): string {
  const noun = maximum === 1 ? "image" : "images";
  return `Only the first ${maximum} reference ${noun} can be submitted to this model.`;
}

function cloneReference(
  reference: ResolvedGenerationReference,
  overrides: Partial<ResolvedGenerationReference>,
): ResolvedGenerationReference {
  return {
    ...reference,
    ...overrides,
    origins: [...(overrides.origins ?? reference.origins)],
    canonicalTokens: [...(overrides.canonicalTokens ?? reference.canonicalTokens)],
  };
}

export function normalizeReferenceRoleLabel(role: string): string {
  if (role === "source-image") return "Source image";
  if (role === "reference-images") return "Reference image";
  return titleCase(role.replace(/[-_]+/gu, " "));
}

export function describeReferenceOrigins(
  origins: readonly ReferenceOrigin[],
): readonly string[] {
  return origins.map((origin) => {
    if (origin === "prompt-media") return "Prompt mention";
    return titleCase(origin.replace(/-/gu, " "));
  });
}

export function getReferenceRoleOptions(
  reference: ResolvedGenerationReference,
  capability: GenerationModelCapability,
): readonly ReferenceRoleOption[] {
  const options: ReferenceRoleOption[] = [];

  if (capability.accepts.sourceImage && reference.origins.includes("source")) {
    options.push(SOURCE_ROLE_OPTION);
  }
  if (capability.accepts.referenceImages !== false) {
    options.push(REFERENCE_ROLE_OPTION);
  }

  return options;
}

export function getExcludedReferences(
  references: readonly ResolvedGenerationReference[],
): readonly ExcludedReference[] {
  return references
    .filter((reference): reference is ResolvedGenerationReference & {
      status: Exclude<ReferenceStatus, "active">;
      reason: string;
    } => reference.status !== "active" && typeof reference.reason === "string")
    .map((reference) => ({
      key: reference.key,
      mediaId: reference.mediaId,
      mediaVersionId: reference.mediaVersionId,
      order: reference.order,
      role: reference.role,
      status: reference.status,
      reason: reference.reason,
      warningClass: nextWarningClass(reference.status),
    }))
    .sort((left, right) => left.order - right.order);
}

export function reconcileReferenceRoles(input: {
  rolesByKey: ReferenceRoleByKey;
  references: readonly ResolvedGenerationReference[];
  capability: GenerationModelCapability;
}): {
  references: readonly ResolvedGenerationReference[];
  rolesByKey: ReferenceRoleByKey;
} {
  const referenceKeys = new Set(input.references.map((reference) => reference.key));
  const nextRolesByKey: Record<string, string> = {};
  const nextReferences = input.references.map((reference) => {
    const options = getReferenceRoleOptions(reference, input.capability);
    const allowedRoles = new Set(options.map((option) => option.value));
    const explicitRole = input.rolesByKey[reference.key];
    const fallbackRole = reference.role;
    const resolvedRole = canonicalizeReferenceRole(explicitRole ?? fallbackRole, reference);

    if (explicitRole && allowedRoles.has(resolvedRole as CanonicalReferenceRole)) {
      nextRolesByKey[reference.key] = resolvedRole!;
      return cloneReference(reference, {
        role: resolvedRole!,
        status: "active",
        reason: undefined,
      });
    }

    if (explicitRole && !allowedRoles.has(resolvedRole as CanonicalReferenceRole)) {
      nextRolesByKey[reference.key] = explicitRole;
      return cloneReference(reference, {
        role: explicitRole,
        status: "unsupported",
        reason: incompatibleReason(explicitRole),
      });
    }

    const defaultRole =
      resolvedRole && allowedRoles.has(resolvedRole)
        ? resolvedRole
        : options[0]?.value;

    if (!defaultRole) {
      return cloneReference(reference, {
        status: "unsupported",
        reason: incompatibleReason(reference.role),
      });
    }

    nextRolesByKey[reference.key] = defaultRole;
    return cloneReference(reference, {
      role: defaultRole,
      status: "active",
      reason: undefined,
    });
  });

  for (const [key, role] of Object.entries(input.rolesByKey)) {
    if (referenceKeys.has(key) && !(key in nextRolesByKey)) {
      nextRolesByKey[key] = role;
    }
  }

  const referenceImageLimit =
    input.capability.accepts.referenceImages === false
      ? 0
      : input.capability.accepts.referenceImages.max;

  if (Number.isFinite(referenceImageLimit)) {
    const activeReferenceImages = nextReferences
      .filter(
        (reference) =>
          reference.status === "active" && reference.role === "reference-images",
      )
      .sort((left, right) => left.order - right.order);

    for (const reference of activeReferenceImages.slice(referenceImageLimit)) {
      const index = nextReferences.findIndex((item) => item.key === reference.key);
      if (index === -1) continue;
      nextReferences[index] = cloneReference(nextReferences[index], {
        status: "overflow",
        reason: overflowReason(referenceImageLimit),
      });
    }
  }

  return {
    references: nextReferences,
    rolesByKey: nextRolesByKey,
  };
}
