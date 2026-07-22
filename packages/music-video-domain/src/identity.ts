const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

export interface MusicVideoIdEntropy {
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
}

const runtimeEntropy: MusicVideoIdEntropy = {
  now: () => Date.now(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
};

function encode(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => BASE32[byte & 31]).join("");
}

export function createMusicVideoDomainId(
  kind: "media" | "metadata-block" | "metadata-track" | "scene" | "storyboard",
  entropy: MusicVideoIdEntropy = runtimeEntropy,
): string {
  return `${kind}-${Math.trunc(entropy.now()).toString(36)}-${encode(entropy.randomBytes(16))}`;
}
