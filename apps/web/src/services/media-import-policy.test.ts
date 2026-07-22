import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_MEDIA_SOURCE_BYTES,
  evaluateMediaImportPreflight,
  parseConfiguredMaxMediaSourceBytes,
  getMediaStorageEvidence,
} from "./media-import-policy";

describe("evaluateMediaImportPreflight", () => {
  it("accepts files one byte below and exactly at the configured cap", () => {
    expect(
      evaluateMediaImportPreflight({
        sourceBytes: DEFAULT_MAX_MEDIA_SOURCE_BYTES - 1,
      }),
    ).toMatchObject({ accepted: true });
    expect(
      evaluateMediaImportPreflight({
        sourceBytes: DEFAULT_MAX_MEDIA_SOURCE_BYTES,
      }),
    ).toMatchObject({ accepted: true });
  });

  it("rejects one byte above the configured cap with the configured-cap reason", () => {
    expect(
      evaluateMediaImportPreflight({
        sourceBytes: DEFAULT_MAX_MEDIA_SOURCE_BYTES + 1,
      }),
    ).toEqual({
      accepted: false,
      reason: "configured-cap",
      limitBytes: DEFAULT_MAX_MEDIA_SOURCE_BYTES,
    });
  });

  it("reports known available capacity separately from the configured cap", () => {
    expect(
      evaluateMediaImportPreflight({
        sourceBytes: 101,
        maxSourceBytes: 1_000,
        knownAvailableBytes: 100,
      }),
    ).toEqual({
      accepted: false,
      reason: "available-capacity",
      limitBytes: 100,
    });
  });

  it("reports a known runtime limit separately", () => {
    expect(
      evaluateMediaImportPreflight({
        sourceBytes: 501,
        maxSourceBytes: 1_000,
        runtimeLimitBytes: 500,
      }),
    ).toEqual({
      accepted: false,
      reason: "runtime-capability",
      limitBytes: 500,
    });
  });

  it("rejects invalid configuration instead of silently accepting it", () => {
    expect(() =>
      evaluateMediaImportPreflight({ sourceBytes: 1, maxSourceBytes: 0 }),
    ).toThrow("maxSourceBytes");
  });
});

describe("parseConfiguredMaxMediaSourceBytes", () => {
  it("uses a positive integer override and otherwise falls back to 2 GiB", () => {
    expect(parseConfiguredMaxMediaSourceBytes("1234")).toBe(1234);
    expect(parseConfiguredMaxMediaSourceBytes("0")).toBe(DEFAULT_MAX_MEDIA_SOURCE_BYTES);
    expect(parseConfiguredMaxMediaSourceBytes("invalid")).toBe(
      DEFAULT_MAX_MEDIA_SOURCE_BYTES,
    );
  });
});

describe("getMediaStorageEvidence", () => {
  it("returns unknown evidence when StorageManager estimation is unsupported", async () => {
    await expect(getMediaStorageEvidence(undefined)).resolves.toEqual({
      knownAvailableBytes: undefined,
      warning: "Browser storage capacity could not be estimated.",
    });
  });

  it("calculates remaining capacity without returning a negative value", async () => {
    await expect(
      getMediaStorageEvidence({ estimate: async () => ({ quota: 100, usage: 120 }) }),
    ).resolves.toEqual({ knownAvailableBytes: 0 });
  });
});
