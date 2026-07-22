import { createHash } from "node:crypto";
import { createInfrastructureNonce } from "@openreel/core/identity/durable-id";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GenerationRouteIdentity } from "@openreel/music-video-domain/generation";
import type {
  DownloadedGenerationOutput,
  GenerationOutputDownloader,
} from "./finalization.js";
import type { GenerationProviderPort } from "./index.js";

interface ReplaySafeDownloaderOptions {
  readonly cacheDir: string;
  readonly provider: GenerationProviderPort;
  readonly fetch?: (input: string, init: { signal: AbortSignal }) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  readonly timeoutMs?: number;
}

interface DownloadInput {
  readonly providerInstanceId: string;
  readonly providerJobId: string;
  readonly outputIdentity: string;
  readonly routing: GenerationRouteIdentity;
  readonly transientOutputUrl?: string;
}

interface CacheMetadata {
  readonly providerInstanceId: string;
  readonly providerJobId: string;
  readonly outputIdentity: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export function generationOutputCacheKey(input: Pick<DownloadInput, "providerInstanceId" | "providerJobId" | "outputIdentity">): string {
  return createHash("sha256").update(JSON.stringify([
    input.providerInstanceId,
    input.providerJobId,
    input.outputIdentity,
  ])).digest("hex");
}

function mimeTypeFrom(value: string | null): string {
  const mimeType = String(value ?? "").split(";", 1)[0]?.trim() ?? "";
  if (!/^(image\/(png|jpeg|webp)|video\/(mp4|webm))$/.test(mimeType)) {
    throw new Error("generation-output-mime-invalid");
  }
  return mimeType;
}

function isMissingFile(cause: unknown): boolean {
  return cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT";
}

async function atomicWrite(path: string, value: string | Uint8Array): Promise<void> {
    const temporary = `${path}.${createInfrastructureNonce()}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
    await rename(temporary, path);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

function validMetadata(value: unknown, input: DownloadInput): value is CacheMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  const allowed = new Set([
    "providerInstanceId",
    "providerJobId",
    "outputIdentity",
    "mimeType",
    "byteLength",
    "sha256",
  ]);
  return !Object.keys(metadata).some((key) => !allowed.has(key))
    && metadata.providerInstanceId === input.providerInstanceId
    && metadata.providerJobId === input.providerJobId
    && metadata.outputIdentity === input.outputIdentity
    && typeof metadata.mimeType === "string"
    && Number.isInteger(metadata.byteLength)
    && Number(metadata.byteLength) >= 0
    && typeof metadata.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(metadata.sha256);
}

async function readCache(cacheDir: string, input: DownloadInput): Promise<DownloadedGenerationOutput | undefined> {
  const key = generationOutputCacheKey(input);
  let rawMetadata: string;
  try {
    rawMetadata = await readFile(join(cacheDir, `${key}.json`), "utf8");
  } catch (cause) {
    if (isMissingFile(cause)) return undefined;
    throw new Error("generation-output-cache-read-failed", { cause });
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(rawMetadata);
  } catch (cause) {
    throw new Error("generation-output-cache-corrupt", { cause });
  }
  if (!validMetadata(metadata, input)) throw new Error("generation-output-cache-corrupt");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(join(cacheDir, `${key}.bin`)));
  } catch (cause) {
    throw new Error("generation-output-cache-corrupt", { cause });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== metadata.byteLength || sha256 !== metadata.sha256) {
    throw new Error("generation-output-cache-corrupt");
  }
  return { bytes, mimeType: mimeTypeFrom(metadata.mimeType) };
}

async function resolveProviderOutput(
  input: DownloadInput,
  provider: GenerationProviderPort,
): Promise<{ readonly outputUrl: string } | DownloadedGenerationOutput> {
  if (input.transientOutputUrl) return { outputUrl: input.transientOutputUrl };
  const state = await provider.status({
    providerJobId: input.providerJobId,
    routing: input.routing,
  });
  const urls = state.outputUrls ?? [];
  const identities = state.outputMediaIds
    ?? urls.map((_url, index) => `provider-output:${state.providerJobId}:${index}`);
  if (state.providerJobId !== input.providerJobId
    || state.status !== "completed"
    || identities.length !== 1
    || identities[0] !== input.outputIdentity) {
    throw new Error("generation-output-identity-invalid");
  }
  if (urls.length === 1) return { outputUrl: urls[0]! };
  if (urls.length !== 0 || !provider.downloadOutput) {
    throw new Error("generation-output-identity-invalid");
  }
  const output = await provider.downloadOutput({
    providerJobId: input.providerJobId,
    outputIdentity: input.outputIdentity,
    routing: input.routing,
  });
  return { bytes: output.bytes, mimeType: mimeTypeFrom(output.mimeType) };
}

export function createReplaySafeGenerationOutputDownloader(
  options: ReplaySafeDownloaderOptions,
): GenerationOutputDownloader {
  return {
    async download(input) {
      const exactInput: DownloadInput = input;
      const cached = await readCache(options.cacheDir, exactInput);
      if (cached) return cached;
      const providerOutput = await resolveProviderOutput(exactInput, options.provider);
      let bytes: Uint8Array;
      let mimeType: string;
      if ("outputUrl" in providerOutput) {
        const url = new URL(providerOutput.outputUrl);
        if (url.protocol !== "https:") throw new Error("generation-local-url-forbidden");
        const fetchOutput = options.fetch ?? ((target, init) => fetch(target, init));
        const response = await fetchOutput(url.href, {
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        if (!response.ok) throw new Error(`generation-output-download-failed:${response.status}`);
        mimeType = mimeTypeFrom(response.headers.get("content-type"));
        bytes = new Uint8Array(await response.arrayBuffer());
      } else {
        bytes = providerOutput.bytes;
        mimeType = providerOutput.mimeType;
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const metadata: CacheMetadata = {
        providerInstanceId: exactInput.providerInstanceId,
        providerJobId: exactInput.providerJobId,
        outputIdentity: exactInput.outputIdentity,
        mimeType,
        byteLength: bytes.byteLength,
        sha256,
      };
      const key = generationOutputCacheKey(exactInput);
      await mkdir(options.cacheDir, { recursive: true });
      await atomicWrite(join(options.cacheDir, `${key}.bin`), bytes);
      await atomicWrite(join(options.cacheDir, `${key}.json`), JSON.stringify(metadata));
      return { bytes, mimeType };
    },
  };
}
