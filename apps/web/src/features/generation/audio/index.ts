export type GenerationAudioFormat = 'pcm-s16le-wav';

export interface GenerationAudioRequest {
  projectId: string;
  mediaId: string;
  versionId: string;
  sourceClipId?: string;
  projectStartSeconds: number;
  projectEndSeconds: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  sourceInSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds?: number;
  speed: number;
  sampleRate: number;
  channels: number;
  format: GenerationAudioFormat;
}

export interface ExtractedPcm {
  /** Interleaved signed 16-bit PCM samples. */
  samples: Int16Array;
  actualSourceStartSeconds: number;
  actualSourceEndSeconds: number;
  sourceClipId?: string;
  warning?: GenerationAudioPartialCoverageWarning;
  cleanup?: () => void;
}

export interface GenerationAudioSource {
  mediaId: string;
  versionId: string;
  clipId: string;
  bytes: Uint8Array;
}

export interface GenerationAudioSourceResolver {
  resolve(
    input: Readonly<{ projectId: string; mediaId: string; versionId: string; clipId?: string }>,
    signal?: AbortSignal,
  ): Promise<GenerationAudioSource>;
}

export interface DecodedPcm {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
  startSeconds: number;
  endSeconds: number;
  cleanup?: () => void;
}

export interface GenerationAudioDecoder {
  decode(source: Readonly<GenerationAudioSource>, signal?: AbortSignal): Promise<DecodedPcm>;
}

export interface GenerationAudioLeasePort {
  upload(input: Readonly<{ bytes: Uint8Array; mimeType: 'audio/wav'; provenance: GenerationAudioProvenance }>, signal?: AbortSignal): Promise<{ leaseId: string }>;
  release(input: Readonly<{ leaseId: string }>): Promise<void>;
}

export interface GenerationAudioProvenance {
  sourceMediaId: string;
  sourceVersionId: string;
  sourceClipId: string;
  requestedProjectRange: { startSeconds: number; endSeconds: number };
  requestedSourceRange: { startSeconds: number; endSeconds: number };
  actualSourceRange: { startSeconds: number; endSeconds: number };
  format: GenerationAudioFormat;
  byteLength: number;
  sha256: string;
}

export interface PreparedGenerationAudioHandoff extends PreparedGenerationAudio {
  uploadLeaseId: string;
  provenance: GenerationAudioProvenance;
  release(): Promise<void>;
}

export class GenerationAudioPartialCoverageWarning extends Error {
  readonly code = 'generation-audio-partial-coverage';

  constructor() {
    super('Audio source covers only part of the requested range.');
    this.name = 'GenerationAudioPartialCoverageWarning';
  }
}

export class GenerationAudioEmptyError extends Error {
  readonly code = 'generation-audio-empty-extraction';

  constructor() {
    super('Audio extraction produced no samples for the requested range.');
    this.name = 'GenerationAudioEmptyError';
  }
}

export type GenerationAudioErrorCode =
  | 'generation-audio-configuration-invalid'
  | 'generation-audio-source-resolve-failed'
  | 'generation-audio-decode-failed'
  | 'generation-audio-extraction-failed'
  | 'generation-audio-upload-failed'
  | 'generation-audio-cleanup-failed'
  | 'generation-audio-lease-release-failed'
  | 'generation-audio-source-identity-mismatch';

export class GenerationAudioError extends Error {
  constructor(
    readonly code: GenerationAudioErrorCode,
    message: string,
    readonly retryable = true,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'GenerationAudioError';
  }
}

export class GenerationAudioLeaseReleaseError extends GenerationAudioError {
  constructor(cause: unknown) {
    super('generation-audio-lease-release-failed', 'Audio upload lease release failed.', true, { cause });
    this.name = 'GenerationAudioLeaseReleaseError';
  }
}

export interface GenerationAudioExtractor {
  extract(request: Readonly<GenerationAudioRequest>, signal?: AbortSignal): Promise<ExtractedPcm>;
}

