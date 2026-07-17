import { describe, expect, it } from 'vitest';
import { canonicalCharacterToken } from '../references/resolve';
import {
  projectRangeToAudioSourceRange,
  resolveCharacterTokens,
  resolveGenerationReferences,
  resolveGenerationTiming,
  resolveMainAudioSource,
  tokenizeCharacterMentions,
  type AudioClip,
  type GenerationTiming,
} from '.';

describe('resolveGenerationTiming', () => {
  it.each([
    ['timeline wins', { linkedClip: { startSeconds: 0, endSeconds: 4 }, shot: { startSeconds: 2, endSeconds: 3 } }, 'timeline', 4],
    ['shot fallback', { shot: { startSeconds: 2, endSeconds: 5 } }, 'shot', 3],
    ['manual fallback', { manualRange: { startSeconds: 0, endSeconds: 2 } }, 'manual', 2],
  ])('%s', (_name, input, source, duration) => {
    expect(resolveGenerationTiming(input).timing).toMatchObject({ source, durationSeconds: duration });
  });

  it.each([
    [{ manualRange: { startSeconds: 1 } }, 'timing-incomplete'],
    [{ manualRange: { startSeconds: -1, endSeconds: 2 } }, 'timing-invalid'],
    [{ manualRange: { startSeconds: 2, endSeconds: 2 } }, 'timing-invalid'],
    [{ shot: { startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY } }, 'timing-invalid'],
  ])('rejects invalid ranges', (input, code) => {
    expect(resolveGenerationTiming(input).errors[0].code).toBe(code);
  });
});

describe('tokenizeCharacterMentions', () => {
  it('tokenizes exact spans, punctuation, repeats, and first mention order', () => {
    const result = tokenizeCharacterMentions('Hi, @Alice! @bob and @alice; email x@nope.test');

    expect(result.slugs).toEqual(['alice', 'bob']);
    expect(result.mentions.map(item => [item.text, item.start, item.end])).toEqual([
      ['@Alice', 4, 10],
      ['@bob', 12, 16],
      ['@alice', 21, 27],
    ]);
  });

  it('keeps legacy prompt tokens out of character mentions', () => {
    const result = tokenizeCharacterMentions(
      'Lead with @Alice, ignore @{character:char-1} and @{media:mv-2}.',
    );

    expect(result).toEqual({
      mentions: [{ text: '@Alice', slug: 'alice', start: 10, end: 16 }],
      slugs: ['alice'],
    });
  });
});

describe('resolveCharacterTokens', () => {
  it('resolves canonical character tokens through the compatibility wrapper', () => {
    expect(
      resolveCharacterTokens({
        tokens: [canonicalCharacterToken('c1')],
        characters: [
          {
            id: 'c1',
            slug: 'renamed-slug',
            displayName: 'Alice',
            primaryImageMediaId: 'm1',
            primaryImageVersionId: 'v1',
          },
        ],
        mediaVersions: [{ mediaId: 'm1', versionId: 'v1', accessible: true }],
      }).bindings,
    ).toEqual([
      {
        slug: 'renamed-slug',
        characterId: 'c1',
        mediaId: 'm1',
        versionId: 'v1',
      },
    ]);
  });

  it('keeps legacy mention wrapper focused on prior bindings', () => {
    expect(
      resolveCharacterTokens({
        tokens: ['@old-slug'],
        characters: [
          {
            id: 'c1',
            slug: 'renamed-slug',
            displayName: 'Alice',
            primaryImageMediaId: 'm1',
            primaryImageVersionId: 'v1',
          },
        ],
        mediaVersions: [{ mediaId: 'm1', versionId: 'v1', accessible: true }],
        priorBindings: [{ slug: 'old-slug', characterId: 'c1', mediaId: 'm1', versionId: 'v1' }],
      }).bindings[0].characterId,
    ).toBe('c1');
  });

  it('reports unresolved and ambiguous tokens', () => {
    expect(
      resolveCharacterTokens({
        tokens: ['x'],
        characters: [],
        mediaVersions: [],
      }).errors[0].code,
    ).toBe('unresolved-token');

    expect(
      resolveCharacterTokens({
        tokens: ['x'],
        characters: [
          { id: '1', slug: 'x', displayName: 'One', primaryImageMediaId: 'm', primaryImageVersionId: 'v' },
          { id: '2', slug: 'x', displayName: 'Two', primaryImageMediaId: 'm', primaryImageVersionId: 'v' },
        ],
        mediaVersions: [{ mediaId: 'm', versionId: 'v', accessible: true }],
      }).errors[0].code,
    ).toBe('ambiguous-token');
  });

  it.each([
    [
      [{ id: '1', slug: 'x', displayName: 'One', primaryImageVersionId: 'v' }],
      'missing-primary-image',
    ],
    [
      [{ id: '1', slug: 'x', displayName: 'One', primaryImageMediaId: 'm', primaryImageVersionId: 'v' }],
      'inaccessible-primary-image',
    ],
  ])('reports %s image errors', (characters, code) => {
    const mediaVersions = [{ mediaId: 'm', versionId: 'v', accessible: false }];

    expect(
      resolveCharacterTokens({
        tokens: ['x'],
        characters,
        mediaVersions,
      }).errors[0].code,
    ).toBe(code);
  });
});

