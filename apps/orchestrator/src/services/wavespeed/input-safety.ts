import type { JsonValue } from "@openreel/music-video-domain/generation";

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "::1"
    || normalized === "0.0.0.0"
    || normalized.startsWith("127.");
}

export function isWaveSpeedReachableHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function localValueCode(value: string): "wavespeed-input-media-unresolved" | "wavespeed-input-media-unreachable" | undefined {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (normalized.startsWith("upl_")) return "wavespeed-input-media-unresolved";
  if (/^(?:blob|local|file|data):/i.test(normalized)) return "wavespeed-input-media-unreachable";
  if (/^(?:\.{0,2}\/|~\/|\\\\|[a-z]:[\\/])/i.test(normalized)) return "wavespeed-input-media-unreachable";
  if (/^https?:\/\//i.test(normalized)) {
    try {
      if (isLocalHostname(new URL(normalized).hostname)) return "wavespeed-input-media-unreachable";
    } catch {
      return "wavespeed-input-media-unreachable";
    }
  }
  if (lower === "localhost" || lower.startsWith("localhost:")) return "wavespeed-input-media-unreachable";
  return undefined;
}

export function assertWaveSpeedProviderInputSafety(value: JsonValue): void {
  if (typeof value === "string") {
    const code = localValueCode(value);
    if (code) throw new Error(code);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertWaveSpeedProviderInputSafety(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) assertWaveSpeedProviderInputSafety(item);
  }
}

export function assertWaveSpeedMediaUrl(value: string): void {
  if (!isWaveSpeedReachableHttpsUrl(value)) throw new Error("wavespeed-input-media-unreachable");
}
