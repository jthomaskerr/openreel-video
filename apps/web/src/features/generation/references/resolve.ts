import {
  canonicalCharacterToken,
  canonicalMediaToken,
  tokenizePromptReferences,
  type PromptReferenceToken,
} from './tokens';

export type {
  PromptReferenceToken,
} from './tokens';

export {
  canonicalCharacterToken,
  canonicalMediaToken,
  tokenizePromptReferences,
} from './tokens';

import type {
  PromptReferenceDiagnostic,
  ReferenceRoleByKey,
  ReferenceOrigin,
  ResolvedGenerationReference,
  ReferenceStatus,
} from '@openreel/core';

import type {
  CharacterBinding,
  MediaVersionAccess,
  ProjectCharacter,
} from '../context';

export interface ReferenceCandidate {
  readonly mediaId: string;
  readonly mediaVersionId: string;
  readonly canonicalTokens: readonly string[];
  readonly defaultRole: string;
}

export interface ResolveReferencesInput {
  readonly prompt: string;
  readonly source?: ReferenceCandidate;
  readonly characters: readonly ProjectCharacter[];
  readonly mediaVersions: readonly MediaVersionAccess[];
  readonly shotReferences: readonly ReferenceCandidate[];
  readonly legacyBindings?: readonly CharacterBinding[];
  readonly roleByReferenceKey: ReferenceRoleByKey;
}

