export * from "./lock.js";
export * from "./repository.js";
export * from "./uploads.js";
export * from "./finalization.js";
export * from "./recovery.js";

import {
  assertGenerationV2SubmissionAllowed,
  isLegalGenerationTransition,
  parseGenerationJob,
  transitionGenerationDisposition,
  type GenerationJob,
  type GenerationRouteIdentity,
} from "@openreel/music-video-domain/generation";
import type { GenerationJobRepository, PlacementClaim } from "./repository.js";
import { GenerationPollingController, isPlacementReconciliationCandidate, projectTerminalPlacementSuccess } from "./recovery.js";

export interface GenerationProviderPort {
  /** idempotencyKey is the durable logical attempt identity and must be passed to the provider boundary. */
  submit(input: { job: GenerationJob; attemptNumber: number; idempotencyKey: string }): Promise<{ providerJobId: string }>;
  reconcileSubmission?(input: { job: GenerationJob; attemptNumber: number; idempotencyKey: string }): Promise<{ status: "submitted" | "pending" | "unknown"; providerJobId?: string }>;
  status(input: { providerJobId: string; routing: GenerationRouteIdentity }): Promise<GenerationProviderStatus>;
  cancel?(input: { providerJobId: string; routing: GenerationRouteIdentity }): Promise<void>;
}

export interface GenerationOutputIdentity { providerJobId: string; outputCount: number; outputUrls?: string[]; outputMediaIds?: string[] }
export interface GenerationProviderStatus {
  providerJobId: string;
  status: "submitting" | "running" | "completed" | "failed" | "canceled" | "unknown";
  outputUrls?: string[];
  outputMediaIds?: string[];
  error?: { code: string; message: string; retryable: boolean };
}

export interface GenerationFinalizerPort {
  finalize(input: { job: GenerationJob; output: GenerationOutputIdentity; idempotencyKey: string }): Promise<void>;
  reconcilePlacement(jobId: string): Promise<GenerationJob>;
}

export interface GenerationRouteManifestEntry { identity: GenerationRouteIdentity; schemaFingerprint: string; clientSchemaFingerprint: string; serverSchemaFingerprint: string; clientAcceptance: boolean; serverAcceptance: boolean; configurationVersion: string }
export interface GenerationRequestBoundary { contentType: string; byteLength: number; maxBytes: number; timeoutMs: number; maxTimeoutMs: number }
export interface GenerationRequestBoundaryPort { validate(input: GenerationRequestBoundary): void }
export interface GenerationOrchestratorOptions {
  repository: GenerationJobRepository;
  provider: GenerationProviderPort;
  routes: readonly GenerationRouteManifestEntry[];
  releaseEnabled: boolean;
  owner: (input: { ownerId: string; projectId: string }) => boolean | Promise<boolean>;
  finalizer: GenerationFinalizerPort;
  clock?: () => number;
  requestBoundary: GenerationRequestBoundaryPort;
}

export interface GenerationSubmitInput { ownerId: string; job: GenerationJob; request: GenerationRequestBoundary }
export interface GenerationJobCommand { ownerId: string; projectId: string; jobId: string }

export function validateGenerationRequestBoundary(input: GenerationRequestBoundary): void {
  if (!input.contentType.toLowerCase().startsWith("application/json")) throw new Error("content-type-required");
  if (!Number.isInteger(input.byteLength) || input.byteLength < 0 || input.byteLength > input.maxBytes) throw new Error("request-too-large");
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > input.maxTimeoutMs) throw new Error("request-timeout-invalid");
}

