import type {
  MediaAvailabilityStatus,
  MediaVerificationBatchResponse,
  MediaVerificationOutcome,
} from "@openreel/core";

type Fetcher = typeof fetch;

export interface ProbeOptions {
  readonly fetcher?: Fetcher;
  readonly expectedType?: "video" | "audio" | "image" | "srt";
  readonly expectedBytes?: number;
}

const MIME_PREFIX: Record<NonNullable<ProbeOptions["expectedType"]>, string> = {
  video: "video/", audio: "audio/", image: "image/", srt: "text/",
};

export function classifyProbeResponse(
  response: Response,
  options: ProbeOptions & { readonly rangeProbe?: boolean } = {},
): MediaAvailabilityStatus {
  if (response.status === 401 || response.status === 403) return "unauthorized";
  if (!response.ok) return "temporarily_unavailable";
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html")) return "decode_error";
  if (options.expectedType && contentType && !contentType.startsWith(MIME_PREFIX[options.expectedType])) return "decode_error";
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length <= 0) return "decode_error";
  if (options.rangeProbe) {
    const match = /^bytes 0-0\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    if (response.status !== 206 || !match || length !== 1) return "decode_error";
    const total = Number(match[1]);
    if (total <= 0 || (options.expectedBytes != null && total !== options.expectedBytes)) return "decode_error";
  } else if (options.expectedBytes != null && Number.isFinite(length) && length !== options.expectedBytes) {
    return "decode_error";
  }
  return "available";
}

export async function probeMediaUrl(url: string, options: ProbeOptions = {}): Promise<MediaAvailabilityStatus> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const head = await fetcher(url, { method: "HEAD" });
    if (head.status !== 405 && head.status !== 501) return classifyProbeResponse(head, options);
    const ranged = await fetcher(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    return classifyProbeResponse(ranged, { ...options, rangeProbe: true });
  } catch {
    return "temporarily_unavailable";
  }
}

type Batch = (projectId: string, mediaIds: readonly string[], signal: AbortSignal) => Promise<MediaVerificationBatchResponse>;

interface CoordinatorOptions {
  readonly batch: Batch;
  readonly concurrency?: number;
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly jitter?: () => number;
}

interface VerifyGuard {
  readonly generation?: number;
  readonly getGeneration?: () => number;
  readonly currentUrl?: (mediaId: string) => string | null | undefined;
}

export interface RuntimeVerifyOptions {
  readonly currentUrl?: (mediaId: string) => string | null | undefined;
  readonly getActiveProjectId?: () => string | null | undefined;
}

export interface MediaAvailabilitySnapshot {
  readonly projectId: string;
  readonly generation: number;
  readonly outcomes: ReadonlyMap<string, MediaVerificationOutcome>;
}

export type MediaAvailabilityListener = (snapshot: MediaAvailabilitySnapshot) => void;

export interface MediaAvailabilityRuntimeOptions {
  readonly automaticRecoveryAttempts?: number;
  readonly recoveryDelayMs?: number;
}

const BASE_URL = import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:4041";

