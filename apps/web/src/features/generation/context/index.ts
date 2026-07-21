import {
  resolveGenerationReferences as resolvePromptGenerationReferences,
  tokenizePromptReferences,
} from '../references/resolve';

export type ContextDiagnosticCode =
  | 'entry-context-invalid'
  | 'audio-capability-required'
  | 'timing-incomplete'
  | 'timing-invalid'
  | 'unresolved-token'
  | 'ambiguous-token'
  | 'missing-primary-image'
  | 'inaccessible-primary-image'
  | 'audio-ambiguous'
  | 'audio-unavailable'
  | 'audio-no-coverage'
  | 'audio-partial-coverage';

export interface ContextDiagnostic { code: ContextDiagnosticCode; token?: string }
export interface GenerationTiming { source: 'timeline' | 'shot' | 'manual'; startSeconds: number; endSeconds: number; durationSeconds: number }
export interface TimeRange { startSeconds: number; endSeconds: number }

const validRange = (range: TimeRange | undefined): range is TimeRange =>
  !!range && Number.isFinite(range.startSeconds) && Number.isFinite(range.endSeconds) && range.startSeconds >= 0 && range.endSeconds > range.startSeconds;

export function resolveGenerationTiming(input: {
  linkedClip?: TimeRange;
  shot?: TimeRange;
  manualRange?: Partial<TimeRange>;
}): { timing?: GenerationTiming; errors: ContextDiagnostic[]; warnings: ContextDiagnostic[] } {
  const candidates: Array<['timeline' | 'shot', TimeRange | undefined]> = [['timeline', input.linkedClip], ['shot', input.shot]];
  for (const [source, range] of candidates) {
    if (range === undefined) continue;
    if (!validRange(range)) return { errors: [{ code: 'timing-invalid' }], warnings: [] };
    return { timing: { source, ...range, durationSeconds: range.endSeconds - range.startSeconds }, errors: [], warnings: [] };
  }
  const manual = input.manualRange;
  if (manual === undefined || (manual.startSeconds === undefined && manual.endSeconds === undefined)) return { errors: [], warnings: [] };
  if (manual.startSeconds === undefined || manual.endSeconds === undefined) return { errors: [{ code: 'timing-incomplete' }], warnings: [] };
  if (!validRange(manual as TimeRange)) return { errors: [{ code: 'timing-invalid' }], warnings: [] };
  return { timing: { source: 'manual', startSeconds: manual.startSeconds, endSeconds: manual.endSeconds, durationSeconds: manual.endSeconds - manual.startSeconds }, errors: [], warnings: [] };
}

export interface CharacterMention { text: string; slug: string; start: number; end: number }
export function tokenizeCharacterMentions(prompt: string): { mentions: CharacterMention[]; slugs: string[] } {
  const mentions: CharacterMention[] = [];
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const token of tokenizePromptReferences(prompt)) {
    if (token.kind !== 'legacy-character') continue;
    const text = token.source;
    const slug = token.slug;
    const start = token.start;
    mentions.push({ text, slug, start, end: start + text.length });
    if (!seen.has(slug)) { seen.add(slug); slugs.push(slug); }
  }
  return { mentions, slugs };
}

export interface ProjectCharacter { id: string; slug: string; displayName: string; primaryImageMediaId?: string; primaryImageVersionId?: string }
export interface MediaVersionAccess { mediaId: string; versionId?: string; accessible: boolean }
export interface CharacterBinding { slug: string; characterId: string; mediaId: string; versionId?: string }
const normalizeCompatibilityToken = (token: string): string => token.startsWith('@') ? token : `@${token}`;
const compatibilityTokenName = (token: string): string => token.replace(/^@/, '').toLowerCase();

function mapReferenceDiagnosticToContextError(input: { code: string; message: string; token: string }): ContextDiagnostic {
  switch (input.code) {
    case 'ambiguous':
      return { code: 'ambiguous-token', token: input.token };
    case 'unavailable':
      return {
        code: input.message.includes('no primary image')
          ? 'missing-primary-image'
          : 'inaccessible-primary-image',
        token: input.token,
      };
    case 'malformed-token':
    case 'unresolved':
    default:
      return { code: 'unresolved-token', token: input.token };
  }
}

