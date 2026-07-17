import { ZodError } from "zod";
import { GENERATION_JOB_CONTRACT_VERSION, GENERATION_JOB_SCHEMA_VERSION, type GenerationDisposition, type GenerationJob, type GenerationProvider } from "./contracts.js";
import { GenerationContextSchema, GenerationRouteIdentitySchema, parseGenerationJob } from "./schemas.js";

export interface GenerationLegacyRecovery {
  kind: "legacy-recovery";
  status: "needs-attention";
  legacyJobId?: string;
  error: { code: string; message: string; retryable: false };
  untrustedFields: string[];
}

export type GenerationMigrationResult = GenerationJob | GenerationLegacyRecovery;
interface ParseSuccess { ok: true; job: GenerationJob }
interface ParseFailure { ok: false; issues: string[] }
export type SafeGenerationParseResult = ParseSuccess | ParseFailure;

export function migratePersistedGenerationJob(value: unknown): GenerationMigrationResult {
  const current = parseGenerationJobSafe(value);
  if (current.ok) return current.job;
  if (!value || typeof value !== "object") return legacyRecovery(undefined, "generation-invalid-legacy-job", ["root"]);

  const legacy = value as Record<string, unknown>;
  const legacyJobId = stringValue(legacy.id);
  const provider = normalizeProvider(legacy.provider);
  const routeResult = GenerationRouteIdentitySchema.safeParse(legacy.routing ?? legacy);
  const contextResult = GenerationContextSchema.safeParse(legacy.context);
  const projectId = stringValue(legacy.projectId);
  const modelId = stringValue(legacy.modelId ?? legacy.model);
  const modelSchemaVersion = stringValue(legacy.modelSchemaVersion);
  const status = normalizeStatus(legacy.status);
  const attempt = typeof legacy.attempt === "number" && Number.isInteger(legacy.attempt) && legacy.attempt > 0 ? legacy.attempt : undefined;
  const attempts = Array.isArray(legacy.attempts) ? legacy.attempts : undefined;
  const providerJobId = stringValue(legacy.providerJobId);
  const untrustedFields = [
    ...(!provider ? ["provider"] : []),
    ...(!legacyJobId ? ["id"] : []),
    ...(!routeResult.success ? ["routing"] : []),
    ...(!contextResult.success ? ["context.entryContext"] : []),
    ...(!projectId ? ["projectId"] : []),
    ...(!modelId ? ["modelId"] : []),
    ...(!modelSchemaVersion ? ["modelSchemaVersion"] : []),
    ...(!attempt ? ["attempt"] : []),
    ...(!attempts ? ["attempts"] : []),
    ...(["submitting", "running", "completed", "finalizing"].includes(status) && !providerJobId ? ["providerJobId"] : []),
  ];
  if (untrustedFields.length > 0 || !provider || !routeResult.success || !contextResult.success || !projectId || !modelId || !modelSchemaVersion || !attempt || !attempts || !legacyJobId) {
    return legacyRecovery(legacyJobId, "generation-legacy-identity-incomplete", untrustedFields.length > 0 ? untrustedFields : ["legacy"]);
  }

  const migrated = parseGenerationJobSafe({
    schemaVersion: GENERATION_JOB_SCHEMA_VERSION,
    contractVersion: GENERATION_JOB_CONTRACT_VERSION,
    id: legacyJobId,
    projectId,
    provider,
    providerInstanceId: routeResult.data.providerInstanceId,
    modelId,
    modelSchemaVersion,
    routing: routeResult.data,
    providerJobId: providerJobId || undefined,
    status,
    attempt,
    context: contextResult.data,
    providerInputs: isRecord(legacy.providerInputs) ? legacy.providerInputs : {},
    attempts,
    checkpoints: isRecord(legacy.checkpoints) ? legacy.checkpoints : {},
    output: legacy.output,
    error: legacy.error,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt ?? legacy.createdAt,
    placement: legacy.placement,
  });
  return migrated.ok ? migrated.job : legacyRecovery(legacyJobId, "generation-legacy-schema-invalid", migrated.issues);
}

export function parseGenerationJobSafe(value: unknown): SafeGenerationParseResult {
  try {
    return { ok: true, job: parseGenerationJob(value) };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, issues: error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`) };
    return { ok: false, issues: ["generation-schema-parse-failed"] };
  }
}

export function normalizeProvider(value: unknown): GenerationProvider | undefined {
  return value === "kieai" || value === "wavespeed" || value === "atlascloud" ? value : undefined;
}

export function normalizeStatus(value: unknown): GenerationDisposition {
  const known: GenerationDisposition[] = ["queued", "submitting", "running", "completed", "finalizing", "succeeded", "failed", "canceled", "needs-attention"];
  if (value === "complete") return "completed";
  if (value === "cancelled") return "canceled";
  return known.includes(value as GenerationDisposition) ? value as GenerationDisposition : "needs-attention";
}

export function numericTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasProviderInstanceId(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim().length > 0 ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function legacyRecovery(legacyJobId: string | undefined, code: string, untrustedFields: string[]): GenerationLegacyRecovery {
  return {
    kind: "legacy-recovery",
    status: "needs-attention",
    legacyJobId,
    error: { code, message: "Legacy generation identity is incomplete; explicit recovery is required.", retryable: false },
    untrustedFields,
  };
}
