import { beforeEach, describe, expect, it } from "vitest";
import {
  createGenerationSubmissionDraftCache,
  clearGenerationSubmissionDraftCache,
  createGenerationSubmissionRetryableDraft,
} from "./cache";
import {
  assertNoLocalSubmissionUrls,
  buildGenerationSubmissionContext,
  generationSubmissionDraftKey,
  isLocalSubmissionUrl,
  stableSubmissionStringify,
} from "./v2";

describe("generation submission draft helpers", () => {
  beforeEach(() => {
    clearGenerationSubmissionDraftCache();
  });

  it("builds stable submission keys", () => {
    const key = generationSubmissionDraftKey({
      projectId: "p1",
      provider: "wavespeed",
      modelId: "m1",
      modelSchemaVersion: "s1",
      target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
      context: { projectId: "p1", shotId: "shot-1", clipId: "clip-1", references: [], placementPolicy: "none" },
      providerInputs: { prompt: "hello", keep: false, count: 0, values: [] },
    });

    expect(key).toBe(
      stableSubmissionStringify({
        projectId: "p1",
        provider: "wavespeed",
        modelId: "m1",
        modelSchemaVersion: "s1",
        target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
        context: { projectId: "p1", shotId: "shot-1", clipId: "clip-1", references: [], placementPolicy: "none" },
        providerInputs: { prompt: "hello", keep: false, count: 0, values: [] },
        references: undefined,
        audio: undefined,
        placementPolicy: "none",
      }),
    );
  });

  it("flags local submission urls", () => {
    expect(isLocalSubmissionUrl("blob:abc")).toBe(true);
    expect(isLocalSubmissionUrl("file:///tmp/x.png")).toBe(true);
    expect(isLocalSubmissionUrl("https://localhost:3000/x")).toBe(true);
    expect(isLocalSubmissionUrl("https://example.com/x")).toBe(false);
  });

  it("rejects leaked local urls in nested payloads", () => {
    expect(() =>
      assertNoLocalSubmissionUrls({ nested: [{ value: "http://127.0.0.1:8080/x" }] }, "payload"),
    ).toThrow(/payload\.nested\[0\]\.value/);
  });

  it("creates and updates retryable draft cache entries", async () => {
    const cache = createGenerationSubmissionDraftCache();
    const entry = createGenerationSubmissionRetryableDraft({
      key: "draft-key",
      draft: {
        projectId: "p1",
        provider: "wavespeed",
        modelId: "m1",
        modelSchemaVersion: "s1",
        target: { kind: "new-asset" },
        context: { projectId: "p1", references: [], placementPolicy: "none" },
        providerInputs: { prompt: "hello" },
      },
      placeholderMediaId: "placeholder-1",
      updatedAt: 1000,
    });

    await cache.stagePending(entry);
    expect(cache.get("draft-key")).toEqual({ ...entry, status: "pending" });

    await cache.markFailed({
      key: "draft-key",
      error: { code: "generation-cache-failed", retryable: true },
      updatedAt: 2000,
    });
    expect(cache.get("draft-key")).toMatchObject({
      status: "failed",
      placeholderMediaId: "placeholder-1",
      error: { code: "generation-cache-failed", retryable: true },
      updatedAt: 2000,
    });

    await cache.clear("draft-key");
    expect(cache.get("draft-key")).toBeUndefined();
  });

  it("builds a submission context with explicit target and opaque tokens", () => {
    const context = buildGenerationSubmissionContext({
      draft: {
        projectId: "p1",
        provider: "wavespeed",
        modelId: "m1",
        modelSchemaVersion: "s1",
        target: { kind: "new-version", sourceMediaId: "source-1" },
        context: { projectId: "p1", shotId: "shot-1", clipId: "clip-1", references: [], placementPolicy: "none" },
        providerInputs: { prompt: "hello" },
        references: [{ mediaId: "ref-1", value: "file:///tmp/ref.png" }],
        audio: {
          value: "ignored",
          sourceMediaId: "audio-media",
          sourceVersionId: "audio-version",
          sourceClipId: "audio-clip",
          projectStartSeconds: 0,
          projectEndSeconds: 1,
          sourceStartSeconds: 0,
          sourceEndSeconds: 1,
          mimeType: "audio/wav",
          sha256: "sha",
        },
      },
      target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
      referenceTokens: [{ tokenId: "ref-token" }],
      audioToken: { tokenId: "audio-token" },
    });

    expect(context.target).toEqual({
      kind: "new-version",
      sourceMediaId: "source-1",
      placeholderMediaId: "placeholder-1",
    });
    expect(context.references).toEqual([
      {
        mediaId: "ref-1",
        origins: ["user"],
        remoteInput: { kind: "upload-token", value: "ref-token" },
      },
    ]);
    expect(context.audio).toMatchObject({
      sourceMediaId: "audio-media",
      sourceVersionId: "audio-version",
      sourceClipId: "audio-clip",
      remoteInput: { kind: "upload-token", value: "audio-token" },
    });
    expect(() => assertNoLocalSubmissionUrls(context, "context")).not.toThrow();
  });
});
