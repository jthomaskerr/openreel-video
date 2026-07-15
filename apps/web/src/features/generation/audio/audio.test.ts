import { describe, expect, it, vi } from 'vitest';
import {
  buildGenerationAudioCacheKey,
  encodePcmS16leWav,
  MemoryGenerationAudioCache,
  prepareGenerationAudio,
  type GenerationAudioExtractor,
  type GenerationAudioRequest,
} from '.';

const request: GenerationAudioRequest = {
  projectId: 'project-1',
  mediaId: 'media-1',
  versionId: 'version-1',
  projectStartSeconds: 0,
  projectEndSeconds: 1,
  sourceStartSeconds: 2,
  sourceEndSeconds: 3,
  sourceInSeconds: 1,
  trimStartSeconds: 0.25,
  trimEndSeconds: 8,
  speed: 1,
  sampleRate: 8000,
  channels: 1,
  format: 'pcm-s16le-wav',
};

const readAscii = (bytes: Uint8Array, start: number, length: number): string => String.fromCharCode(...bytes.slice(start, start + length));

describe('encodePcmS16leWav', () => {
  it('emits a fixed little-endian WAV header and PCM payload', () => {
    const bytes = encodePcmS16leWav(new Int16Array([-32768, -1, 0, 1, 32767]), 8000, 1);
    const view = new DataView(bytes.buffer);

    expect(readAscii(bytes, 0, 4)).toBe('RIFF');
    expect(readAscii(bytes, 8, 4)).toBe('WAVE');
    expect(readAscii(bytes, 12, 4)).toBe('fmt ');
    expect(readAscii(bytes, 36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(46);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(10);
    expect(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([-32768, -1, 0, 1, 32767]);
  });

  it.each([
    ['sample rate', 0, 1],
    ['channels', 8000, 2],
  ] as const)('rejects malformed PCM shape when %s changes the layout', (_label, sampleRate, channels) => {
    expect(() => encodePcmS16leWav(new Int16Array(3), sampleRate, channels)).toThrow('audio-pcm-invalid');
  });
});

describe('buildGenerationAudioCacheKey', () => {
  it.each([
    ['projectId', 'project-2'],
    ['mediaId', 'media-2'],
    ['versionId', 'version-2'],
    ['projectStartSeconds', 0.1],
    ['projectEndSeconds', 1.1],
    ['sourceStartSeconds', 2.1],
    ['sourceEndSeconds', 3.1],
    ['sourceInSeconds', 1.1],
    ['trimStartSeconds', 0.5],
    ['trimEndSeconds', 9],
    ['speed', 2],
    ['sampleRate', 16000],
    ['channels', 2],
  ] as const)('invalidates the key when %s changes', (field, value) => {
    expect(buildGenerationAudioCacheKey({ ...request, [field]: value })).not.toBe(buildGenerationAudioCacheKey(request));
  });

  it('rejects non-finite cache key values', () => {
    expect(() => buildGenerationAudioCacheKey({ ...request, speed: Number.NaN })).toThrow('audio-cache-key-invalid-number');
  });
});

describe('prepareGenerationAudio', () => {
  it('returns bytes, stable SHA-256 evidence, and the exact cache key for a fixed impulse', async () => {
    const extractor: GenerationAudioExtractor = {
      extract: vi.fn(async () => ({
        samples: new Int16Array([0, 32767, 0]),
        actualSourceStartSeconds: 2,
        actualSourceEndSeconds: 2.000375,
      })),
    };

    const result = await prepareGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor,
      cache: new MemoryGenerationAudioCache(),
    });

    expect(result).toMatchObject({
      mimeType: 'audio/wav',
      sampleCount: 3,
      actualSourceStartSeconds: 2,
      actualSourceEndSeconds: 2.000375,
      partial: true,
      cacheKey: buildGenerationAudioCacheKey(request),
    });
    expect(result?.sha256).toBe('2bec5254c56431eddb39f8c8bc25c9bafd370b76dca0d8b3ba6f9b089630842f');
  });

  it('reuses the cache without extracting twice', async () => {
    const extractor: GenerationAudioExtractor = {
      extract: vi.fn(async () => ({
        samples: new Int16Array(8000),
        actualSourceStartSeconds: 2,
        actualSourceEndSeconds: 3,
      })),
    };
    const cache = new MemoryGenerationAudioCache();

    const first = await prepareGenerationAudio({ capability: { supportsAudio: true }, request, extractor, cache });
    const second = await prepareGenerationAudio({ capability: { supportsAudio: true }, request, extractor, cache });

    expect(second).toBe(first);
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });

  it('cleans up the extracted resource and evicts aborted work from the cache', async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const store = new Map<string, ReturnType<MemoryGenerationAudioCache['get']>>();
    const cache = {
      get: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: NonNullable<ReturnType<MemoryGenerationAudioCache['get']>>) => {
        store.set(key, value);
        controller.abort();
      }),
      delete: vi.fn((key: string) => {
        store.delete(key);
      }),
    };
    const extractor: GenerationAudioExtractor = {
      extract: vi.fn(async () => ({
        samples: new Int16Array([1, 2, 3, 4]),
        actualSourceStartSeconds: 2,
        actualSourceEndSeconds: 2.0005,
        cleanup,
      })),
    };

    await expect(
      prepareGenerationAudio({
        capability: { supportsAudio: true },
        request,
        extractor,
        cache,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cache.delete).toHaveBeenCalledWith(buildGenerationAudioCacheKey(request));
    expect(cache.get(buildGenerationAudioCacheKey(request))).toBeUndefined();
  });

  it('does zero extraction and cache work for a model without audio support', async () => {
    const extractor: GenerationAudioExtractor = {
      extract: vi.fn(),
    };
    const cache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };

    await expect(
      prepareGenerationAudio({
        capability: { supportsAudio: false },
        request,
        extractor,
        cache,
      }),
    ).resolves.toBeUndefined();

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('rejects invalid source ranges before invoking the adapter', async () => {
    const extractor: GenerationAudioExtractor = {
      extract: vi.fn(),
    };

    await expect(
      prepareGenerationAudio({
        capability: { supportsAudio: true },
        request: { ...request, sourceEndSeconds: 2 },
        extractor,
        cache: new MemoryGenerationAudioCache(),
      }),
    ).rejects.toThrow('generation-audio-request-invalid');

    expect(extractor.extract).not.toHaveBeenCalled();
  });
});
