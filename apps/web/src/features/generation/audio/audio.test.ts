import { describe, expect, it, vi } from 'vitest';
import { buildGenerationAudioCacheKey, encodePcmS16leWav, MemoryGenerationAudioCache, prepareGenerationAudio, type GenerationAudioRequest, type GenerationAudioExtractor } from '.';

const request: GenerationAudioRequest = {
  projectId: 'project-1', mediaId: 'media-1', versionId: 'version-1', projectStartSeconds: 0,
  projectEndSeconds: 1, sourceStartSeconds: 2, sourceEndSeconds: 3, sourceInSeconds: 1,
  trimStartSeconds: 0.25, trimEndSeconds: 8, speed: 1, sampleRate: 8000, channels: 1, format: 'pcm-s16le-wav',
};

const readAscii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));

it('encodes a deterministic PCM ramp with a valid WAV header and sample count', () => {
  const bytes = encodePcmS16leWav(new Int16Array([-32768, -1, 0, 1, 32767]), 8000, 1);
  const view = new DataView(bytes.buffer);
  expect(readAscii(bytes, 0, 4)).toBe('RIFF'); expect(readAscii(bytes, 8, 4)).toBe('WAVE');
  expect(readAscii(bytes, 36, 4)).toBe('data'); expect(view.getUint32(40, true)).toBe(10);
  expect(view.getUint32(24, true)).toBe(8000); expect(view.getUint16(22, true)).toBe(1);
  expect(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([-32768, -1, 0, 1, 32767]);
});

it('prepares bytes, stable hash, and exact actual range from a fixed impulse', async () => {
  const extractor: GenerationAudioExtractor = { extract: vi.fn(async () => ({ samples: new Int16Array([0, 32767, 0]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 2.000375 })) };
  const result = await prepareGenerationAudio({ capability: { supportsAudio: true }, request, extractor, cache: new MemoryGenerationAudioCache() });
  expect(result).toMatchObject({ mimeType: 'audio/wav', sampleCount: 3, actualSourceStartSeconds: 2, actualSourceEndSeconds: 2.000375, partial: true });
  expect(result?.sha256).toBe('2bec5254c56431eddb39f8c8bc25c9bafd370b76dca0d8b3ba6f9b089630842f');
});

it('reuses the cache without extracting twice', async () => {
  const extractor: GenerationAudioExtractor = { extract: vi.fn(async () => ({ samples: new Int16Array(8000), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3 })) };
  const cache = new MemoryGenerationAudioCache();
  const first = await prepareGenerationAudio({ capability: { supportsAudio: true }, request, extractor, cache });
  const second = await prepareGenerationAudio({ capability: { supportsAudio: true }, request, extractor, cache });
  expect(second).toBe(first); expect(extractor.extract).toHaveBeenCalledTimes(1);
});

it.each([
  ['projectId', 'project-2'], ['mediaId', 'media-2'], ['versionId', 'version-2'], ['projectStartSeconds', 0.1],
  ['projectEndSeconds', 1.1], ['sourceStartSeconds', 2.1], ['sourceEndSeconds', 3.1], ['sourceInSeconds', 1.1],
  ['trimStartSeconds', 0.5], ['trimEndSeconds', 9], ['speed', 2], ['sampleRate', 16000], ['channels', 2],
] as const)('invalidates the key when %s changes', (field, value) => {
  expect(buildGenerationAudioCacheKey({ ...request, [field]: value })).not.toBe(buildGenerationAudioCacheKey(request));
});

it('runs cleanup after success and after an abort, and never caches aborted work', async () => {
  const cleanup = vi.fn(); const cache = new MemoryGenerationAudioCache(); const controller = new AbortController();
  const extractor: GenerationAudioExtractor = { extract: vi.fn(async () => { controller.abort(); return { samples: new Int16Array(1), actualSourceStartSeconds: 2, actualSourceEndSeconds: 2.1, cleanup }; }) };
  await expect(prepareGenerationAudio({ capability: { supportsAudio: true }, request, extractor, cache, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(cleanup).toHaveBeenCalledOnce(); expect(cache.get(buildGenerationAudioCacheKey(request))).toBeUndefined();
});

it('does zero extraction and cache work for a model without audio support', async () => {
  const extractor: GenerationAudioExtractor = { extract: vi.fn() }; const cache = { get: vi.fn(), set: vi.fn() };
  await expect(prepareGenerationAudio({ capability: { supportsAudio: false }, request, extractor, cache })).resolves.toBeUndefined();
  expect(extractor.extract).not.toHaveBeenCalled(); expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
});

describe('input validation', () => {
  it('rejects non-finite cache key values', () => expect(() => buildGenerationAudioCacheKey({ ...request, speed: Number.NaN })).toThrow('audio-cache-key-invalid-number'));
  it('rejects malformed PCM shape', () => expect(() => encodePcmS16leWav(new Int16Array(3), 8000, 2)).toThrow('audio-pcm-invalid'));
  it('rejects an invalid source range before invoking the adapter', async () => {
    const extractor: GenerationAudioExtractor = { extract: vi.fn() };
    await expect(prepareGenerationAudio({ capability: { supportsAudio: true }, request: { ...request, sourceEndSeconds: 2 }, extractor, cache: new MemoryGenerationAudioCache() })).rejects.toThrow('generation-audio-request-invalid');
    expect(extractor.extract).not.toHaveBeenCalled();
  });
});
