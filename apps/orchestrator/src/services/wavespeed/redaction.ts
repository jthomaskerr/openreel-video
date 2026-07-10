const SECRET_KEY = /(authorization|api[-_]?key|token|secret|password|cookie|signed[-_]?url|upload[-_]?token)/i;
const URL_SECRET = /https?:\/\/[^\s"']+(?:signature|sig|token|expires|x-amz)[^\s"']*/i;
export function redactSecrets(value: unknown, options: { redactPrompts?: boolean } = {}): unknown {
  if (typeof value === "string") return URL_SECRET.test(value) || /Bearer\s+\S+/i.test(value) ? "[REDACTED]" : value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, options));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEY.test(key) || (options.redactPrompts && /prompt/i.test(key)) ? "[REDACTED]" : redactSecrets(item, options);
  return out;
}
export function assertNoSecrets(value: unknown) { const text = JSON.stringify(redactSecrets(value)); if (text.includes("Bearer ") || text.includes("[REDACTED]") === false && /x-wavespeed-api-key|signedUrl|uploadToken/i.test(text)) throw new Error("generation-secret-leak"); return true; }