const routeIdentityKeys = ["providerInstanceId", "providerModelId", "requestedMode", "providerSchemaId", "providerEndpointId", "providerSchemaVersion"] as const;
function isRouteIdentity(value: unknown): value is GenerationRouteIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== routeIdentityKeys.length || routeIdentityKeys.some((key) => !keys.includes(key))) return false;
  return routeIdentityKeys.every((key) => typeof (value as Record<string, unknown>)[key] === "string" && (value as Record<string, string>)[key].trim().length > 0);
}
function routeKey(route: GenerationRouteIdentity) { return [route.providerInstanceId, route.providerModelId, route.requestedMode, route.providerSchemaId, route.providerEndpointId, route.providerSchemaVersion].join("\u0001"); }
function routeBaseKey(route: GenerationRouteIdentity) { return [route.providerInstanceId, route.providerModelId, route.requestedMode].join("\u0001"); }
function completeRoute(route: GenerationRouteIdentity) { return Object.values(route).every((value) => typeof value === "string" && value.trim().length > 0); }
function stableError(code: string, message = code, retryable = true) { return { code, message, retryable } as const; }
const PLACEMENT_RECONCILIATION_ERRORS = new Set(["generation-placement-outcome-unknown", "generation-placement-reconciliation-failed", "generation-placement-retry-unsafe"]);
function hasPlacementReconciliationIntent(job: GenerationJob) {
  return job.status === "finalizing"
    && job.context.placementPolicy !== "none"
    && job.checkpoints["placement-applied"]?.status === "failed"
    && PLACEMENT_RECONCILIATION_ERRORS.has(job.error?.code ?? "");
}
function placementClaimRequiresResume(job: GenerationJob, claim: PlacementClaim) {
  if (claim.phase !== "terminal") return true;
  if (claim.outcome === "unknown" || claim.outcome === "not-applied" && claim.replaySafe === false) return true;
  if (claim.outcome === "applied") return job.checkpoints["placement-applied"]?.status !== "completed" || job.placement?.status !== "applied";
  if (claim.outcome === "not-applied") return job.checkpoints["placement-applied"]?.status !== "failed" || job.placement?.status !== "failed";
  return false;
}
function outputIdentity(value: GenerationProviderStatus): GenerationOutputIdentity {
  const urls = value.outputUrls;
  const mediaIds = value.outputMediaIds;
  if (urls && (!Array.isArray(urls) || urls.some((item) => typeof item !== "string" || !item.trim()))) throw new Error("generation-output-identity-invalid");
  if (mediaIds && (!Array.isArray(mediaIds) || mediaIds.some((item) => typeof item !== "string" || !item.trim()))) throw new Error("generation-output-identity-invalid");
  if ((!urls || urls.length === 0) && (!mediaIds || mediaIds.length === 0)) throw new Error("generation-output-identity-missing");
  if (urls?.some((url) => !/^https:\/\//i.test(url) || /(?:blob:|local:|signed:|temporary:)/i.test(url))) throw new Error("generation-output-identity-invalid");
  if (mediaIds?.some((id) => /(?:blob:|local:|file:|signed:|temporary:)/i.test(id))) throw new Error("generation-output-identity-invalid");
  return { providerJobId: value.providerJobId, outputCount: Math.max(urls?.length ?? 0, mediaIds?.length ?? 0), outputUrls: urls, outputMediaIds: mediaIds ?? urls?.map((_url, index) => `provider-output:${value.providerJobId}:${index}`) };
}
function durableOutputIdentity(output: GenerationOutputIdentity) { return { providerJobId: output.providerJobId, outputMediaIds: output.outputMediaIds ?? [] }; }

/** Durable provider boundary. Public submission has no rollback escape hatch. */
export class GenerationOrchestrator {
  readonly polling = new GenerationPollingController();
  private readonly clock: () => number;
  constructor(private readonly options: GenerationOrchestratorOptions) { this.clock = options.clock ?? (() => Date.now()); }

  async submit(input: GenerationSubmitInput): Promise<GenerationJob> {
    return this.submitInternal(input.ownerId, input.job, false, input.request);
  }

  private async submitInternal(ownerId: string, inputJob: GenerationJob, recovery: boolean, request?: GenerationRequestBoundary) {
    const job = parseGenerationJob(inputJob);
    this.options.requestBoundary.validate(request ?? { contentType: "application/json", byteLength: 0, maxBytes: 0, timeoutMs: 1, maxTimeoutMs: 1 });
    await this.authorize(ownerId, job.projectId);
    if (!recovery) assertGenerationV2SubmissionAllowed(job.contractVersion, this.options.releaseEnabled);
    this.validateRoute(job.routing, job);

    let current = await this.options.repository.get(job.id);
    if (current) {
      await this.authorize(ownerId, current.projectId);
      if (current.providerJobId || ["submitting", "running", "completed", "finalizing", "succeeded", "canceled"].includes(current.status)) return current;
      if (current.status !== "queued") throw new Error("generation-submit-invalid-state");
      if (recovery && (current.contractVersion !== 2 || !current.attempts.some((attempt) => attempt.providerJobId))) throw new Error("generation-v2-recovery-not-authorized");
    } else {
      if (recovery) throw new Error("generation-v2-recovery-not-authorized");
      const attemptNumber = Math.max(1, job.attempt || 1);
      current = await this.options.repository.create({ ...job, status: "queued", attempt: attemptNumber, attempts: [{ ...(job.attempts[0] ?? { attemptNumber, routing: job.routing, startedAt: this.clock() }), attemptNumber, routing: job.routing, providerJobId: undefined, startedAt: this.clock() }], updatedAt: this.clock() });
    }

    const attemptNumber = current.attempt || Math.max(1, ...current.attempts.map((attempt) => attempt.attemptNumber));
    const idempotencyKey = `generation:${current.id}:attempt:${attemptNumber}`;
    const reservation = await this.options.repository.beginSubmission(current.id, attemptNumber, idempotencyKey);
    if (!reservation.acquired) {
      if (reservation.claim.providerJobId) return this.persistProviderIdentity(current.id, attemptNumber, reservation.claim.providerJobId);
      if (this.options.provider.reconcileSubmission) {
        const reconciliation = await this.options.provider.reconcileSubmission({ job: current, attemptNumber, idempotencyKey });
        if (reconciliation.status === "submitted" && reconciliation.providerJobId?.trim()) {
          await this.options.repository.recordProviderSubmission(current.id, attemptNumber, reconciliation.providerJobId);
          return this.persistProviderIdentity(current.id, attemptNumber, reconciliation.providerJobId);
        }
        if (reconciliation.status === "pending") return current;
      }
      return this.options.repository.update(current.id, (latest) => ({ ...latest, status: "needs-attention", error: stableError("generation-submission-reconciliation-required"), updatedAt: this.clock() }));
    }
    try {
      const result = await this.options.provider.submit({ job: current, attemptNumber, idempotencyKey });
      if (!result.providerJobId?.trim()) throw new Error("generation-provider-id-missing");
      await this.options.repository.recordProviderSubmission(current.id, attemptNumber, result.providerJobId);
      return await this.persistProviderIdentity(current.id, attemptNumber, result.providerJobId);
    } catch (cause) {
      const providerError = cause as { ambiguous?: boolean; code?: string };
      if (providerError.ambiguous === false || (cause instanceof Error && (cause.message === "generation-provider-id-missing" || cause.message.startsWith("generation-provider-submit")))) {
        await this.options.repository.releaseSubmission(current.id, attemptNumber, true);
        const failure = stableError(providerError.code ?? "generation-provider-submit-failed");
        return this.options.repository.update(current.id, (latest) => ({ ...latest, status: "failed", error: failure, updatedAt: this.clock(), attempts: latest.attempts.map((attempt) => attempt.attemptNumber === attemptNumber ? { ...attempt, endedAt: this.clock(), terminalError: failure } : attempt) }));
      }
      throw new Error("generation-submission-ambiguous");
    }
  }

  private async persistProviderIdentity(jobId: string, attemptNumber: number, providerJobId: string) {
    return this.options.repository.update(jobId, (latest) => ({ ...transitionGenerationDisposition(latest, "submitting"), providerJobId, updatedAt: this.clock(), attempts: latest.attempts.map((attempt) => attempt.attemptNumber === attemptNumber ? { ...attempt, providerJobId } : attempt) }));
  }

  async status(input: GenerationJobCommand): Promise<GenerationJob> {
    const job = await this.requireOwned(input);
    if (!job.providerJobId) throw new Error("generation-v2-submission-not-persisted");
    if (["succeeded", "canceled", "failed"].includes(job.status)) return job;
    if (job.status === "needs-attention") {
      const claim = await this.options.repository.getFinalizationClaim(job.id);
      if (claim?.state === "failed") return this.retryFinalization(input);
      return job;
    }
    if (job.status === "finalizing") return this.dispatchFinalization(job);
    let result: GenerationProviderStatus;
    try { result = await this.options.provider.status({ providerJobId: job.providerJobId, routing: job.routing }); }
    catch { return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError("generation-provider-status-failed"), updatedAt: this.clock() })); }
    if (result.providerJobId !== job.providerJobId || result.status === "unknown") return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError("generation-provider-response-invalid"), updatedAt: this.clock() }));
    if (result.status === "completed") {
      let output: GenerationOutputIdentity;
      try { output = outputIdentity(result); } catch (cause) { return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError(cause instanceof Error ? cause.message : "generation-output-identity-invalid"), updatedAt: this.clock() })); }
      if (job.status === "submitting") await this.options.repository.update(job.id, (current) => ({ ...transitionGenerationDisposition(current, "running"), updatedAt: this.clock() }));
      const finalizing = await this.options.repository.update(job.id, (current) => ({ ...transitionGenerationDisposition(current, "completed"), outputMediaIds: output.outputMediaIds, updatedAt: this.clock() }));
      const ready = await this.options.repository.update(job.id, (current) => ({ ...transitionGenerationDisposition(current, "finalizing"), updatedAt: this.clock() }));
      void finalizing;
      return this.dispatchFinalization(ready, output);
    }
    if (!isLegalGenerationTransition(job.status, result.status)) return job;
    return this.options.repository.update(job.id, (current) => ({ ...transitionGenerationDisposition(current, result.status as Exclude<GenerationProviderStatus["status"], "unknown">), error: result.error, updatedAt: this.clock() }));
  }

  private async dispatchFinalization(job: GenerationJob, transientOutput?: GenerationOutputIdentity) {
    const placementClaim = job.context.placementPolicy === "none" ? undefined : await this.options.repository.getPlacementClaim(job.id);
    if (hasPlacementReconciliationIntent(job) || placementClaim && placementClaimRequiresResume(job, placementClaim)) {
      return this.dispatchPlacementReconciliation(job.id);
    }
    if (!job.providerJobId || !job.outputMediaIds?.length) return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError("generation-output-identity-missing") }));
    let output = transientOutput;
    if (!output) {
      try {
        const refreshed = await this.options.provider.status({ providerJobId: job.providerJobId, routing: job.routing });
        output = outputIdentity(refreshed);
      } catch (cause) {
        return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError(cause instanceof Error ? cause.message : "generation-output-identity-invalid") }));
      }
    }
    const idempotencyKey = `generation:${job.id}:finalization:${job.providerJobId}`;
    let claim: Awaited<ReturnType<GenerationJobRepository["claimFinalization"]>>;
    try { claim = await this.options.repository.claimFinalization({ jobId: job.id, providerInstanceId: job.providerInstanceId, providerJobId: job.providerJobId, outputIdentity: JSON.stringify(durableOutputIdentity(output)), idempotencyKey }); }
    catch (cause) { return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError(cause instanceof Error ? cause.message : "generation-finalization-claim-failed"), updatedAt: this.clock() })); }
    if (!claim.acquired && claim.claim.state === "claimed") return job;
    if (!claim.acquired && claim.claim.state === "completed") return this.options.repository.update(job.id, (current) => ({ ...current, status: "succeeded", updatedAt: this.clock() }));
    try { await this.options.finalizer.finalize({ job, output, idempotencyKey }); await this.options.repository.completeFinalization(job.id, idempotencyKey, claim.claim.ownerToken); return this.options.repository.update(job.id, (current) => ({ ...current, status: "succeeded", updatedAt: this.clock() })); }
    catch { await this.options.repository.releaseFinalization(job.id, claim.claim.ownerToken); return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError("generation-finalization-failed"), updatedAt: this.clock() })); }
  }

  async retryFinalization(input: GenerationJobCommand): Promise<GenerationJob> {
    const job = await this.requireOwned(input);
    if (!job.providerJobId || !job.outputMediaIds?.length || !["needs-attention", "finalizing"].includes(job.status)) throw new Error("generation-invalid-finalization-retry-state");
    const ready = await this.options.repository.update(job.id, (current) => ({ ...current, status: "finalizing", updatedAt: this.clock() }));
    return this.dispatchFinalization(ready);
  }

  async reconcilePlacement(input: GenerationJobCommand): Promise<GenerationJob> {
    const job = await this.requireOwned(input);
    if (!isPlacementReconciliationCandidate(job)) throw new Error("generation-invalid-placement-reconciliation-state");
    await this.options.repository.update(job.id, (current) => {
      if (!isPlacementReconciliationCandidate(current)) throw new Error("generation-invalid-placement-reconciliation-state");
      return { ...current, status: "finalizing", updatedAt: this.clock() };
    });
    return this.dispatchPlacementReconciliation(job.id);
  }

  private async dispatchPlacementReconciliation(jobId: string): Promise<GenerationJob> {
    try {
      return await this.options.finalizer.reconcilePlacement(jobId);
    } catch (cause) {
      const terminal = await projectTerminalPlacementSuccess(this.options.repository, jobId, this.clock);
      if (terminal) return terminal;
      const latest = await this.options.repository.get(jobId);
      if (!latest) throw new Error("generation-not-found");
      if (latest.status !== "finalizing") return latest;
      const error = { code: "generation-placement-reconciliation-failed", message: cause instanceof Error ? cause.message : "Placement reconciliation failed", retryable: true };
      return this.options.repository.update(jobId, (current) => current.status !== "finalizing" || current.checkpoints["placement-applied"]?.status === "completed" ? current : ({ ...current, status: "needs-attention", error, updatedAt: this.clock(), checkpoints: { ...current.checkpoints, "placement-applied": { status: "failed", timestamp: this.clock(), error } }, placement: { policy: current.context.placementPolicy, status: "failed", error } }));
    }
  }

  async repairFinalization(input: GenerationJobCommand): Promise<GenerationJob> {
    const job = await this.requireOwned(input);
    const claim = await this.options.repository.getFinalizationClaim(job.id);
    if (!claim || claim.state !== "claimed") throw new Error("generation-finalization-repair-invalid-state");
    await this.options.repository.repairFinalization(job.id, claim.ownerToken);
    return this.options.repository.update(job.id, (current) => ({ ...current, status: "needs-attention", error: stableError("generation-finalization-repair-ready"), updatedAt: this.clock() }));
  }

  async repairSubmissionIdentity(input: GenerationJobCommand & { providerJobId: string }): Promise<GenerationJob> {
    const job = await this.requireOwned(input);
    if (!input.providerJobId.trim()) throw new Error("generation-provider-id-missing");
    const providerResult = await this.options.provider.status({ providerJobId: input.providerJobId, routing: job.routing });
    if (providerResult.providerJobId !== input.providerJobId || providerResult.status === "unknown") throw new Error("generation-submission-identity-unverified");
    const attemptNumber = job.attempt || Math.max(1, ...job.attempts.map((attempt) => attempt.attemptNumber));
    await this.options.repository.repairSubmissionIdentity(job.id, attemptNumber, input.providerJobId);
    return this.options.repository.update(job.id, (current) => ({ ...current, status: "submitting", providerJobId: input.providerJobId, updatedAt: this.clock(), attempts: current.attempts.map((attempt) => attempt.attemptNumber === attemptNumber ? { ...attempt, providerJobId: input.providerJobId } : attempt) }));
  }

  async cancel(input: GenerationJobCommand): Promise<GenerationJob> {
    const job = await this.requireOwned(input); this.polling.stop(job.id); if (job.status === "canceled") return job;
    if (!["queued", "submitting", "running", "needs-attention"].includes(job.status)) throw new Error("generation-invalid-cancel-state");
    const canceled = await this.options.repository.update(job.id, (current) => transitionGenerationDisposition({ ...current, updatedAt: this.clock() }, "canceled"));
    if (canceled.providerJobId) await this.options.provider.cancel?.({ providerJobId: canceled.providerJobId, routing: canceled.routing }).catch(() => undefined);
    return canceled;
  }

  async retryProvider(input: GenerationJobCommand): Promise<GenerationJob> {
    const job = await this.requireOwned(input); if (job.status !== "failed" || !job.providerJobId) throw new Error("generation-invalid-retry-state");
    const attemptNumber = Math.max(0, ...job.attempts.map((attempt) => attempt.attemptNumber)) + 1;
    const reserved = await this.options.repository.update(job.id, (current) => ({ ...current, status: "queued", attempt: attemptNumber, providerJobId: undefined, error: undefined, updatedAt: this.clock(), attempts: [...current.attempts, { attemptNumber, routing: current.routing, startedAt: this.clock() }] }));
    return this.submitInternal(input.ownerId, reserved, true);
  }

  private validateRoute(route: GenerationRouteIdentity, job: GenerationJob) {
    if (!completeRoute(route)) throw new Error("generation-route-unsupported");
    const entries = this.options.routes;
    if (entries.some((candidate) => !candidate || !isRouteIdentity(candidate.identity))) throw new Error("generation-route-unsupported");
    const sameIdentity = entries.filter((candidate) => routeKey(candidate.identity) === routeKey(route));
    if (sameIdentity.some((candidate) => !completeRoute(candidate.identity) || typeof candidate.schemaFingerprint !== "string" || !candidate.schemaFingerprint.trim() || typeof candidate.clientSchemaFingerprint !== "string" || typeof candidate.serverSchemaFingerprint !== "string" || typeof candidate.configurationVersion !== "string" || !candidate.configurationVersion.trim())) throw new Error("generation-route-unsupported");
    const exact = entries.filter((candidate) => completeRoute(candidate.identity) && typeof candidate.schemaFingerprint === "string" && candidate.schemaFingerprint.trim() && typeof candidate.configurationVersion === "string" && candidate.configurationVersion.trim() && routeKey(candidate.identity) === routeKey(route));
    if (exact.length > 1) throw new Error("generation-route-ambiguous");
    if (exact.length === 0) {
      const sameBase = entries.filter((candidate) => routeBaseKey(candidate.identity) === routeBaseKey(route));
      if (sameBase.some((candidate) => !completeRoute(candidate.identity))) throw new Error("generation-route-unsupported");
      if (sameBase.length > 0) throw new Error("generation-route-stale");
      throw new Error("generation-route-unsupported");
    }
    const selected = exact[0];
    if (!selected.clientAcceptance || !selected.serverAcceptance || selected.clientSchemaFingerprint !== selected.serverSchemaFingerprint || selected.schemaFingerprint !== selected.clientSchemaFingerprint) throw new Error("generation-schema-drift");
    if (selected.identity.providerSchemaVersion !== job.modelSchemaVersion) throw new Error("generation-route-stale");
  }
  private async authorize(ownerId: string, projectId: string) { if (!(await this.options.owner({ ownerId, projectId }))) throw new Error("generation-forbidden"); }
  private async requireOwned(input: GenerationJobCommand) { const job = await this.options.repository.get(input.jobId); if (!job) throw new Error("generation-not-found"); if (job.projectId !== input.projectId) throw new Error("generation-forbidden"); await this.authorize(input.ownerId, job.projectId); return job; }
}
