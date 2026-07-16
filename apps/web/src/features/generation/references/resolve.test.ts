import { describe, expect, it } from 'vitest';
import { canonicalCharacterToken, canonicalMediaToken, resolveGenerationReferences, type ReferenceCandidate } from './resolve';

const makeCandidate = (mediaId: string, mediaVersionId: string, defaultRole: string, canonicalTokens?: readonly string[]): ReferenceCandidate => ({
  mediaId,
  mediaVersionId,
  canonicalTokens: canonicalTokens ?? [canonicalMediaToken(mediaVersionId)],
  defaultRole,
});

describe('resolveGenerationReferences', () => {
  it('orders source first, first prompt mention next, then shot references while merging duplicate media origins', () => {
    const source = makeCandidate('media-source', 'version-source', 'source', ['source:frame']);
    const sharedShot = makeCandidate('media-shared', 'version-shared', 'shot');
    const trailingShot = makeCandidate('media-shot', 'version-shot', 'shot');
    const prompt = `Lead with ${canonicalMediaToken('version-shared')} and keep the rest stable.`;

    const result = resolveGenerationReferences({
      prompt,
      source,
      characters: [],
      mediaVersions: [
        { mediaId: 'media-source', versionId: 'version-source', accessible: true },
        { mediaId: 'media-shared', versionId: 'version-shared', accessible: true },
        { mediaId: 'media-shot', versionId: 'version-shot', accessible: true },
      ],
      shotReferences: [sharedShot, trailingShot],
      roleByReferenceKey: {
        'reference:version-source': 'source-role',
        'reference:version-shared': 'shared-role',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.references.map(reference => reference.key)).toEqual(['reference:version-source', 'reference:version-shared', 'reference:version-shot']);
    expect(result.references[0]).toMatchObject({
      mediaId: 'media-source',
      mediaVersionId: 'version-source',
      origins: ['source'],
      role: 'source-role',
    });
    expect(result.references[1]).toMatchObject({
      mediaId: 'media-shared',
      mediaVersionId: 'version-shared',
      role: 'shared-role',
      origins: ['prompt-media', 'shot'],
    });
  });

  it('resolves typed character ids independently of slug changes and retains legacy bindings', () => {
    const characters = [
      {
        id: 'character-1',
        slug: 'renamed-slug',
        displayName: 'Alice',
        primaryImageMediaId: 'media-character',
        primaryImageVersionId: 'version-character',
      },
    ];

    const legacyBindings = [
      {
        slug: 'alice',
        characterId: 'character-1',
        mediaId: 'media-character',
        versionId: 'version-character',
      },
    ];

    const result = resolveGenerationReferences({
      prompt: `${canonicalCharacterToken('character-1')} @alice`,
      source: undefined,
      characters,
      mediaVersions: [{ mediaId: 'media-character', versionId: 'version-character', accessible: true }],
      shotReferences: [],
      legacyBindings,
      roleByReferenceKey: {
        'reference:version-character': 'hero',
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      key: 'reference:version-character',
      mediaId: 'media-character',
      mediaVersionId: 'version-character',
      role: 'hero',
      origins: ['character'],
      status: 'active',
    });
  });

  it('reports malformed typed tokens and unavailable primary images without falling back to another media version', () => {
    const prompt = '@{character:missing-image} @{character:unavailable} @{character:}';
    const result = resolveGenerationReferences({
      prompt,
      source: undefined,
      characters: [
        { id: 'missing-image', slug: 'missing-image', displayName: 'Missing' },
        {
          id: 'unavailable',
          slug: 'unavailable',
          displayName: 'Unavailable',
          primaryImageMediaId: 'media-unavailable',
          primaryImageVersionId: 'version-unavailable',
        },
      ],
      mediaVersions: [
        { mediaId: 'media-unavailable', versionId: 'version-unavailable', accessible: false },
        { mediaId: 'media-unavailable', versionId: 'version-fallback', accessible: true },
      ],
      shotReferences: [],
      roleByReferenceKey: {},
    });

    expect(result.references).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unavailable', 'unavailable', 'malformed-token']);
    expect(result.diagnostics[0]).toMatchObject({
      start: 0,
      end: '@{character:missing-image}'.length,
      blocking: true,
    });
  });
});