export interface PreparedGenerationAudio {
  bytes: Uint8Array;
  mimeType: 'audio/wav';
  sha256: string;
  sampleRate: number;
  channels: number;
  sampleCount: number;
  actualSourceStartSeconds: number;
  actualSourceEndSeconds: number;
  sourceClipId?: string;
  partial: boolean;
  warning?: GenerationAudioPartialCoverageWarning;
  cacheKey: string;
}

export interface GenerationAudioCache {
  get(key: string): PreparedGenerationAudio | undefined;
  set(key: string, value: PreparedGenerationAudio): void;
  delete(key: string): void;
}

export class MemoryGenerationAudioCache implements GenerationAudioCache {
  readonly #values = new Map<string, PreparedGenerationAudio>();

  get(key: string): PreparedGenerationAudio | undefined {
    return this.#values.get(key);
  }

  set(key: string, value: PreparedGenerationAudio): void {
    this.#values.set(key, value);
  }

  delete(key: string): void {
    this.#values.delete(key);
  }
}

const canonicalNumber = (value: number): string => {
  if (!Number.isFinite(value)) throw new TypeError('audio-cache-key-invalid-number');
  return Object.is(value, -0) ? '0' : value.toString();
};

export function buildGenerationAudioCacheKey(request: Readonly<GenerationAudioRequest>): string {
  const fields: Array<[string, string]> = [
    ['project', request.projectId],
    ['media', request.mediaId],
    ['version', request.versionId],
    ['sourceClip', request.sourceClipId ?? ''],
    ['projectStart', canonicalNumber(request.projectStartSeconds)],
    ['projectEnd', canonicalNumber(request.projectEndSeconds)],
    ['sourceStart', canonicalNumber(request.sourceStartSeconds)],
    ['sourceEnd', canonicalNumber(request.sourceEndSeconds)],
    ['sourceIn', canonicalNumber(request.sourceInSeconds)],
    ['trimStart', canonicalNumber(request.trimStartSeconds)],
    ['trimEnd', request.trimEndSeconds === undefined ? '' : canonicalNumber(request.trimEndSeconds)],
    ['speed', canonicalNumber(request.speed)],
    ['sampleRate', canonicalNumber(request.sampleRate)],
    ['channels', canonicalNumber(request.channels)],
    ['format', request.format],
  ];

  return fields.map(([name, value]) => `${name.length}:${name}${value.length}:${value}`).join('|');
}

const validateRequest = (request: Readonly<GenerationAudioRequest>): void => {
  if (!request.sourceClipId) throw new TypeError('generation-audio-source-clip-required');
  const values = [
    request.projectStartSeconds,
    request.projectEndSeconds,
    request.sourceStartSeconds,
    request.sourceEndSeconds,
    request.sourceInSeconds,
    request.trimStartSeconds,
    request.speed,
    request.sampleRate,
    request.channels,
  ];
  if (request.trimEndSeconds !== undefined) values.push(request.trimEndSeconds);

  if (
    values.some((value) => !Number.isFinite(value)) ||
    request.projectStartSeconds < 0 ||
    request.sourceStartSeconds < 0 ||
    request.sourceInSeconds < 0 ||
    request.trimStartSeconds < 0 ||
    request.projectEndSeconds <= request.projectStartSeconds ||
    request.sourceEndSeconds <= request.sourceStartSeconds ||
    request.speed <= 0 ||
    !Number.isInteger(request.sampleRate) ||
    request.sampleRate <= 0 ||
    !Number.isInteger(request.channels) ||
    request.channels <= 0 ||
    (request.trimEndSeconds !== undefined && request.trimEndSeconds <= request.trimStartSeconds)
  ) {
    throw new TypeError('generation-audio-request-invalid');
  }
  assertDurableAudioIdentity(request.projectId);
  assertDurableAudioIdentity(request.mediaId);
  assertDurableAudioIdentity(request.versionId);
  assertDurableAudioIdentity(request.sourceClipId);
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw new DOMException('The operation was aborted.', 'AbortError');
};

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

const mapAudioFailure = (code: GenerationAudioErrorCode, error: unknown): GenerationAudioError => {
  if (error instanceof GenerationAudioError) return error;
  return new GenerationAudioError(code, error instanceof Error ? error.message : String(error), true, { cause: error });
};

