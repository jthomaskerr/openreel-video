import type { ResolvedGenerationReference } from "@openreel/core";
import type {
  ProviderReferenceFixture,
  ProviderReferenceFixtureIssue,
  ProviderReferenceFixtureValidationResult,
} from "./types";

const CANONICAL_TOKEN_PATTERN = /@\{[^}]+\}/g;
const TEMPLATE_PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z][\w.-]*)\s*}}/g;
const ALLOWED_TEMPLATE_PLACEHOLDERS = new Set(["token", "key", "role", "index", "mediaId", "mediaVersionId"]);

export class ProviderReferenceFixtureError extends Error {
  readonly issues: readonly ProviderReferenceFixtureIssue[];

  constructor(issues: readonly ProviderReferenceFixtureIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.code}`).join("; "));
    this.name = "ProviderReferenceFixtureError";
    this.issues = issues;
  }
}

function issue(code: string, path: string, message: string): ProviderReferenceFixtureIssue {
  return { code, path, message };
}

function isPlaceholderString(value: string): boolean {
  return CANONICAL_TOKEN_PATTERN.test(value) || /^{{\s*[^}]+\s*}}$/.test(value);
}

function isConcreteValue(value: unknown, path: string, issues: ProviderReferenceFixtureIssue[]): boolean {
  if (typeof value === "string") {
    if (value.trim().length === 0 || isPlaceholderString(value)) {
      issues.push(issue("missing-concrete-example", path, "fixture example must use concrete values"));
      return false;
    }
    return true;
  }
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (value == null) {
    issues.push(issue("missing-concrete-example", path, "fixture example must use concrete values"));
    return false;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      issues.push(issue("missing-concrete-example", path, "fixture example must use concrete values"));
      return false;
    }
    return value.every((item, index) => isConcreteValue(item, `${path}[${index}]`, issues));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      issues.push(issue("missing-concrete-example", path, "fixture example must use concrete values"));
      return false;
    }
    return entries.every(([key, item]) => isConcreteValue(item, `${path}.${key}`, issues));
  }
  return true;
}

function validateTemplate(template: string, issues: ProviderReferenceFixtureIssue[]): void {
  for (const match of template.matchAll(TEMPLATE_PLACEHOLDER_PATTERN)) {
    const placeholder = match[1];
    if (!ALLOWED_TEMPLATE_PLACEHOLDERS.has(placeholder)) {
      issues.push(issue("unresolved-template-placeholder", "promptTokenRule.template", `unknown template placeholder ${placeholder}`));
    }
  }
}

export function validateProviderReferenceFixture(
  fixture: ProviderReferenceFixture,
): ProviderReferenceFixtureValidationResult {
  const issues: ProviderReferenceFixtureIssue[] = [];

  for (const [path, value] of [
    ["provider", fixture.provider],
    ["modelId", fixture.modelId],
    ["evidenceUrl", fixture.evidenceUrl],
    ["evidenceCapturedAt", fixture.evidenceCapturedAt],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push(issue("missing-required-field", path, "fixture metadata must be provided"));
    }
  }

  const accepted = [...fixture.acceptedFields];
  const seenAccepted = new Set<string>();
  for (const field of accepted) {
    if (seenAccepted.has(field)) {
      issues.push(issue("duplicate-accepted-field", "acceptedFields", `duplicate accepted field ${field}`));
    }
    seenAccepted.add(field);
  }
  if (accepted.length === 0) {
    issues.push(issue("missing-accepted-fields", "acceptedFields", "fixture must document at least one field"));
  }

  const seenRoleFields = new Map<string, string>();
  for (const [roleName, role] of Object.entries(fixture.roles)) {
    if (!seenAccepted.has(role.field)) {
      issues.push(issue("undocumented-field", `roles.${roleName}.field`, `field ${role.field} is not documented`));
    }
    const previousRole = seenRoleFields.get(role.field);
    if (previousRole) {
      issues.push(issue("duplicate-role-field", `roles.${roleName}.field`, `field ${role.field} is already assigned to ${previousRole}`));
    }
    seenRoleFields.set(role.field, roleName);
    if (role.cardinality !== "one" && role.cardinality !== "many") {
      issues.push(issue("invalid-cardinality", `roles.${roleName}.cardinality`, `unknown cardinality ${role.cardinality}`));
    }
  }

  for (const field of Object.keys(fixture.exampleRequest)) {
    if (!seenAccepted.has(field)) {
      issues.push(issue("undocumented-field", `exampleRequest.${field}`, `field ${field} is not documented`));
    }
  }

  for (const field of accepted) {
    if (!Object.prototype.hasOwnProperty.call(fixture.exampleRequest, field)) {
      issues.push(issue("missing-concrete-example", `exampleRequest.${field}`, `missing example value for ${field}`));
      continue;
    }
    const value = fixture.exampleRequest[field];
    isConcreteValue(value, `exampleRequest.${field}`, issues);
    const role = Object.values(fixture.roles).find((entry) => entry.field === field);
    if (role?.cardinality === "one" && Array.isArray(value)) {
      issues.push(issue("inconsistent-cardinality", `exampleRequest.${field}`, `field ${field} must be scalar`));
    }
    if (role?.cardinality === "many" && !Array.isArray(value)) {
      issues.push(issue("inconsistent-cardinality", `exampleRequest.${field}`, `field ${field} must be an array`));
    }
  }

  if (fixture.minReferences < 0 || fixture.maxReferences < 0 || fixture.minReferences > fixture.maxReferences) {
    issues.push(issue("invalid-reference-bounds", "minReferences", "reference bounds are inconsistent"));
  }

  if (typeof fixture.promptTokenRule === "object") {
    validateTemplate(fixture.promptTokenRule.template, issues);
  }

  return issues.length ? { ok: false, issues } : { ok: true };
}

function positionForReference(reference: ResolvedGenerationReference, position: number): number {
  return position > 0 ? position : Number(reference.order) || 0;
}

function renderTemplate(
  template: string,
  reference: ResolvedGenerationReference,
  position: number,
): string {
  return template.replace(TEMPLATE_PLACEHOLDER_PATTERN, (_, placeholder: string) => {
    switch (placeholder) {
      case "token":
        return reference.canonicalTokens[0] ?? "";
      case "key":
        return reference.key;
      case "role":
        return reference.role;
      case "index":
        return String(position);
      case "mediaId":
        return reference.mediaId;
      case "mediaVersionId":
        return reference.mediaVersionId;
      default:
        return "";
    }
  });
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function rewritePrompt(
  prompt: string,
  references: readonly ResolvedGenerationReference[],
  positions: ReadonlyMap<string, number>,
  rule: ProviderReferenceFixture["promptTokenRule"],
): string {
  if (rule === "preserve") return prompt;
  let rewritten = prompt;
  for (const reference of references) {
    for (const token of reference.canonicalTokens) {
      const replacement = typeof rule === "object" ? renderTemplate(rule.template, reference, positions.get(reference.key) ?? 0) : "";
      rewritten = rewritten.split(token).join(replacement);
    }
  }
  return collapseWhitespace(rewritten);
}

export function mapProviderReferences(
  fixture: ProviderReferenceFixture,
  prompt: string,
  references: readonly ResolvedGenerationReference[],
): { prompt: string; inputs: Readonly<Record<string, unknown>> } {
  const validation = validateProviderReferenceFixture(fixture);
  if (!validation.ok) throw new ProviderReferenceFixtureError(validation.issues);

  const active = references
    .filter((reference) => reference.status === "active")
    .slice()
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));

  if (active.length < fixture.minReferences || active.length > fixture.maxReferences) {
    throw new ProviderReferenceFixtureError([
      issue("reference-count-out-of-bounds", "references", `expected between ${fixture.minReferences} and ${fixture.maxReferences} active references`),
    ]);
  }

  const positions = new Map<string, number>();
  active.forEach((reference, index) => {
    if (reference.canonicalTokens.length === 0) {
      throw new ProviderReferenceFixtureError([
        issue("missing-concrete-example", `references.${reference.key}.canonicalTokens`, "reference must expose at least one canonical token"),
      ]);
    }
    positions.set(reference.key, index + 1);
  });

  const grouped = new Map<string, ResolvedGenerationReference[]>();
  for (const reference of active) {
    const role = fixture.roles[reference.role];
    if (!role) {
      throw new ProviderReferenceFixtureError([
        issue("undocumented-field", `references.${reference.key}.role`, `role ${reference.role} is not documented`),
      ]);
    }
    const list = grouped.get(role.field) ?? [];
    list.push(reference);
    grouped.set(role.field, list);
  }

  for (const [roleName, role] of Object.entries(fixture.roles)) {
    const refs = grouped.get(role.field) ?? [];
    if (role.cardinality === "one" && refs.length > 1) {
      throw new ProviderReferenceFixtureError([
        issue("inconsistent-cardinality", `roles.${roleName}.field`, `field ${role.field} accepts one reference`),
      ]);
    }
  }

  const inputs = structuredClone(fixture.exampleRequest) as Record<string, unknown>;
  for (const [, role] of Object.entries(fixture.roles)) {
    const refs = grouped.get(role.field) ?? [];
    if (refs.length === 0) continue;
    if (role.cardinality === "one") {
      inputs[role.field] = positionForReference(refs[0], positions.get(refs[0].key) ?? refs[0].order);
      continue;
    }
    inputs[role.field] = refs.map((reference) => positionForReference(reference, positions.get(reference.key) ?? reference.order));
  }

  return {
    prompt: rewritePrompt(prompt, references, positions, fixture.promptTokenRule),
    inputs,
  };
}
