const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";
const KIND_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DURABLE_ID_PATTERN = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-([a-z0-9]+)-([a-z0-9]+)$/;

const DURABLE_ENTITY_KIND_VALUES = [
  "action", "action-group", "adjustment-layer", "artboard", "asset", "asset-group", "auto-edit",
  "camera", "chat", "chat-message", "clip", "compound-clip", "draft", "effect",
  "export-preset", "generated-image", "generation-job", "generation-session", "graphic",
  "brush-preset", "guide", "keyframe", "layer", "llm-instance", "log", "marker", "mask", "media",
  "metadata-block", "metadata-track", "motion-preset", "multicam", "multicam-angle",
  "multicam-switch", "music-video", "nested-sequence", "palette", "photo-project",
  "problem", "processing-task", "project", "recovery", "resolve-job", "resolve-request",
  "resolve-transaction", "scene", "selection", "snapshot", "speed-keyframe", "sticker",
  "storyboard", "subtitle", "template", "template-application", "text", "track",
  "tracking-job", "tracking-result", "transcription-job", "transition", "upload", "upload-lease", "vector-path",
] as const;

export type DurableEntityKind = (typeof DURABLE_ENTITY_KIND_VALUES)[number];

const DURABLE_ENTITY_KINDS = new Set<string>(DURABLE_ENTITY_KIND_VALUES);

export interface DurableIdEntropy {
  now(): number;
  randomBytes(length: number): Uint8Array;
}

declare const infrastructureNonceBrand: unique symbol;
export type InfrastructureNonce = string & {
  readonly [infrastructureNonceBrand]: true;
};

const runtimeEntropy: DurableIdEntropy = {
  now: Date.now,
  randomBytes(length) {
    const bytes = new Uint8Array(length);
    const crypto = globalThis.crypto;
    if (!crypto?.getRandomValues) {
      throw new Error("Secure random identity generation is unavailable");
    }
    crypto.getRandomValues(bytes);
    return bytes;
  },
};

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function createIdentity(prefix: string, entropy: DurableIdEntropy): string {
  if (!KIND_PATTERN.test(prefix)) {
    throw new Error(`Invalid durable identity prefix: ${prefix}`);
  }
  const now = entropy.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("Durable identity time must be a non-negative safe integer");
  }
  return `${prefix}-${now.toString(36)}-${encodeBase32(entropy.randomBytes(16))}`;
}

export function createDurableId(
  kind: DurableEntityKind,
  entropy: DurableIdEntropy = runtimeEntropy,
): string {
  return createIdentity(kind, entropy);
}

export function isDurableId(value: string, kind?: DurableEntityKind): boolean {
  const match = DURABLE_ID_PATTERN.exec(value);
  if (!match || !DURABLE_ENTITY_KINDS.has(match[1] as DurableEntityKind)) return false;
  return !kind || match[1] === kind;
}

export function createInfrastructureNonce(
  entropy: DurableIdEntropy = runtimeEntropy,
): InfrastructureNonce {
  return createIdentity("nonce", entropy) as InfrastructureNonce;
}

export function isInfrastructureNonce(value: string): value is InfrastructureNonce {
  return /^nonce-[a-z0-9]+-[a-z0-9]+$/.test(value);
}