export async function requestMediaVerification(
  projectId: string,
  mediaIds: readonly string[],
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  timeoutMs = 5_000,
): Promise<MediaVerificationBatchResponse> {
  const requestController = new AbortController();
  let timedOut = false;
  const forwardAbort = () => requestController.abort(signal.reason);
  if (signal.aborted) forwardAbort();
  else signal.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort(new DOMException("verification timed out", "TimeoutError"));
  }, timeoutMs);
  try {
    const response = await fetcher(`${BASE_URL}/api/projects/${encodeURIComponent(projectId)}/verify-media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaIds }),
      signal: requestController.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return batchFailure(projectId, mediaIds, "unauthorized", `verification HTTP ${response.status}`);
    }
    if (!response.ok) {
      return batchFailure(projectId, mediaIds, "temporarily_unavailable", `verification HTTP ${response.status}`);
    }
    return await response.json() as MediaVerificationBatchResponse;
  } catch (error) {
    return batchFailure(projectId, mediaIds, "temporarily_unavailable", timedOut ? "timeout" : classifyTransportFailure(error, signal));
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", forwardAbort);
  }
}

function batchFailure(
  projectId: string,
  mediaIds: readonly string[],
  status: "unauthorized" | "temporarily_unavailable",
  reason: string,
): MediaVerificationBatchResponse {
  return {
    projectId,
    outcomes: mediaIds.map(mediaId => ({
      mediaId,
      status,
      evidence: { authoritative: false, mapping: "unknown", object: "unknown", reason },
    })),
  };
}

/** Fetch deliberately hides DNS, refusal and CORS details in some browsers. Preserve
 * a deterministic reason when the platform exposes one, and use `transport` otherwise. */
export function classifyTransportFailure(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return "cancelled";
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (message.includes("hmr") || message.includes("hot module")) return "hmr";
  if (message.includes("cors") || message.includes("cross-origin")) return "cors";
  if (message.includes("enotfound") || message.includes("dns") || message.includes("name not resolved")) return "dns";
  if (message.includes("econnrefused") || message.includes("connection refused")) return "refused";
  return "transport";
}

export class MediaVerificationCoordinator {
  private readonly inflight = new Map<string, Promise<MediaVerificationOutcome>>();
  private readonly controllers = new Map<string, AbortController>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly options: CoordinatorOptions) {}

  async verify(projectId: string, mediaIds: readonly string[], guard: VerifyGuard = {}): Promise<MediaVerificationOutcome[]> {
    const originalUrls = new Map(mediaIds.map(id => [id, guard.currentUrl?.(id)]));
    const outcomes = await Promise.all([...new Set(mediaIds)].map(mediaId => this.one(projectId, mediaId)));
    if (guard.generation != null && guard.getGeneration?.() !== guard.generation) return [];
    return outcomes.filter(outcome => !guard.currentUrl || guard.currentUrl(outcome.mediaId) === originalUrls.get(outcome.mediaId));
  }

  cancelProject(projectId: string): void {
    this.controllers.get(projectId)?.abort();
  }

  private one(projectId: string, mediaId: string): Promise<MediaVerificationOutcome> {
    const key = `${projectId}\0${mediaId}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.run(projectId, mediaId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async run(projectId: string, mediaId: string): Promise<MediaVerificationOutcome> {
    const controller = this.controllers.get(projectId) ?? new AbortController();
    this.controllers.set(projectId, controller);
    await this.acquire();
    try {
      const retries = this.options.maxRetries ?? 2;
      for (let attempt = 0; ; attempt++) {
        if (controller.signal.aborted) return this.transient(mediaId, "verification cancelled");
        try {
          const response = await this.options.batch(projectId, [mediaId], controller.signal);
          if (controller.signal.aborted) return this.transient(mediaId, "verification cancelled");
          const outcome = response.outcomes.find(value => value.mediaId === mediaId) ?? this.transient(mediaId, "omitted outcome");
          if (outcome.status !== "temporarily_unavailable" || attempt >= retries) return outcome;
        } catch (error) {
          if (controller.signal.aborted || attempt >= retries) return this.transient(mediaId, error instanceof Error ? error.message : "transport failure");
        }
        const jitter = this.options.jitter?.() ?? Math.random();
        await this.delay((this.options.baseDelayMs ?? 200) * 2 ** attempt * (1 + jitter), controller.signal);
      }
    } finally {
      this.release();
      if (controller.signal.aborted) this.controllers.delete(projectId);
    }
  }

  private transient(mediaId: string, reason: string): MediaVerificationOutcome {
    return { mediaId, status: "temporarily_unavailable", evidence: { authoritative: false, mapping: "unknown", object: "unknown", reason } };
  }

  private async acquire(): Promise<void> {
    const limit = Math.max(1, this.options.concurrency ?? 4);
    if (this.active >= limit) await new Promise<void>(resolve => this.waiters.push(resolve));
    this.active++;
  }

  private release(): void { this.active--; this.waiters.shift()?.(); }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}

/** Sidecar runtime state. It is deliberately separate from Project/MediaItem serialization. */
export class MediaAvailabilityRuntime {
  private readonly outcomes = new Map<string, MediaVerificationOutcome>();
  private readonly generations = new Map<string, number>();
  private readonly listeners = new Set<MediaAvailabilityListener>();
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly coordinator = new MediaVerificationCoordinator({ batch: requestMediaVerification, concurrency: 4 }),
    private readonly options: MediaAvailabilityRuntimeOptions = {},
  ) {}

  get(projectId: string, mediaId: string): MediaVerificationOutcome | undefined {
    return this.outcomes.get(`${projectId}\0${mediaId}`);
  }

  getGeneration(projectId: string): number {
    return this.generations.get(projectId) ?? 0;
  }

  subscribe(listener: MediaAvailabilityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markDecodeError(projectId: string, mediaId: string, reason = "media decode failed"): void {
    this.outcomes.set(`${projectId}\0${mediaId}`, { mediaId, status: "decode_error", evidence: { authoritative: false, mapping: "unknown", object: "unknown", reason } });
    this.notify(projectId, this.generations.get(projectId) ?? 0);
  }

  async verify(
    projectId: string,
    mediaIds: readonly string[],
    options: RuntimeVerifyOptions = {},
  ): Promise<MediaVerificationOutcome[]> {
    return this.verifyWithRecoveryBudget(
      projectId,
      mediaIds,
      options,
      this.options.automaticRecoveryAttempts ?? 1,
    );
  }

  private async verifyWithRecoveryBudget(
    projectId: string,
    mediaIds: readonly string[],
    options: RuntimeVerifyOptions,
    recoveryBudget: number,
  ): Promise<MediaVerificationOutcome[]> {
    if (options.getActiveProjectId && options.getActiveProjectId() !== projectId) return [];
    const uniqueIds = [...new Set(mediaIds)];
    const generation = (this.generations.get(projectId) ?? 0) + 1;
    this.generations.set(projectId, generation);
    const previous = new Map(uniqueIds.map(mediaId => [mediaId, this.get(projectId, mediaId)]));
    for (const mediaId of uniqueIds) {
      this.outcomes.set(`${projectId}\0${mediaId}`, {
        mediaId,
        status: "verifying",
        evidence: { authoritative: false, mapping: "unknown", object: "unknown" },
      });
    }
    this.notify(projectId, generation);

    const outcomes = await this.coordinator.verify(projectId, uniqueIds, {
      generation,
      getGeneration: () => this.generations.get(projectId) ?? 0,
      currentUrl: options.currentUrl,
    });
    const current = this.generations.get(projectId) === generation;
    const active = !options.getActiveProjectId || options.getActiveProjectId() === projectId;
    if (!current || !active) {
      if (current) {
        for (const mediaId of uniqueIds) {
          const old = previous.get(mediaId);
          if (old) this.outcomes.set(`${projectId}\0${mediaId}`, old);
          else this.outcomes.delete(`${projectId}\0${mediaId}`);
        }
        this.notify(projectId, generation);
      }
      return [];
    }
    for (const outcome of outcomes) this.outcomes.set(`${projectId}\0${outcome.mediaId}`, outcome);
    this.notify(projectId, generation);
    const unavailable = outcomes
      .filter(outcome => outcome.status === "temporarily_unavailable")
      .map(outcome => outcome.mediaId);
    if (unavailable.length > 0 && recoveryBudget > 0) {
      const existing = this.recoveryTimers.get(projectId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.recoveryTimers.delete(projectId);
        void this.verifyWithRecoveryBudget(projectId, unavailable, options, recoveryBudget - 1);
      }, this.options.recoveryDelayMs ?? 1_000);
      this.recoveryTimers.set(projectId, timer);
    }
    return outcomes;
  }

  cancel(projectId: string): void {
    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1);
    this.coordinator.cancelProject(projectId);
    const timer = this.recoveryTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.recoveryTimers.delete(projectId);
  }

  reset(): void {
    const projectIds = new Set<string>();
    for (const key of this.outcomes.keys()) projectIds.add(key.split("\0", 1)[0]!);
    for (const projectId of this.recoveryTimers.keys()) projectIds.add(projectId);
    for (const projectId of projectIds) this.cancel(projectId);
    this.outcomes.clear();
    for (const projectId of projectIds) {
      this.notify(projectId, this.generations.get(projectId) ?? 0);
    }
  }

  private notify(projectId: string, generation: number): void {
    const prefix = `${projectId}\0`;
    const outcomes = new Map<string, MediaVerificationOutcome>();
    for (const [key, outcome] of this.outcomes) {
      if (key.startsWith(prefix)) outcomes.set(outcome.mediaId, outcome);
    }
    const snapshot = { projectId, generation, outcomes } satisfies MediaAvailabilitySnapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const mediaAvailabilityRuntime = new MediaAvailabilityRuntime();