const assertDurableAudioIdentity = (value: string): void => {
  if (!value.trim()) throw new TypeError('generation-audio-identity-invalid');
  if (/(?:blob:|local:|file:|data:|signed:|temporary:|https?:\/\/localhost(?::|\/)|^[a-z][a-z\d+.-]*:\/\/)/i.test(value)) {
    throw new TypeError('generation-local-url-forbidden');
  }
};

const assertResolvedSource = (request: Readonly<GenerationAudioRequest>, source: Readonly<GenerationAudioSource>): void => {
  assertDurableAudioIdentity(source.mediaId);
  assertDurableAudioIdentity(source.versionId);
  assertDurableAudioIdentity(source.clipId);
  if (
    source.mediaId !== request.mediaId ||
    source.versionId !== request.versionId ||
    source.clipId !== request.sourceClipId
  ) {
    throw new GenerationAudioError(
      'generation-audio-source-identity-mismatch',
      'Resolved audio source identity does not match the selected linked projection.',
      false,
    );
  }
};

const setAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
};

export function encodePcmS16leWav(samples: Int16Array, sampleRate: number, channels: number): Uint8Array {
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isInteger(channels) ||
    channels <= 0 ||
    samples.length % channels !== 0
  ) {
    throw new TypeError('audio-pcm-invalid');
  }

  const dataLength = samples.length * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);

  setAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  setAscii(view, 8, 'WAVE');
  setAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  setAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
};

export async function prepareGenerationAudio(input: {
  capability: { supportsAudio: boolean };
  request: Readonly<GenerationAudioRequest>;
  extractor: GenerationAudioExtractor;
  cache: GenerationAudioCache;
  signal?: AbortSignal;
}): Promise<PreparedGenerationAudio | undefined> {
  if (!input.capability.supportsAudio) return undefined;

  validateRequest(input.request);
  throwIfAborted(input.signal);

  const cacheKey = buildGenerationAudioCacheKey(input.request);
  const cached = input.cache.get(cacheKey);
  if (cached) return cached;

  let prepared: PreparedGenerationAudio | undefined;
  const abortHandler = (): void => {
    if (prepared && input.cache.get(cacheKey) === prepared) input.cache.delete(cacheKey);
  };

  if (input.signal) input.signal.addEventListener('abort', abortHandler, { once: true });

  let extracted: ExtractedPcm | undefined;
  let operationError: unknown;
  try {
    throwIfAborted(input.signal);
    try {
      extracted = await input.extractor.extract(input.request, input.signal);
    } catch (error) {
      if (isAbortError(error) || error instanceof GenerationAudioError || error instanceof GenerationAudioEmptyError) throw error;
      throw mapAudioFailure('generation-audio-extraction-failed', error);
    }
    throwIfAborted(input.signal);

    const sourceClipId = extracted.sourceClipId ?? input.request.sourceClipId;
    if (!sourceClipId) throw new TypeError('generation-audio-source-clip-required');
    assertDurableAudioIdentity(sourceClipId);
    if (sourceClipId !== input.request.sourceClipId) {
      throw new GenerationAudioError(
        'generation-audio-source-identity-mismatch',
        'Extracted audio source identity does not match the selected linked projection.',
        false,
      );
    }

    const bytes = encodePcmS16leWav(extracted.samples, input.request.sampleRate, input.request.channels);
    const partial =
      extracted.actualSourceStartSeconds > input.request.sourceStartSeconds ||
      extracted.actualSourceEndSeconds < input.request.sourceEndSeconds;
    prepared = {
      bytes,
      mimeType: 'audio/wav',
      sha256: await sha256(bytes),
      sampleRate: input.request.sampleRate,
      channels: input.request.channels,
      sampleCount: extracted.samples.length / input.request.channels,
      actualSourceStartSeconds: extracted.actualSourceStartSeconds,
      actualSourceEndSeconds: extracted.actualSourceEndSeconds,
      sourceClipId,
      partial,
      ...(partial ? { warning: extracted.warning ?? new GenerationAudioPartialCoverageWarning() } : {}),
      cacheKey,
    };

    input.cache.set(cacheKey, prepared);
    throwIfAborted(input.signal);
  } catch (error) {
    operationError = error;
  } finally {
    if (input.signal) input.signal.removeEventListener('abort', abortHandler);
    if (extracted?.cleanup) {
      try {
        extracted.cleanup();
      } catch (error) {
        if (prepared && input.cache.get(cacheKey) === prepared) input.cache.delete(cacheKey);
        operationError = mapAudioFailure('generation-audio-cleanup-failed', error);
      }
    }
  }

  if (operationError) throw operationError;
  return prepared;
}

