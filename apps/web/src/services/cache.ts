/**
 * Browser cache with TTL support.
 *
 * Provides a stale-while-revalidate pattern for API responses:
 *  1. Return cached data immediately.
 *  2. Fetch fresh data in the background.
 *  3. Update cache and notify listeners when fresh data arrives.
 *
 * Uses localStorage — suitable for small payloads (model lists, template lists).
 */

const CACHE_PREFIX = "orv_cache_";

interface CacheEntry<T> {
  data: T;
  ts: number; // Unix timestamp (ms) when cached
}

export interface CacheResult<T> {
  /** Cached data, or undefined if never cached */
  cached: T | undefined;
  /** Fetch fresh data and update the cache */
  refresh: () => Promise<T>;
}

/**
 * Get cached data + a refresh function.
 *
 * Returns cached data immediately if available and non-expired.
 * The returned `refresh` function fetches fresh data and updates the cache.
 * Callers should: show `cached` immediately, then call `refresh()` and update
 * UI when the promise resolves.
 *
 * @param key       - unique cache key
 * @param fetcher   - function that fetches fresh data from the network
 * @param ttlMs     - cache TTL in milliseconds (default 1 hour)
 */
export function staleWhileRevalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 3_600_000, // 1 hour
): CacheResult<T> {
  const fullKey = CACHE_PREFIX + key;
  let cached: T | undefined;

  try {
    const raw = localStorage.getItem(fullKey);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (Date.now() - entry.ts < ttlMs) {
        cached = entry.data;
      }
    }
  } catch {
    // Corrupted cache — ignore
  }

  const refresh = async (): Promise<T> => {
    const data = await fetcher();
    try {
      localStorage.setItem(
        fullKey,
        JSON.stringify({ data, ts: Date.now() } satisfies CacheEntry<T>),
      );
    } catch {
      // Storage full or unavailable — ignore
    }
    return data;
  };

  return { cached, refresh };
}

/**
 * Eagerly fetch and cache data without returning stale.
 * Equivalent to refresh() in staleWhileRevalidate.
 */
export async function fetchAndCache<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const data = await fetcher();
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ data, ts: Date.now() } satisfies CacheEntry<T>),
    );
  } catch {
    // ignore
  }
  return data;
}

/**
 * Invalidate a cached entry.
 */
export function invalidateCache(key: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // ignore
  }
}

/** Cache keys used across the app */
export const CACHE_KEYS = {
  WAVESPEED_MODELS: "wavespeed_models",
  CLOUD_TEMPLATES: "cloud_templates",
  CLOUD_TEMPLATE: (id: string) => `cloud_template_${id}`,
  CLOUD_SCRIPTABLE_TEMPLATES: "cloud_scriptable_templates",
  CLOUD_SCRIPTABLE_TEMPLATE: (id: string) => `cloud_scriptable_template_${id}`,
} as const;
