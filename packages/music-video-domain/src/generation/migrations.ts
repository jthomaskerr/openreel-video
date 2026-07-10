import { GENERATION_JOB_SCHEMA_VERSION, type GenerationJob } from "./contracts.js";
import { parseGenerationJob } from "./schemas.js";

export function migratePersistedGenerationJob(value: unknown): GenerationJob {
  const current = parseGenerationJobSafe(value);
  if (current) return current;
  if (!value || typeof value !== "object") throw new Error("generation-invalid-legacy-job");
  const legacy = value as Record<string, unknown>;
  const explicitTarget = legacy.target;
  const placeholderMediaId = typeof legacy.placeholderMediaId === "string" ? legacy.placeholderMediaId : undefined;
  let target: unknown = explicitTarget;
  if (!target && placeholderMediaId) target = legacy.sourceMediaId
    ? { kind: "new-version", sourceMediaId: legacy.sourceMediaId, placeholderMediaId }
    : { kind: "new-asset", placeholderMediaId };
  const safeTarget = target && typeof target === "object" && "kind" in target ? target : { kind: "new-asset", placeholderMediaId: `needs-attention:${String(legacy.id ?? "unknown")}` };
  const ambiguous = !explicitTarget && !placeholderMediaId;
  return parseGenerationJob({
    schemaVersion: GENERATION_JOB_SCHEMA_VERSION, id: String(legacy.id ?? "legacy-unknown"), provider: String(legacy.provider ?? "unknown"),
    modelId: String(legacy.modelId ?? legacy.model ?? "unknown"), modelSchemaVersion: String(legacy.modelSchemaVersion ?? "legacy"),
    status: ambiguous ? "needs-attention" : normalizeStatus(legacy.status), createdAt: numericTimestamp(legacy.createdAt), updatedAt: numericTimestamp(legacy.updatedAt ?? legacy.createdAt),
    context: { projectId: String(legacy.projectId ?? "unknown"), target: safeTarget, references: [], placementPolicy: "none" },
    providerInputs: {}, attempts: [], checkpoints: {}, ...(ambiguous ? { error: { code: "generation-legacy-target-ambiguous", retryable: false } } : {}),
  });
}
function parseGenerationJobSafe(value: unknown): GenerationJob | undefined { try { return parseGenerationJob(value) as GenerationJob; } catch { return undefined; } }
function numericTimestamp(value: unknown): number { if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value; const parsed = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : 0; }
function normalizeStatus(value: unknown): GenerationJob["status"] { const map: Record<string, GenerationJob["status"]> = { complete: "completed", cancelled: "canceled" }; const status = String(value ?? "preparing"); return (["preparing", "queued", "running", "completed", "failed", "canceling", "canceled"] as const).includes(status as never) ? status as GenerationJob["status"] : map[status] ?? "preparing"; }

