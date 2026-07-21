import { createHash } from "node:crypto";
import type { GenerationJob, GenerationRouteIdentity } from "@openreel/music-video-domain/generation";
import type { GenerationProviderPort, GenerationProviderStatus } from "../generation/index.js";
import { assertNoSecrets, redactSecrets } from "./redaction.js";
import { assertWaveSpeedProviderInputSafety, isWaveSpeedReachableHttpsUrl } from "./input-safety.js";

export interface WaveSpeedFetchResponse { ok: boolean; status: number; json(): Promise<unknown> }
export type WaveSpeedFetch = (input: string, init: { method: string; headers: Record<string, string>; body?: string | FormData; signal: AbortSignal }) => Promise<WaveSpeedFetchResponse>;
export interface WaveSpeedLogger { warn(event: string, fields: Record<string, unknown>): void }
export class WaveSpeedProviderError extends Error { constructor(readonly code: string, readonly ambiguous: boolean, message = code) { super(message); this.name = "WaveSpeedProviderError"; } }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WaveSpeedProviderError("wavespeed-response-invalid", false);
  return value as Record<string, unknown>;
}
function dataRecord(value: unknown) { const root = record(value); return record(root.data ?? root); }
function requiredId(value: unknown) { if (typeof value !== "string" || !value.trim()) throw new WaveSpeedProviderError("wavespeed-response-provider-id-missing", false); return value; }
function outputUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.some((item) => typeof item !== "string" || !item.trim())) throw new WaveSpeedProviderError("wavespeed-output-identity-invalid", false);
  return value as string[];
}

/**
 * Maintained interface for wavespeed@0.2.4. The SDK source is authoritative:
 * POST /api/v3/{model}, then GET /api/v3/predictions/{taskId}/result. The SDK
 * exposes no cancellation method, so cancel is explicitly unsupported here.
 */
export class WaveSpeedProvider implements GenerationProviderPort {
  readonly cancellationSupported = false;
  constructor(private readonly options: { baseUrl: string; apiKey: string; fetch?: WaveSpeedFetch; timeoutMs?: number; logger?: WaveSpeedLogger }) { if (!options.apiKey.trim()) throw new WaveSpeedProviderError("wavespeed-api-key-missing", false); }

  private async request(path: string, method: string, body: unknown) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      if (payload) assertNoSecrets({ body: redactSecrets(body) });
      const response = await (this.options.fetch ?? (fetch as unknown as WaveSpeedFetch))(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, { method, headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" }, body: payload, signal: controller.signal });
      if (!response.ok) throw new WaveSpeedProviderError(`wavespeed-http-${response.status}`, response.status >= 500 || response.status === 429);
      return await response.json();
    } catch (cause) {
      const error = cause instanceof WaveSpeedProviderError ? cause : new WaveSpeedProviderError("wavespeed-request-timeout", true);
      this.options.logger?.warn("wavespeed-request-failed", { path, method, code: error.code, error: redactSecrets(error.message) });
      throw error;
    } finally { clearTimeout(timer); }
  }

  async submit(input: { job: GenerationJob; attemptNumber: number; idempotencyKey: string }) {
    assertWaveSpeedProviderInputSafety(input.job.providerInputs);
    const result = dataRecord(await this.request(`/api/v3/${input.job.routing.providerModelId}`, "POST", input.job.providerInputs));
    return { providerJobId: requiredId(result.id) };
  }

  async uploadMedia(input: { bytes: Uint8Array; mimeType: string }): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const path = "/api/v3/media/upload/binary";
    try {
      const bytes = Uint8Array.from(input.bytes);
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 20);
      const form = new FormData();
      form.append("file", new Blob([bytes.buffer], { type: input.mimeType }), `media-${digest}`);
      const response = await (this.options.fetch ?? (fetch as unknown as WaveSpeedFetch))(
        `${this.options.baseUrl.replace(/\/$/, "")}${path}`,
        { method: "POST", headers: { authorization: `Bearer ${this.options.apiKey}` }, body: form, signal: controller.signal },
      );
      if (!response.ok) throw new WaveSpeedProviderError(`wavespeed-http-${response.status}`, response.status >= 500 || response.status === 429);
      const url = dataRecord(await response.json()).download_url;
      if (typeof url !== "string" || !isWaveSpeedReachableHttpsUrl(url)) {
        throw new WaveSpeedProviderError("wavespeed-upload-url-invalid", false);
      }
      return url;
    } catch (cause) {
      const error = cause instanceof WaveSpeedProviderError ? cause : new WaveSpeedProviderError("wavespeed-request-timeout", true);
      this.options.logger?.warn("wavespeed-request-failed", { path, method: "POST", code: error.code, error: redactSecrets(error.message) });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async reconcileSubmission(_input: { job: GenerationJob; attemptNumber: number; idempotencyKey: string }): Promise<{ status: "unknown" }> {
    // wavespeed@0.2.4 exposes no lookup by the local logical attempt identity;
    // unknown is fail-closed so recovery never submits a second paid task.
    return { status: "unknown" };
  }

  async status(input: { providerJobId: string; routing: GenerationRouteIdentity }): Promise<GenerationProviderStatus> {
    const data = dataRecord(await this.request(`/api/v3/predictions/${encodeURIComponent(input.providerJobId)}/result`, "GET", undefined));
    const status = data.status;
    if (status === "processing") return { providerJobId: input.providerJobId, status: "running" };
    if (status === "completed") return { providerJobId: input.providerJobId, status: "completed", outputUrls: outputUrls(data.outputs) };
    if (status === "failed") return { providerJobId: input.providerJobId, status: "failed", error: { code: "wavespeed-provider-failed", message: "WaveSpeed prediction failed", retryable: true } };
    throw new WaveSpeedProviderError("wavespeed-status-unknown", false);
  }

  async cancel(_input: { providerJobId: string; routing: GenerationRouteIdentity }): Promise<void> { throw new WaveSpeedProviderError("wavespeed-cancel-unsupported", false); }
}
