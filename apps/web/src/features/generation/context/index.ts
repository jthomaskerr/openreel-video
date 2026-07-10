export type ContextDiagnosticCode =
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
  const pattern = /(^|[^\p{L}\p{N}_])@([a-z0-9]+(?:-[a-z0-9]+)*)/giu;
  for (const match of prompt.matchAll(pattern)) {
    const prefixLength = match[1].length;
    const start = (match.index ?? 0) + prefixLength;
    const text = `@${match[2]}`;
    const slug = match[2].toLowerCase();
    mentions.push({ text, slug, start, end: start + text.length });
    if (!seen.has(slug)) { seen.add(slug); slugs.push(slug); }
  }
  return { mentions, slugs };
}

export interface ProjectCharacter { id: string; slug: string; displayName: string; primaryImageMediaId?: string; primaryImageVersionId?: string }
export interface MediaVersionAccess { mediaId: string; versionId?: string; accessible: boolean }
export interface CharacterBinding { slug: string; characterId: string; mediaId: string; versionId?: string }
export function resolveCharacterTokens(input: { tokens: readonly string[]; characters: readonly ProjectCharacter[]; mediaVersions: readonly MediaVersionAccess[]; priorBindings?: readonly CharacterBinding[] }): { bindings: CharacterBinding[]; errors: ContextDiagnostic[] } {
  const bindings: CharacterBinding[] = []; const errors: ContextDiagnostic[] = [];
  for (const rawToken of input.tokens) {
    const slug = rawToken.replace(/^@/, '').toLowerCase();
    const prior = input.priorBindings?.find(binding => binding.slug === slug);
    const priorCharacter = prior && input.characters.find(character => character.id === prior.characterId);
    const matches = priorCharacter ? [priorCharacter] : input.characters.filter(character => character.slug.toLowerCase() === slug);
    if (matches.length === 0) { errors.push({ code: 'unresolved-token', token: slug }); continue; }
    if (matches.length > 1) { errors.push({ code: 'ambiguous-token', token: slug }); continue; }
    const character = matches[0];
    if (!character.primaryImageMediaId) { errors.push({ code: 'missing-primary-image', token: slug }); continue; }
    const access = input.mediaVersions.find(version => version.mediaId === character.primaryImageMediaId && version.versionId === character.primaryImageVersionId);
    if (!access?.accessible) { errors.push({ code: 'inaccessible-primary-image', token: slug }); continue; }
    bindings.push({ slug, characterId: character.id, mediaId: character.primaryImageMediaId, versionId: character.primaryImageVersionId });
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
