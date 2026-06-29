/**
 * Tests for the cache utility (staleWhileRevalidate, invalidateCache, CACHE_KEYS).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { staleWhileRevalidate, invalidateCache, CACHE_KEYS } from "./cache";

// localStorage mock
const store = new Map<string, string>();
const lsMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => { store.clear(); }),
};

Object.defineProperty(globalThis, "localStorage", {
  value: lsMock,
  writable: true,
});

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("staleWhileRevalidate", () => {
  it("returns undefined cached when nothing is stored", () => {
    const { cached } = staleWhileRevalidate("test", async () => "fresh", 60_000);
    expect(cached).toBeUndefined();
  });

  it("returns cached data when available and non-expired", () => {
    const entry = { data: ["model1", "model2"], ts: Date.now() };
    store.set("orv_cache_test", JSON.stringify(entry));

    const { cached } = staleWhileRevalidate("test", async () => ["fresh"], 60_000);
    expect(cached).toEqual(["model1", "model2"]);
  });

  it("returns undefined for expired cache", async () => {
    const entry = { data: ["old"], ts: Date.now() - 120_000 }; // 2 min old
    store.set("orv_cache_test", JSON.stringify(entry));

    const { cached, refresh } = staleWhileRevalidate("test", async () => ["new"], 60_000); // 1 min TTL
    expect(cached).toBeUndefined();

    // refresh should work
    const result = await refresh();
    expect(result).toEqual(["new"]);
  });

  it("refresh fetches and caches data", async () => {
    const fetcher = vi.fn().mockResolvedValue(["fresh-data"]);
    const { refresh } = staleWhileRevalidate("test", fetcher, 60_000);

    const result = await refresh();
    expect(result).toEqual(["fresh-data"]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Verify localStorage was updated
    const raw = store.get("orv_cache_test");
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.data).toEqual(["fresh-data"]);
    expect(typeof parsed.ts).toBe("number");
  });

  it("subsequent refresh overwrites stale cache", async () => {
    const entry = { data: ["stale"], ts: Date.now() - 10_000 };
    store.set("orv_cache_test", JSON.stringify(entry));

    const { refresh } = staleWhileRevalidate("test", async () => ["fresh"], 60_000);
    await refresh();

    const parsed = JSON.parse(store.get("orv_cache_test")!);
    expect(parsed.data).toEqual(["fresh"]);
  });
});

describe("invalidateCache", () => {
  it("removes the cache entry", () => {
    store.set("orv_cache_test", JSON.stringify({ data: "x", ts: Date.now() }));

    invalidateCache("test");

    expect(store.has("orv_cache_test")).toBe(false);
  });

  it("does not throw for missing key", () => {
    expect(() => invalidateCache("nonexistent")).not.toThrow();
  });
});

describe("CACHE_KEYS", () => {
  it("has all expected keys", () => {
    expect(CACHE_KEYS.WAVESPEED_MODELS).toBe("wavespeed_models");
    expect(CACHE_KEYS.CLOUD_TEMPLATES).toBe("cloud_templates");
    expect(CACHE_KEYS.CLOUD_TEMPLATE("abc")).toBe("cloud_template_abc");
    expect(CACHE_KEYS.CLOUD_SCRIPTABLE_TEMPLATES).toBe("cloud_scriptable_templates");
    expect(CACHE_KEYS.CLOUD_SCRIPTABLE_TEMPLATE("xyz")).toBe("cloud_scriptable_template_xyz");
  });
});
