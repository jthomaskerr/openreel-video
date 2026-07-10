export const SAFE_MODELS = new Set<string>();
export function rejectBrowserProviderKey(headers: Record<string, string | string[] | undefined>) { if (Object.keys(headers).some((h) => h.toLowerCase() === "x-wavespeed-api-key")) throw new Error("provider-key-header-forbidden"); }
export function requireJsonContentType(contentType: string | undefined) { if (!contentType?.toLowerCase().startsWith("application/json")) throw new Error("content-type-required"); }
export function validateModel(model: string, allowlist: ReadonlySet<string> = SAFE_MODELS) { if (!model || (allowlist.size > 0 && !allowlist.has(model))) throw new Error("unknown-model"); }
