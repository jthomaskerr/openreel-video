import { describe, expect, it, vi } from 'vitest';
import {
  buildGenerationAudioCacheKey,
  encodePcmS16leWav,
  MemoryGenerationAudioCache,
  prepareGenerationAudio,
  type GenerationAudioExtractor,
  type GenerationAudioRequest,
} from '.';
import {
  GenerationAudioEmptyError,
  GenerationAudioLeaseReleaseError,
  GenerationAudioPartialCoverageWarning,
  PcmGenerationAudioExtractor,
  prepareAndLeaseGenerationAudio,
  type GenerationAudioDecoder,
  type GenerationAudioLeasePort,
  type GenerationAudioSourceResolver,
} from '.';

const request: GenerationAudioRequest = {
  projectId: 'project-1',
  mediaId: 'media-1',
  versionId: 'version-1',
  sourceClipId: 'audio-clip',
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

  it('invalidates the key when the linked source clip changes', () => {
    expect(buildGenerationAudioCacheKey({ ...request, sourceClipId: 'audio-clip-2' })).not.toBe(buildGenerationAudioCacheKey(request));
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

  it('derives the partial warning from measured actual ranges', async () => {
    const result = await prepareGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn(async () => ({
        samples: new Int16Array([1]),
        actualSourceStartSeconds: 2.25,
        actualSourceEndSeconds: 2.75,
      })) },
      cache: new MemoryGenerationAudioCache(),
    });

    expect(result?.warning).toBeInstanceOf(GenerationAudioPartialCoverageWarning);
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

describe('PcmGenerationAudioExtractor', () => {
  it('resolves and decodes the exact requested source range', async () => {
    const resolver: GenerationAudioSourceResolver = {
      resolve: vi.fn(async () => ({
        mediaId: request.mediaId,
        versionId: request.versionId,
        clipId: 'audio-clip',
        bytes: new Uint8Array([1, 2, 3]),
      })),
    };
    const decoder: GenerationAudioDecoder = {
      decode: vi.fn(async () => ({
        samples: new Int16Array([10, 20, 30, 40]),
        sampleRate: 2,
        channels: 1,
        startSeconds: 2,
        endSeconds: 4,
      })),
    };

    const result = await new PcmGenerationAudioExtractor(resolver, decoder).extract({
      ...request,
      sourceStartSeconds: 2.5,
      sourceEndSeconds: 3.5,
      sampleRate: 2,
    });

    expect(result.samples).toEqual(new Int16Array([20, 30]));
    expect(result.sourceClipId).toBe('audio-clip');
    expect(result.actualSourceStartSeconds).toBe(2.5);
    expect(result.actualSourceEndSeconds).toBe(3.5);
    expect(resolver.resolve).toHaveBeenCalledWith({
      projectId: request.projectId,
      mediaId: request.mediaId,
      versionId: request.versionId,
      clipId: 'audio-clip',
    }, undefined);
    expect(decoder.decode).toHaveBeenCalledWith({
      mediaId: request.mediaId,
      versionId: request.versionId,
      clipId: 'audio-clip',
      bytes: new Uint8Array([1, 2, 3]),
    }, undefined);
  });

  it('returns partial coverage and rejects an empty intersection with stable errors', async () => {
    const resolver: GenerationAudioSourceResolver = {
      resolve: vi.fn(async () => ({ mediaId: request.mediaId, versionId: request.versionId, clipId: 'audio-clip', bytes: new Uint8Array([1]) })),
    };
    const decoder: GenerationAudioDecoder = {
      decode: vi.fn(async () => ({ samples: new Int16Array([10, 20]), sampleRate: 1, channels: 1, startSeconds: 2, endSeconds: 4 })),
    };
    const extractor = new PcmGenerationAudioExtractor(resolver, decoder);

    await expect(extractor.extract({ ...request, sourceStartSeconds: 1, sourceEndSeconds: 3, sampleRate: 1 })).resolves.toMatchObject({
      actualSourceStartSeconds: 2,
      actualSourceEndSeconds: 3,
      warning: expect.any(GenerationAudioPartialCoverageWarning),
    });
    await expect(extractor.extract({ ...request, sourceStartSeconds: 5, sourceEndSeconds: 6, sampleRate: 1 })).rejects.toBeInstanceOf(GenerationAudioEmptyError);
  });

  it('maps resolver, decoder, and extraction failures while preserving abort', async () => {
    const resolverFailure = new PcmGenerationAudioExtractor(
      { resolve: vi.fn().mockRejectedValue(new Error('resolver exploded')) },
      { decode: vi.fn() },
    );
    await expect(resolverFailure.extract(request)).rejects.toMatchObject({ code: 'generation-audio-source-resolve-failed', retryable: true });

    const decoderFailure = new PcmGenerationAudioExtractor(
      { resolve: vi.fn(async () => ({ mediaId: 'media-1', versionId: 'version-1', clipId: 'audio-clip', bytes: new Uint8Array([1]) })) },
      { decode: vi.fn().mockRejectedValue(new Error('decoder exploded')) },
    );
    await expect(decoderFailure.extract(request)).rejects.toMatchObject({ code: 'generation-audio-decode-failed', retryable: true });

    const malformedDecoder = new PcmGenerationAudioExtractor(
      { resolve: vi.fn(async () => ({ mediaId: 'media-1', versionId: 'version-1', clipId: 'audio-clip', bytes: new Uint8Array([1]) })) },
      { decode: vi.fn(async () => undefined as unknown as Awaited<ReturnType<GenerationAudioDecoder['decode']>>) },
    );
    await expect(malformedDecoder.extract(request)).rejects.toMatchObject({ code: 'generation-audio-decode-failed', retryable: true });

    const controller = new AbortController();
    controller.abort();
    await expect(decoderFailure.extract(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    await expect(prepareGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn().mockRejectedValue(new Error('extractor exploded')) },
      cache: new MemoryGenerationAudioCache(),
    })).rejects.toMatchObject({ code: 'generation-audio-extraction-failed', retryable: true });
  });

  it('cleans decoded resources when the decoded range is unusable', async () => {
    const cleanup = vi.fn();
    const extractor = new PcmGenerationAudioExtractor(
      { resolve: vi.fn(async () => ({ mediaId: 'media-1', versionId: 'version-1', clipId: 'audio-clip', bytes: new Uint8Array([1]) })) },
      { decode: vi.fn(async () => ({ samples: new Int16Array([1]), sampleRate: 1, channels: 1, startSeconds: 5, endSeconds: 6, cleanup })) },
    );

    await expect(extractor.extract(request)).rejects.toBeInstanceOf(GenerationAudioEmptyError);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('maps decoder cleanup failures to a stable retryable error', async () => {
    const cleanup = vi.fn(() => { throw new Error('decoder cleanup failed'); });
    const extractor = new PcmGenerationAudioExtractor(
      { resolve: vi.fn(async () => ({ mediaId: 'media-1', versionId: 'version-1', clipId: 'audio-clip', bytes: new Uint8Array([1]) })) },
      { decode: vi.fn(async () => ({ samples: new Int16Array([1]), sampleRate: 1, channels: 1, startSeconds: 5, endSeconds: 6, cleanup })) },
    );

    await expect(extractor.extract(request)).rejects.toMatchObject({ code: 'generation-audio-cleanup-failed', retryable: true });
  });
});

describe('prepareAndLeaseGenerationAudio', () => {
  it('returns an opaque upload handoff with durable provenance and releases only its lease', async () => {
    let uploadedInput: Parameters<GenerationAudioLeasePort['upload']>[0] | undefined;
    const lease: GenerationAudioLeasePort = {
      upload: vi.fn(async (input) => {
        uploadedInput = input;
        return { leaseId: 'lease-audio-1' };
      }),
      release: vi.fn(async () => undefined),
    };
    const result = await prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn(async () => ({ samples: new Int16Array([1, 2]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3 })) },
      cache: new MemoryGenerationAudioCache(),
      lease,
    });

    expect(result).toMatchObject({
      uploadLeaseId: 'lease-audio-1',
      provenance: {
        sourceMediaId: request.mediaId,
        sourceVersionId: request.versionId,
        sourceClipId: 'audio-clip',
        requestedProjectRange: { startSeconds: 0, endSeconds: 1 },
        requestedSourceRange: { startSeconds: 2, endSeconds: 3 },
        actualSourceRange: { startSeconds: 2, endSeconds: 3 },
        format: 'pcm-s16le-wav',
        byteLength: 48,
      },
    });
    expect(result?.provenance).not.toHaveProperty('url');
    expect(result?.provenance.sha256).toBe(result?.sha256);
    expect(uploadedInput?.bytes).toEqual(result?.bytes);
    expect(uploadedInput?.provenance).toEqual(result?.provenance);
    expect(uploadedInput?.provenance.byteLength).toBe(uploadedInput?.bytes.byteLength);
    expect(uploadedInput?.provenance.sha256).toBe(result?.sha256);
    const digest = await crypto.subtle.digest('SHA-256', uploadedInput!.bytes as Uint8Array<ArrayBuffer>);
    expect(uploadedInput?.provenance.sha256).toBe(Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''));

    await result?.release();
    await result?.release();
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledWith({ leaseId: 'lease-audio-1' });
  });

  it('preserves partial coverage as a typed recoverable warning in the handoff', async () => {
    const lease: GenerationAudioLeasePort = {
      upload: vi.fn(async () => ({ leaseId: 'lease-partial' })),
      release: vi.fn(async () => undefined),
    };
    const result = await prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn(async () => ({
        samples: new Int16Array([1]),
        actualSourceStartSeconds: 2.25,
        actualSourceEndSeconds: 2.75,
        warning: new GenerationAudioPartialCoverageWarning(),
      })) },
      cache: new MemoryGenerationAudioCache(),
      lease,
    });

    expect(result?.warning).toBeInstanceOf(GenerationAudioPartialCoverageWarning);
  });

  it('does zero resolver, decoder, cache, upload, and cleanup work when audio is unsupported', async () => {
    const resolver = { resolve: vi.fn() } as unknown as GenerationAudioSourceResolver;
    const decoder = { decode: vi.fn() } as unknown as GenerationAudioDecoder;
    const extractor = { extract: vi.fn() };
    const cache = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
    const lease = { upload: vi.fn(), release: vi.fn() } as unknown as GenerationAudioLeasePort;

    await expect(prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: false },
      request,
      sourceResolver: resolver,
      decoder,
      extractor,
      cache,
      lease,
    })).resolves.toBeUndefined();

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(decoder.decode).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(lease.upload).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it('rejects missing source clip before caching and validates production port configuration', async () => {
    const cache = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
    await expect(prepareGenerationAudio({
      capability: { supportsAudio: true },
      request: { ...request, sourceClipId: undefined },
      extractor: { extract: vi.fn(async () => ({ samples: new Int16Array([1]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3 })) },
      cache,
    })).rejects.toThrow('generation-audio-source-clip-required');
    expect(cache.set).not.toHaveBeenCalled();

    await expect(prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: true },
      request,
      cache: new MemoryGenerationAudioCache(),
      lease: { upload: vi.fn(), release: vi.fn() },
    })).rejects.toMatchObject({ code: 'generation-audio-configuration-invalid', retryable: false });
  });

  it.each([
    ['mediaId', 'blob:media'],
    ['versionId', 'local:version'],
    ['sourceClipId', 'file:clip'],
    ['mediaId', 'data:media'],
    ['versionId', 'signed:version'],
    ['sourceClipId', 'temporary:clip'],
    ['mediaId', 'http://localhost:4040/media'],
  ] as const)('rejects resolved local %s identity before decoding', async (field, invalidValue) => {
    const decoder = { decode: vi.fn() };
    const resolver = {
      resolve: vi.fn(async () => ({
        mediaId: field === 'mediaId' ? invalidValue : 'media-1',
        versionId: field === 'versionId' ? invalidValue : 'version-1',
        clipId: field === 'sourceClipId' ? invalidValue : 'audio-clip',
        bytes: new Uint8Array([1]),
      })),
    };
    await expect(new PcmGenerationAudioExtractor(resolver, decoder).extract(request)).rejects.toThrow('generation-local-url-forbidden');
    expect(decoder.decode).not.toHaveBeenCalled();
  });

  it('does not start upload when cancellation is already requested', async () => {
    const controller = new AbortController();
    controller.abort();
    const upload = vi.fn();
    await expect(prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn(async () => ({ samples: new Int16Array([1]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3 })) },
      cache: new MemoryGenerationAudioCache(),
      lease: { upload, release: vi.fn() },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('releases an upload after cancellation during upload and reports release failure', async () => {
    const controller = new AbortController();
    let resolveUpload!: (value: { leaseId: string }) => void;
    const upload = new Promise<{ leaseId: string }>((resolve) => { resolveUpload = resolve; });
    const onReleaseError = vi.fn();
    const release = vi.fn().mockRejectedValue(new Error('release unavailable'));
    const uploadPort = vi.fn(() => upload);
    const operation = prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn(async () => ({ samples: new Int16Array([1]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3 })) },
      cache: new MemoryGenerationAudioCache(),
      lease: { upload: uploadPort, release },
      signal: controller.signal,
      onReleaseError,
    });
    await vi.waitFor(() => expect(uploadPort).toHaveBeenCalledOnce());
    controller.abort();
    resolveUpload({ leaseId: 'lease-aborted' });

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith({ leaseId: 'lease-aborted' }));
    expect(onReleaseError).toHaveBeenCalledWith(expect.any(GenerationAudioLeaseReleaseError));
  });

  it('cleans extraction resources when upload fails', async () => {
    const cleanup = vi.fn();
    await expect(prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn(async () => ({ samples: new Int16Array([1]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3, cleanup })) },
      cache: new MemoryGenerationAudioCache(),
      lease: { upload: vi.fn().mockRejectedValue(new Error('upload failed')), release: vi.fn() },
    })).rejects.toMatchObject({ code: 'generation-audio-upload-failed', retryable: true });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('maps extractor cleanup failures and evicts the prepared cache value', async () => {
    const cleanup = vi.fn(() => { throw new Error('extractor cleanup failed'); });
    const cache = new MemoryGenerationAudioCache();
    await expect(prepareGenerationAudio({
      capability: { supportsAudio: true },
      request,
      extractor: { extract: vi.fn(async () => ({ samples: new Int16Array([1]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3, cleanup })) },
      cache,
    })).rejects.toMatchObject({ code: 'generation-audio-cleanup-failed', retryable: true });
    expect(cache.get(buildGenerationAudioCacheKey(request))).toBeUndefined();
  });

  it('rejects local source identities before creating a durable upload handoff', async () => {
    const lease: GenerationAudioLeasePort = {
      upload: vi.fn(),
      release: vi.fn(),
    };

    await expect(prepareAndLeaseGenerationAudio({
      capability: { supportsAudio: true },
      request: { ...request, mediaId: 'blob:source' },
      extractor: { extract: vi.fn(async () => ({ samples: new Int16Array([1]), actualSourceStartSeconds: 2, actualSourceEndSeconds: 3 })) },
      cache: new MemoryGenerationAudioCache(),
      lease,
    })).rejects.toThrow('generation-local-url-forbidden');
    expect(lease.upload).not.toHaveBeenCalled();
  });
});
