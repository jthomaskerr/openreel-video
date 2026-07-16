export type PromptReferenceToken =
  | { kind: 'character'; id: string; source: string; start: number; end: number; legacy: false }
  | { kind: 'media'; id: string; source: string; start: number; end: number; legacy: false }
  | { kind: 'legacy-character'; slug: string; source: string; start: number; end: number; legacy: true };

const typedReferencePattern =
  /(?<![\p{L}\p{N}_])@(?:\{character:([A-Za-z0-9_-]+)\}|\{media:([A-Za-z0-9_-]+)\}|(?!\{|character:|media:)([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*))(?![\p{L}\p{N}_])/giu;

export function canonicalCharacterToken(id: string): string {
  return `@{character:${id}}`;
}

export function canonicalMediaToken(mediaVersionId: string): string {
  return `@{media:${mediaVersionId}}`;
}

export function tokenizePromptReferences(prompt: string): readonly PromptReferenceToken[] {
  const tokens: PromptReferenceToken[] = [];

  for (const match of prompt.matchAll(typedReferencePattern)) {
    const source = match[0];
    const start = match.index ?? 0;
    const end = start + source.length;

    if (match[1] !== undefined) {
      tokens.push({ kind: 'character', id: match[1], source, start, end, legacy: false });
      continue;
    }

    if (match[2] !== undefined) {
      tokens.push({ kind: 'media', id: match[2], source, start, end, legacy: false });
      continue;
    }

    const slug = match[3].toLowerCase();
    tokens.push({ kind: 'legacy-character', slug, source, start, end, legacy: true });
  }

  return tokens;
}