export interface ResolveReferencesResult {
  readonly references: readonly ResolvedGenerationReference[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
}

type InternalReference =
  Omit<ResolvedGenerationReference, 'origins' | 'canonicalTokens'> & {
    origins: ReferenceOrigin[];
    canonicalTokens: readonly string[];
    canonicalTokenSet: Set<string>;
  };

const missingPrimaryImageMessage = (token: string) => `Character reference "${token}" has no primary image.`;
const inaccessiblePrimaryImageMessage = (token: string) => `Character reference "${token}" points to an inaccessible primary image.`;
const ambiguousCharacterMessage = (token: string) => `Character reference "${token}" matches multiple characters.`;
const unresolvedCharacterMessage = (token: string) => `No character matches "${token}".`;
const unresolvedMediaMessage = (token: string) => `No media version matches "${token}".`;
const malformedTokenMessage = (token: string) => `Typed reference token "${token}" is incomplete.`;

function makeDiagnostic(
  code: Exclude<PromptReferenceDiagnostic['code'], 'active'>,
  start: number,
  end: number,
  message: string,
): PromptReferenceDiagnostic {
  return { code, start, end, message, blocking: true };
}

function roleForReferenceKey(roleByReferenceKey: ReferenceRoleByKey, mediaVersionId: string, defaultRole: string): string {
  return roleByReferenceKey[`reference:${mediaVersionId}`] ?? defaultRole;
}

function mergeCanonicalTokens(target: Set<string>, values: readonly string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function upsertReference(
  references: InternalReference[],
  byKey: Map<string, InternalReference>,
  input: {
    readonly key: string;
    readonly mediaId: string;
    readonly mediaVersionId: string;
    readonly origin: InternalReference['origins'][number];
    readonly role: string;
    readonly canonicalTokens: readonly string[];
    readonly status?: ReferenceStatus;
    readonly reason?: string;
  },
): InternalReference {
  const existing = byKey.get(input.key);
  if (existing) {
    if (!existing.origins.includes(input.origin)) {
      existing.origins.push(input.origin);
    }
    mergeCanonicalTokens(existing.canonicalTokenSet, input.canonicalTokens);
    return existing;
  }

  const canonicalTokenSet = new Set<string>(input.canonicalTokens);
  const reference: InternalReference = {
    key: input.key,
    mediaId: input.mediaId,
    mediaVersionId: input.mediaVersionId,
    origins: [input.origin],
    role: input.role,
    canonicalTokens: input.canonicalTokens,
    order: references.length,
    status: input.status ?? 'active',
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    canonicalTokenSet,
  };

  references.push(reference);
  byKey.set(input.key, reference);
  return reference;
}

function uniqueByVersion(
  mediaVersions: readonly MediaVersionAccess[],
  mediaVersionId: string,
): MediaVersionAccess | undefined {
  return mediaVersions.find(version => version.versionId === mediaVersionId);
}

function resolveCharacterReference(
  token: PromptReferenceToken & { kind: 'character' | 'legacy-character' },
  input: ResolveReferencesInput,
  diagnostics: PromptReferenceDiagnostic[],
): ReferenceCandidate | undefined {
  const byId = token.kind === 'character' ? input.characters.find(character => character.id === token.id) : undefined;
  const legacyBinding = token.kind === 'legacy-character'
    ? input.legacyBindings?.find(binding => binding.slug === token.slug)
    : undefined;
  const boundCharacter = legacyBinding
    ? input.characters.find(item => item.id === legacyBinding.characterId)
    : undefined;
  const slugMatches = token.kind === 'legacy-character' && !boundCharacter
    ? input.characters.filter(character => character.slug.toLowerCase() === token.slug)
    : [];

  if (slugMatches.length > 1) {
    diagnostics.push(makeDiagnostic('ambiguous', token.start, token.end, ambiguousCharacterMessage(token.source)));
    return undefined;
  }

  const character = byId ?? boundCharacter ?? slugMatches[0];

  if (!character) {
    if (!legacyBinding) {
      diagnostics.push(makeDiagnostic('unresolved', token.start, token.end, unresolvedCharacterMessage(token.source)));
      return undefined;
    }

    const legacyAccess = input.mediaVersions.find(
      version =>
        version.mediaId === legacyBinding.mediaId &&
        version.versionId === legacyBinding.versionId &&
        version.accessible,
    );

    if (!legacyAccess) {
      diagnostics.push(makeDiagnostic('unavailable', token.start, token.end, inaccessiblePrimaryImageMessage(token.source)));
      return undefined;
    }

    const mediaVersionId = legacyBinding.versionId ?? legacyAccess.versionId;
    if (!mediaVersionId) {
      diagnostics.push(makeDiagnostic('unavailable', token.start, token.end, inaccessiblePrimaryImageMessage(token.source)));
      return undefined;
    }

    return {
      mediaId: legacyBinding.mediaId,
      mediaVersionId,
      canonicalTokens: [canonicalCharacterToken(legacyBinding.characterId)],
      defaultRole: 'character',
    };
  }

  if (!character.primaryImageMediaId || !character.primaryImageVersionId) {
    diagnostics.push(makeDiagnostic('unavailable', token.start, token.end, missingPrimaryImageMessage(token.source)));
    return undefined;
  }

  const access = input.mediaVersions.find(
    version =>
      version.mediaId === character.primaryImageMediaId &&
      version.versionId === character.primaryImageVersionId &&
      version.accessible,
  );

  if (!access) {
    diagnostics.push(makeDiagnostic('unavailable', token.start, token.end, inaccessiblePrimaryImageMessage(token.source)));
    return undefined;
  }

  return {
    mediaId: character.primaryImageMediaId,
    mediaVersionId: character.primaryImageVersionId,
    canonicalTokens: [canonicalCharacterToken(character.id)],
    defaultRole: 'character',
  };
}

function resolveMediaReference(
  token: Extract<PromptReferenceToken, { kind: 'media' }>,
  input: ResolveReferencesInput,
  diagnostics: PromptReferenceDiagnostic[],
): ReferenceCandidate | undefined {
  const version = uniqueByVersion(input.mediaVersions, token.id);
  if (!version || !version.accessible || version.versionId === undefined) {
    diagnostics.push(makeDiagnostic('unavailable', token.start, token.end, unresolvedMediaMessage(token.source)));
    return undefined;
  }

  return {
    mediaId: version.mediaId,
    mediaVersionId: version.versionId,
    canonicalTokens: [canonicalMediaToken(version.versionId)],
    defaultRole: 'prompt-media',
  };
}

function pushMalformedDiagnostics(prompt: string, diagnostics: PromptReferenceDiagnostic[]): void {
  const prefixes = ['@{character:', '@{media:'] as const;

  for (const prefix of prefixes) {
    let searchFrom = 0;

    while (searchFrom < prompt.length) {
      const start = prompt.indexOf(prefix, searchFrom);
      if (start === -1) break;

      let end = start + prefix.length;
      while (end < prompt.length) {
        const char = prompt[end];
        if (char === '}') {
          end += 1;
          break;
        }
        if (/[\s,.;:!?()[\]{}<>"'`]/u.test(char)) break;
        end += 1;
      }

      const token = prompt.slice(start, end);
      if (/^@\{(?:character|media):[A-Za-z0-9_-]+\}$/u.test(token)) {
        searchFrom = end;
        continue;
      }

      diagnostics.push(makeDiagnostic('malformed-token', start, end, malformedTokenMessage(token)));
      searchFrom = end;
    }
  }
}

export function resolveGenerationReferences(input: ResolveReferencesInput): ResolveReferencesResult {
  const diagnostics: PromptReferenceDiagnostic[] = [];
  const references: InternalReference[] = [];
  const byKey = new Map<string, InternalReference>();

  if (input.source) {
    upsertReference(references, byKey, {
      key: `reference:${input.source.mediaVersionId}`,
      mediaId: input.source.mediaId,
      mediaVersionId: input.source.mediaVersionId,
      origin: 'source',
      role: roleForReferenceKey(input.roleByReferenceKey, input.source.mediaVersionId, input.source.defaultRole),
      canonicalTokens: input.source.canonicalTokens,
    });
  }

  for (const token of tokenizePromptReferences(input.prompt)) {
    const candidate =
      token.kind === 'media'
        ? resolveMediaReference(token, input, diagnostics)
        : resolveCharacterReference(token, input, diagnostics);

    if (!candidate) continue;

    upsertReference(references, byKey, {
      key: `reference:${candidate.mediaVersionId}`,
      mediaId: candidate.mediaId,
      mediaVersionId: candidate.mediaVersionId,
      origin: token.kind === 'media' ? 'prompt-media' : 'character',
      role: roleForReferenceKey(input.roleByReferenceKey, candidate.mediaVersionId, candidate.defaultRole),
      canonicalTokens: candidate.canonicalTokens,
    });
  }

  for (const candidate of input.shotReferences) {
    upsertReference(references, byKey, {
      key: `reference:${candidate.mediaVersionId}`,
      mediaId: candidate.mediaId,
      mediaVersionId: candidate.mediaVersionId,
      origin: 'shot',
      role: roleForReferenceKey(input.roleByReferenceKey, candidate.mediaVersionId, candidate.defaultRole),
      canonicalTokens: candidate.canonicalTokens,
    });
  }

  pushMalformedDiagnostics(input.prompt, diagnostics);

  return {
    references: references.map(({ canonicalTokenSet, ...reference }) => ({
      ...reference,
      canonicalTokens: [...canonicalTokenSet],
    })),
    diagnostics,
  };
}
