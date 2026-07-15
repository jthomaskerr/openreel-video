export type GenerationAudioFormat = 'pcm-s16le-wav';

export interface GenerationAudioRequest {
  projectId: string;
  mediaId: string;
  versionId: string;
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
  cleanup?: () => void;
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
  partial: boolean;
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
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw new DOMException('The operation was aborted.', 'AbortError');
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
  try {
    throwIfAborted(input.signal);
    extracted = await input.extractor.extract(input.request, input.signal);
    throwIfAborted(input.signal);

    const bytes = encodePcmS16leWav(extracted.samples, input.request.sampleRate, input.request.channels);
    prepared = {
      bytes,
      mimeType: 'audio/wav',
      sha256: await sha256(bytes),
      sampleRate: input.request.sampleRate,
      channels: input.request.channels,
      sampleCount: extracted.samples.length / input.request.channels,
      actualSourceStartSeconds: extracted.actualSourceStartSeconds,
      actualSourceEndSeconds: extracted.actualSourceEndSeconds,
      partial:
        extracted.actualSourceStartSeconds > input.request.sourceStartSeconds ||
        extracted.actualSourceEndSeconds < input.request.sourceEndSeconds,
      cacheKey,
    };

    input.cache.set(cacheKey, prepared);
    throwIfAborted(input.signal);
    return prepared;
  } finally {
    if (input.signal) input.signal.removeEventListener('abort', abortHandler);
    extracted?.cleanup?.();
  }
}