export class PcmGenerationAudioExtractor implements GenerationAudioExtractor {
  constructor(
    private readonly sourceResolver: GenerationAudioSourceResolver,
    private readonly decoder: GenerationAudioDecoder,
  ) {}

  async extract(request: Readonly<GenerationAudioRequest>, signal?: AbortSignal): Promise<ExtractedPcm> {
    let source: GenerationAudioSource;
    try {
      throwIfAborted(signal);
      source = await this.sourceResolver.resolve(
        {
          projectId: request.projectId,
          mediaId: request.mediaId,
          versionId: request.versionId,
          clipId: request.sourceClipId,
        },
        signal,
      );
      assertResolvedSource(request, source);
    } catch (error) {
      if (
        isAbortError(error) ||
        error instanceof GenerationAudioError ||
        (error instanceof TypeError && (error.message === 'generation-local-url-forbidden' || error.message === 'generation-audio-identity-invalid'))
      ) throw error;
      throw mapAudioFailure('generation-audio-source-resolve-failed', error);
    }

    let decoded: DecodedPcm;
    try {
      throwIfAborted(signal);
      decoded = await this.decoder.decode(source, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw mapAudioFailure('generation-audio-decode-failed', error);
    }
    try {
      const decodedStart = decoded.startSeconds;
      const decodedEnd = decoded.endSeconds;
      const actualStart = Math.max(request.sourceStartSeconds, decodedStart);
      const actualEnd = Math.min(request.sourceEndSeconds, decodedEnd);
      const partial = actualStart > request.sourceStartSeconds || actualEnd < request.sourceEndSeconds;
      if (
        decoded.channels !== request.channels ||
        decoded.sampleRate !== request.sampleRate ||
        !Number.isFinite(decodedStart) ||
        !Number.isFinite(decodedEnd) ||
        decodedEnd <= decodedStart ||
        actualEnd <= actualStart
      ) {
        throw new GenerationAudioEmptyError();
      }

      const firstFrame = Math.max(0, Math.round((actualStart - decodedStart) * decoded.sampleRate));
      const lastFrame = Math.min(
        decoded.samples.length / decoded.channels,
        Math.round((actualEnd - decodedStart) * decoded.sampleRate),
      );
      if (lastFrame <= firstFrame) throw new GenerationAudioEmptyError();

      return {
        samples: decoded.samples.slice(firstFrame * decoded.channels, lastFrame * decoded.channels),
        actualSourceStartSeconds: decodedStart + firstFrame / decoded.sampleRate,
        actualSourceEndSeconds: decodedStart + lastFrame / decoded.sampleRate,
        sourceClipId: source.clipId,
        ...(partial ? { warning: new GenerationAudioPartialCoverageWarning() } : {}),
        cleanup: decoded.cleanup,
      };
    } catch (error) {
      try {
        decoded?.cleanup?.();
      } catch (cleanupError) {
        throw mapAudioFailure('generation-audio-cleanup-failed', cleanupError);
      }
      if (isAbortError(error) || error instanceof GenerationAudioError || error instanceof GenerationAudioEmptyError) throw error;
      throw mapAudioFailure('generation-audio-decode-failed', error);
    }
  }
}

export async function prepareAndLeaseGenerationAudio(input: {
  capability: { supportsAudio: boolean };
  request: Readonly<GenerationAudioRequest>;
  extractor?: GenerationAudioExtractor;
  sourceResolver?: GenerationAudioSourceResolver;
  decoder?: GenerationAudioDecoder;
  cache: GenerationAudioCache;
  lease: GenerationAudioLeasePort;
  signal?: AbortSignal;
  onReleaseError?: (error: GenerationAudioLeaseReleaseError) => void;
}): Promise<PreparedGenerationAudioHandoff | undefined> {
  if (!input.capability.supportsAudio) return undefined;

  let extractor = input.extractor;
  if (!extractor) {
    if (!input.sourceResolver || !input.decoder) {
      throw new GenerationAudioError(
        'generation-audio-configuration-invalid',
        'Audio source resolver and decoder are required when no extractor is supplied.',
        false,
      );
    }
    extractor = new PcmGenerationAudioExtractor(input.sourceResolver, input.decoder);
  }
  const prepared = await prepareGenerationAudio({
    capability: input.capability,
    request: input.request,
    extractor,
    cache: input.cache,
    signal: input.signal,
  });
  if (!prepared) return undefined;

  const sourceClipId = prepared.sourceClipId ?? input.request.sourceClipId;
  if (!sourceClipId) throw new TypeError('generation-audio-source-clip-required');
  const provenance: GenerationAudioProvenance = {
    sourceMediaId: input.request.mediaId,
    sourceVersionId: input.request.versionId,
    sourceClipId,
    requestedProjectRange: {
      startSeconds: input.request.projectStartSeconds,
      endSeconds: input.request.projectEndSeconds,
    },
    requestedSourceRange: {
      startSeconds: input.request.sourceStartSeconds,
      endSeconds: input.request.sourceEndSeconds,
    },
    actualSourceRange: {
      startSeconds: prepared.actualSourceStartSeconds,
      endSeconds: prepared.actualSourceEndSeconds,
    },
    format: input.request.format,
    byteLength: prepared.bytes.byteLength,
    sha256: prepared.sha256,
  };
  const reportReleaseError = (error: unknown): GenerationAudioLeaseReleaseError => {
    const mapped = error instanceof GenerationAudioLeaseReleaseError ? error : new GenerationAudioLeaseReleaseError(error);
    try {
      input.onReleaseError?.(mapped);
    } catch {
      // Observers are diagnostics only; the typed release error remains the operation result.
    }
    return mapped;
  };
  const releaseLease = async (leaseId: string): Promise<void> => {
    try {
      await input.lease.release({ leaseId });
    } catch (error) {
      throw reportReleaseError(error);
    }
  };

  const signal = input.signal;
  throwIfAborted(signal);
  let uploaded: { leaseId: string };
  let rejectAbort: ((reason: DOMException) => void) | undefined;
  const onAbort = (): void => rejectAbort?.(new DOMException('The operation was aborted.', 'AbortError'));
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        rejectAbort = reject;
        signal.addEventListener('abort', onAbort, { once: true });
      })
    : undefined;
  let uploadPromise: Promise<{ leaseId: string }>;
  try {
    uploadPromise = Promise.resolve(input.lease.upload(
      { bytes: prepared.bytes, mimeType: prepared.mimeType, provenance },
      signal,
    ));
  } catch (error) {
    if (signal) signal.removeEventListener('abort', onAbort);
    throw mapAudioFailure('generation-audio-upload-failed', error);
  }
  if (signal && aborted) {
    try {
      uploaded = await Promise.race([uploadPromise, aborted]);
    } catch (error) {
      if (isAbortError(error)) {
        void uploadPromise.then(
          async (lateUpload) => {
            try {
              await releaseLease(lateUpload.leaseId);
            } catch {
              // releaseLease reports the stable error to the observer.
            }
          },
          () => undefined,
        );
      }
      if (isAbortError(error)) throw error;
      throw mapAudioFailure('generation-audio-upload-failed', error);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  } else {
    try {
      uploaded = await uploadPromise;
    } catch (error) {
      throw mapAudioFailure('generation-audio-upload-failed', error);
    }
  }

  let releasePromise: Promise<void> | undefined;
  const release = (): Promise<void> => {
    releasePromise ??= releaseLease(uploaded.leaseId);
    return releasePromise;
  };
  if (signal) {
    signal.addEventListener('abort', () => {
      void release().catch(() => undefined);
    }, { once: true });
    if (signal.aborted) {
      await release();
      throwIfAborted(signal);
    }
  }
  return { ...prepared, uploadLeaseId: uploaded.leaseId, provenance, release };
}