describe('resolveGenerationReferences', () => {
  it('orders and deduplicates references by media version while accumulating origins', () => {
    const ref = (mediaId: string, versionId?: string, included?: boolean) => ({
      mediaId,
      versionId,
      accessible: true,
      included,
    });

    const result = resolveGenerationReferences({
      source: ref('a', '1'),
      characters: [ref('a', '1'), ref('a', '2')],
      shotReferences: [ref('b'), ref('excluded', undefined, false)],
      userReferences: [ref('b')],
    });

    expect(result.map(item => `${item.mediaId}:${item.versionId ?? ''}`)).toEqual(['a:1', 'a:2', 'b:']);
    expect(result[0].origins).toEqual(['source', 'character']);
    expect(result[2].origins).toEqual(['shot', 'user']);
  });
});

describe('audio range conversion', () => {
  const timing: GenerationTiming = { source: 'timeline', startSeconds: 2, endSeconds: 6, durationSeconds: 4 };
  const clip = (speed: number): AudioClip => ({
    id: 'c',
    mediaId: 'm',
    role: 'music',
    startSeconds: 0,
    endSeconds: 10,
    sourceInSeconds: 3,
    trimStartSeconds: 1,
    speed,
  });

  it.each([
    [0.5, 5, 7],
    [1, 6, 10],
    [2, 8, 16],
  ])('converts speed %s', (speed, start, end) => {
    expect(projectRangeToAudioSourceRange({ timing, clip: clip(speed) })).toMatchObject({
      sourceStartSeconds: start,
      sourceEndSeconds: end,
      partial: false,
    });
  });

  it('handles partial overlap trim end', () => {
    expect(projectRangeToAudioSourceRange({ timing, clip: { ...clip(1), startSeconds: 4, trimEndSeconds: 5 } })).toEqual({
      projectStartSeconds: 4,
      projectEndSeconds: 5,
      sourceStartSeconds: 4,
      sourceEndSeconds: 5,
      partial: true,
    });
  });

  it('rejects empty overlap', () => {
    expect(projectRangeToAudioSourceRange({ timing, clip: { ...clip(1), startSeconds: 8, endSeconds: 10 } })).toBeUndefined();
  });

  it('selects main audio or reports ambiguity and coverage gaps', () => {
    const media = [
      { id: 'm1', versionId: 'v1', accessible: true, hasAudio: true },
      { id: 'm2', versionId: 'v2', accessible: true, hasAudio: true },
    ];

    expect(
      resolveMainAudioSource({
        clips: [{ ...clip(1), mediaId: 'm1' }, { ...clip(1), id: 'c2', mediaId: 'm2' }],
        media,
        timing,
      }).errors[0].code,
    ).toBe('audio-ambiguous');

    expect(
      resolveMainAudioSource({
        linkedMainAudioClipId: 'c3',
        clips: [{ ...clip(1), id: 'c3', mediaId: 'm1', startSeconds: 0, endSeconds: 4 }],
        media: [{ id: 'm1', versionId: 'v1', accessible: true, hasAudio: true }],
        timing,
      }).warnings[0].code,
    ).toBe('audio-partial-coverage');

    expect(
      resolveMainAudioSource({
        projectAudioId: 'm1',
        clips: [{ ...clip(1), id: 'c4', mediaId: 'm1', startSeconds: 8, endSeconds: 9 }],
        media: [{ id: 'm1', versionId: 'v1', accessible: true, hasAudio: true }],
        timing,
      }).errors[0].code,
    ).toBe('audio-no-coverage');
  });
});