export function resolveCharacterTokens(input: { tokens: readonly string[]; characters: readonly ProjectCharacter[]; mediaVersions: readonly MediaVersionAccess[]; priorBindings?: readonly CharacterBinding[] }): { bindings: CharacterBinding[]; errors: ContextDiagnostic[] } {
  const bindings: CharacterBinding[] = []; const errors: ContextDiagnostic[] = [];
  for (const rawToken of input.tokens) {
    const promptToken = normalizeCompatibilityToken(rawToken);
    const token = tokenizePromptReferences(promptToken)[0];
    const tokenName = token?.kind === 'legacy-character' ? token.slug : compatibilityTokenName(rawToken);
    if (!token || token.kind === 'media') {
      errors.push({ code: 'unresolved-token', token: tokenName });
      continue;
    }

    const resolution = resolvePromptGenerationReferences({
      prompt: promptToken,
      characters: input.characters,
      mediaVersions: input.mediaVersions,
      shotReferences: [],
      legacyBindings: input.priorBindings,
      roleByReferenceKey: {},
    });
    if (resolution.diagnostics.length > 0) {
      const diagnostic = resolution.diagnostics[0];
      errors.push(mapReferenceDiagnosticToContextError({
        code: diagnostic.code,
        message: diagnostic.message,
        token: tokenName,
      }));
      continue;
    }

    const reference = resolution.references[0];
    if (!reference) {
      errors.push({ code: 'unresolved-token', token: tokenName });
      continue;
    }

    const prior = token.kind === 'legacy-character'
      ? input.priorBindings?.find(binding => binding.slug === token.slug)
      : undefined;
    const character = token.kind === 'character'
      ? input.characters.find(item => item.id === token.id)
      : (prior && input.characters.find(item => item.id === prior.characterId)) ??
        input.characters.find(item =>
          item.primaryImageMediaId === reference.mediaId &&
          item.primaryImageVersionId === reference.mediaVersionId &&
          item.slug.toLowerCase() === token.slug,
        ) ??
        input.characters.find(item =>
          item.primaryImageMediaId === reference.mediaId &&
          item.primaryImageVersionId === reference.mediaVersionId,
        );

    if (character) {
      bindings.push({
        slug: token.kind === 'legacy-character' ? token.slug : character.slug.toLowerCase(),
        characterId: character.id,
        mediaId: reference.mediaId,
        versionId: reference.mediaVersionId,
      });
      continue;
    }

    if (prior) {
      bindings.push({
        slug: prior.slug,
        characterId: prior.characterId,
        mediaId: reference.mediaId,
        versionId: reference.mediaVersionId,
      });
      continue;
    }

    errors.push({ code: 'unresolved-token', token: tokenName });
  }
  return { bindings, errors };
}

export type ReferenceOrigin = 'source' | 'character' | 'shot' | 'user';
export interface ReferenceInput { mediaId: string; versionId?: string; accessible: boolean; included?: boolean }
export interface ResolvedReference extends ReferenceInput { origins: ReferenceOrigin[] }
export function resolveGenerationReferences(input: { source?: ReferenceInput; characters: readonly ReferenceInput[]; shotReferences: readonly ReferenceInput[]; userReferences: readonly ReferenceInput[] }): ResolvedReference[] {
  const result: ResolvedReference[] = []; const byIdentity = new Map<string, ResolvedReference>();
  const add = (reference: ReferenceInput, origin: ReferenceOrigin) => {
    if (reference.included === false) return;
    const key = `${reference.mediaId}\u0000${reference.versionId ?? ''}`;
    const existing = byIdentity.get(key);
    if (existing) { if (!existing.origins.includes(origin)) existing.origins.push(origin); return; }
    const resolved = { ...reference, origins: [origin] }; result.push(resolved); byIdentity.set(key, resolved);
  };
  if (input.source) add(input.source, 'source');
  input.characters.forEach(item => add(item, 'character')); input.shotReferences.forEach(item => add(item, 'shot')); input.userReferences.forEach(item => add(item, 'user'));
  return result;
}

