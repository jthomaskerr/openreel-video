import { describe, expect, it } from 'vitest';
import { projectRangeToAudioSourceRange, resolveCharacterTokens, resolveGenerationReferences, resolveGenerationTiming, resolveMainAudioSource, tokenizeCharacterMentions, type AudioClip, type GenerationTiming } from '.';

describe('resolveGenerationTiming', () => {
  it.each([
    ['timeline wins', { linkedClip: { startSeconds: 0, endSeconds: 4 }, shot: { startSeconds: 2, endSeconds: 3 } }, 'timeline', 4],
    ['shot fallback', { shot: { startSeconds: 2, endSeconds: 5 } }, 'shot', 3],
    ['manual fallback', { manualRange: { startSeconds: 0, endSeconds: 2 } }, 'manual', 2],
  ] as const)('%s', (_name, input, source, duration) => expect(resolveGenerationTiming(input).timing).toMatchObject({ source, durationSeconds: duration }));
  it.each([
    [{ manualRange: { startSeconds: 1 } }, 'timing-incomplete'], [{ manualRange: { startSeconds: -1, endSeconds: 2 } }, 'timing-invalid'],
    [{ manualRange: { startSeconds: 2, endSeconds: 2 } }, 'timing-invalid'], [{ shot: { startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY } }, 'timing-invalid'],
  ] as const)('rejects invalid ranges', (input, code) => expect(resolveGenerationTiming(input).errors[0].code).toBe(code));
});

it('tokenizes exact spans, punctuation, repeats, and first mention order', () => {
  const result = tokenizeCharacterMentions('Hi, @Alice! @bob and @alice; email x@nope.test');
  expect(result.slugs).toEqual(['alice', 'bob']);
  expect(result.mentions.map(item => [item.text, item.start, item.end])).toEqual([['@Alice', 4, 10], ['@bob', 12, 16], ['@alice', 21, 27]]);
});

describe('character resolution', () => {
  const media = [{ mediaId: 'm1', versionId: 'v1', accessible: true }];
  it('uses exact slug, not display name, and retains stable prior binding after rename', () => {
    const characters = [{ id: 'c1', slug: 'renamed-slug', displayName: 'Alice', primaryImageMediaId: 'm1', primaryImageVersionId: 'v1' }];
    expect(resolveCharacterTokens({ tokens: ['old-slug'], characters, mediaVersions: media, priorBindings: [{ slug: 'old-slug', characterId: 'c1', mediaId: 'm1', versionId: 'v1' }] }).bindings[0].characterId).toBe('c1');
    expect(resolveCharacterTokens({ tokens: ['alice'], characters, mediaVersions: media }).errors[0].code).toBe('unresolved-token');
  });
  it.each([
    ['duplicate', [{ id: '1', slug: 'x', displayName: 'X', primaryImageMediaId: 'm1' }, { id: '2', slug: 'x', displayName: 'X2', primaryImageMediaId: 'm1' }], 'ambiguous-token'],
    ['missing', [{ id: '1', slug: 'x', displayName: 'X' }], 'missing-primary-image'],
    ['inaccessible', [{ id: '1', slug: 'x', displayName: 'X', primaryImageMediaId: 'bad' }], 'inaccessible-primary-image'],
  ] as const)('%s image error', (_name, characters, code) => expect(resolveCharacterTokens({ tokens: ['x'], characters, mediaVersions: media }).errors[0].code).toBe(code));
});

it('orders and deduplicates references by media and version while accumulating origins', () => {
  const ref = (mediaId: string, versionId?: string, included?: boolean) => ({ mediaId, versionId, accessible: true, included });
  const result = resolveGenerationReferences({ source: ref('a', '1'), characters: [ref('a', '1'), ref('a', '2')], shotReferences: [ref('b'), ref('excluded', undefined, false)], userReferences: [ref('b')] });
  expect(result.map(item => `${item.mediaId}:${item.versionId ?? ''}`)).toEqual(['a:1', 'a:2', 'b:']);
  expect(result[0].origins).toEqual(['source', 'character']); expect(result[2].origins).toEqual(['shot', 'user']);
});

describe('audio range conversion', () => {
  const timing: GenerationTiming = { source: 'timeline', startSeconds: 2, endSeconds: 6, durationSeconds: 4 };
  const clip = (speed: number): AudioClip => ({ id: 'c', mediaId: 'm', role: 'music', startSeconds: 0, endSeconds: 10, sourceInSeconds: 3, trimStartSeconds: 1, speed });
  it.each([[0.5, 5, 7], [1, 6, 10], [2, 8, 16]] as const)('converts speed %s', (speed, start, end) => expect(projectRangeToAudioSourceRange({ timing, clip: clip(speed) })).toMatchObject({ sourceStartSeconds: start, sourceEndSeconds: end, partial: false }));
  it('handles partial overlap and trim end', () => expect(projectRangeToAudioSourceRange({ timing, clip: { ...clip(1), startSeconds: 4, trimEndSeconds: 5 } })).toEqual({ projectStartSeconds: 4, projectEndSeconds: 5, sourceStartSeconds: 4, sourceEndSeconds: 5, partial: true }));
  it('rejects empty overlap', () => expect(projectRangeToAudioSourceRange({ timing, clip: { ...clip(1), startSeconds: 8, endSeconds: 10 } })).toBeUndefined());
});

describe('audio selection', () => {
  const timing: GenerationTiming = { source: 'shot', startSeconds: 0, endSeconds: 4, durationSeconds: 4 };
  const clip = (id: string, mediaId: string, extra = {}): AudioClip => ({ id, mediaId, role: 'music', startSeconds: 0, endSeconds: 5, speed: 1, ...extra });
  const media = [{ id: 'm1', accessible: true, hasAudio: true }, { id: 'm2', accessible: true, hasAudio: true }];
  it('uses explicit project media then linked clip', () => {
    const clips = [clip('c1', 'm1'), clip('c2', 'm2')];
    expect(resolveMainAudioSource({ projectAudioId: 'm2', clips, media, timing }).source?.clip.id).toBe('c2');
    expect(resolveMainAudioSource({ linkedMainAudioClipId: 'c1', clips, media, timing }).source?.clip.id).toBe('c1');
  });
  it('selects one full candidate, excludes ineligible roles, and never guesses ambiguity', () => {
    expect(resolveMainAudioSource({ clips: [clip('c1', 'm1'), clip('n', 'm2', { role: 'narration' })], media, timing }).source?.clip.id).toBe('c1');
    expect(resolveMainAudioSource({ clips: [clip('c1', 'm1'), clip('c2', 'm2')], media, timing }).errors[0].code).toBe('audio-ambiguous');
  });
  it('reports partial coverage for explicit audio and no coverage when disjoint', () => {
    expect(resolveMainAudioSource({ projectAudioId: 'm1', clips: [clip('c1', 'm1', { startSeconds: 2 })], media, timing }).warnings[0].code).toBe('audio-partial-coverage');
    expect(resolveMainAudioSource({ projectAudioId: 'm1', clips: [clip('c1', 'm1', { startSeconds: 8, endSeconds: 9 })], media, timing }).errors[0].code).toBe('audio-no-coverage');
  });
});
