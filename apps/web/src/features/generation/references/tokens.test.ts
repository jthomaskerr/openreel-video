import { describe, expect, it } from 'vitest';
import { canonicalCharacterToken, canonicalMediaToken, tokenizePromptReferences } from './tokens';

describe('tokenizePromptReferences', () => {
  it('tokenizes typed and legacy references with exact utf-16 spans', () => {
    const prompt = '😀 @{character:char-1}, @{media:mv-2}! @Alice x@nope.test @{character:char-1}';
    const characterToken = '@{character:char-1}';
    const mediaToken = '@{media:mv-2}';
    const legacyToken = '@Alice';

    expect(tokenizePromptReferences(prompt)).toEqual([
      {
        kind: 'character',
        id: 'char-1',
        source: characterToken,
        start: prompt.indexOf(characterToken),
        end: prompt.indexOf(characterToken) + characterToken.length,
        legacy: false,
      },
      {
        kind: 'media',
        id: 'mv-2',
        source: mediaToken,
        start: prompt.indexOf(mediaToken),
        end: prompt.indexOf(mediaToken) + mediaToken.length,
        legacy: false,
      },
      {
        kind: 'legacy-character',
        slug: 'alice',
        source: legacyToken,
        start: prompt.indexOf(legacyToken),
        end: prompt.indexOf(legacyToken) + legacyToken.length,
        legacy: true,
      },
      {
        kind: 'character',
        id: 'char-1',
        source: characterToken,
        start: prompt.lastIndexOf(characterToken),
        end: prompt.lastIndexOf(characterToken) + characterToken.length,
        legacy: false,
      },
    ]);
  });

  it('ignores emails and malformed partial typed tokens', () => {
    const prompt = 'mail x@nope.test @{character:} @{media: and @bob';

    expect(tokenizePromptReferences(prompt)).toEqual([
      {
        kind: 'legacy-character',
        slug: 'bob',
        source: '@bob',
        start: prompt.indexOf('@bob'),
        end: prompt.indexOf('@bob') + '@bob'.length,
        legacy: true,
      },
    ]);
  });

  it('exposes canonical token strings', () => {
    expect(canonicalCharacterToken('char-1')).toBe('@{character:char-1}');
    expect(canonicalMediaToken('mv-2')).toBe('@{media:mv-2}');
  });
});