export interface AudioClip { id: string; mediaId: string; versionId?: string; role: 'main' | 'music' | 'narration' | 'sfx' | 'visual'; startSeconds: number; endSeconds: number; sourceInSeconds?: number; trimStartSeconds?: number; trimEndSeconds?: number; speed: number; muted?: boolean; hidden?: boolean; generatedEmbeddedAudio?: boolean }
export interface AudioMedia { id: string; versionId?: string; accessible: boolean; hasAudio: boolean }
export interface AudioSourceRange { projectStartSeconds: number; projectEndSeconds: number; sourceStartSeconds: number; sourceEndSeconds: number; partial: boolean }
export function projectRangeToAudioSourceRange(input: { timing: GenerationTiming; clip: AudioClip }): AudioSourceRange | undefined {
  const { timing, clip } = input;
  if (!Number.isFinite(clip.speed) || clip.speed <= 0) return undefined;
  const clipStart = Math.max(clip.startSeconds, timing.startSeconds);
  const clipEnd = Math.min(clip.endSeconds, timing.endSeconds);
  if (clipEnd <= clipStart) return undefined;
  const base = (clip.sourceInSeconds ?? 0) + (clip.trimStartSeconds ?? 0);
  const sourceStart = base + (clipStart - clip.startSeconds) * clip.speed;
  let sourceEnd = base + (clipEnd - clip.startSeconds) * clip.speed;
  if (clip.trimEndSeconds !== undefined) sourceEnd = Math.min(sourceEnd, clip.trimEndSeconds);
  if (sourceEnd <= sourceStart) return undefined;
  const actualProjectEnd = clipStart + (sourceEnd - sourceStart) / clip.speed;
  return { projectStartSeconds: clipStart, projectEndSeconds: actualProjectEnd, sourceStartSeconds: sourceStart, sourceEndSeconds: sourceEnd, partial: clipStart > timing.startSeconds || actualProjectEnd < timing.endSeconds };
}

export function resolveMainAudioSource(input: { projectAudioId?: string; linkedMainAudioClipId?: string; clips: readonly AudioClip[]; media: readonly AudioMedia[]; timing: GenerationTiming }): { source?: { clip: AudioClip; media: AudioMedia; range: AudioSourceRange }; errors: ContextDiagnostic[]; warnings: ContextDiagnostic[] } {
  const eligible = input.clips.filter(clip => !clip.muted && !clip.hidden && !clip.generatedEmbeddedAudio && clip.role !== 'narration' && clip.role !== 'sfx' && clip.role !== 'visual')
    .map(clip => ({ clip, media: input.media.find(media => media.id === clip.mediaId && (clip.versionId === undefined || media.versionId === clip.versionId)), range: projectRangeToAudioSourceRange({ timing: input.timing, clip }) }))
    .filter((item): item is { clip: AudioClip; media: AudioMedia; range: AudioSourceRange } => !!item.media?.accessible && item.media.hasAudio && !!item.range);
  const selected = input.projectAudioId
    ? eligible.filter(item => item.media.id === input.projectAudioId)
    : input.linkedMainAudioClipId ? eligible.filter(item => item.clip.id === input.linkedMainAudioClipId)
      : eligible.filter(item => !item.range.partial);
  if (selected.length > 1) return { errors: [{ code: 'audio-ambiguous' }], warnings: [] };
  if (selected.length === 0) {
    const identityRequested = !!input.projectAudioId || !!input.linkedMainAudioClipId;
    const identityExists = identityRequested && input.clips.some(clip => clip.id === input.linkedMainAudioClipId || clip.mediaId === input.projectAudioId);
    return { errors: [{ code: identityExists ? 'audio-no-coverage' : 'audio-unavailable' }], warnings: [] };
  }
  return { source: selected[0], errors: [], warnings: selected[0].range.partial ? [{ code: 'audio-partial-coverage' }] : [] };
}
