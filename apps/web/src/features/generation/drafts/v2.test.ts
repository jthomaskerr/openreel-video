import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenerationSubmissionDraftCache,
  clearGenerationSubmissionDraftCache,
  createGenerationSubmissionRetryableDraft,
} from "./cache";
import {
  assertNoLocalSubmissionUrls,
  applyGenerationReferenceCommand,
  buildGenerationSubmissionContext,
  createGenerationReferenceRecoveryState,
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
      providerInstanceId: "wavespeed-primary",
      routing: {
        providerInstanceId: "wavespeed-primary",
        providerModelId: "m1",
        requestedMode: "text-to-image",
        providerSchemaId: "schema-m1",
        providerEndpointId: "endpoint-generate",
        providerSchemaVersion: "s1",
      },
      modelId: "m1",
      modelSchemaVersion: "s1",
      target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
      context: {
        projectId: "p1",
        entryContext: { kind: "new-asset" },
        mode: "text-to-image",
        prompt: "hello",
        references: [],
        placementPolicy: "none",
      },
      providerInputs: { prompt: "hello", keep: false, count: 0, values: [] },
    });

    expect(key).toBe(
      stableSubmissionStringify({
        projectId: "p1",
        provider: "wavespeed",
        providerInstanceId: "wavespeed-primary",
        routing: {
          providerInstanceId: "wavespeed-primary",
          providerModelId: "m1",
          requestedMode: "text-to-image",
          providerSchemaId: "schema-m1",
          providerEndpointId: "endpoint-generate",
          providerSchemaVersion: "s1",
        },
        modelId: "m1",
        modelSchemaVersion: "s1",
        target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
        context: {
          projectId: "p1",
          entryContext: { kind: "new-asset" },
          mode: "text-to-image",
          prompt: "hello",
          references: [],
          placementPolicy: "none",
        },
        providerInputs: { prompt: "hello", keep: false, count: 0, values: [] },
        canonicalPrompt: "hello",
        references: undefined,
        audio: undefined,
        placementPolicy: "none",
        referenceOverflowAcknowledged: false,
      }),
    );
  });

  it("ignores transient local upload values when building stable submission keys", () => {
    const first = generationSubmissionDraftKey({
      projectId: "p1",
      provider: "wavespeed",
      providerInstanceId: "wavespeed-primary",
      routing: {
        providerInstanceId: "wavespeed-primary",
        providerModelId: "m1",
        requestedMode: "text-to-image",
        providerSchemaId: "schema-m1",
        providerEndpointId: "endpoint-generate",
        providerSchemaVersion: "s1",
      },
      modelId: "m1",
      modelSchemaVersion: "s1",
      target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
      context: {
        projectId: "p1",
        entryContext: { kind: "new-asset" },
        mode: "text-to-image",
        prompt: "scene @{reference-1}",
        references: [],
        placementPolicy: "none",
      },
      providerInputs: { prompt: "scene @{reference-1}", seed: 7 },
      canonicalPrompt: "scene @{reference-1}",
      references: [{
        key: "reference-1",
        mediaId: "ref-media-1",
        mediaVersionId: "ref-version-1",
        role: "reference-images",
        order: 2,
        canonicalTokens: ["@{reference-1}"],
        status: "active",
        value: "file:///tmp/reference-a.png",
      }],
      audio: {
        value: "blob:audio-a",
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
    });

    const second = generationSubmissionDraftKey({
      projectId: "p1",
      provider: "wavespeed",
      providerInstanceId: "wavespeed-primary",
      routing: {
        providerInstanceId: "wavespeed-primary",
        providerModelId: "m1",
        requestedMode: "text-to-image",
        providerSchemaId: "schema-m1",
        providerEndpointId: "endpoint-generate",
        providerSchemaVersion: "s1",
      },
      modelId: "m1",
      modelSchemaVersion: "s1",
      target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
      context: {
        projectId: "p1",
        entryContext: { kind: "new-asset" },
        mode: "text-to-image",
        prompt: "scene @{reference-1}",
        references: [],
        placementPolicy: "none",
      },
      providerInputs: { prompt: "scene @{reference-1}", seed: 7 },
      canonicalPrompt: "scene @{reference-1}",
      references: [{
        key: "reference-1",
        mediaId: "ref-media-1",
        mediaVersionId: "ref-version-1",
        role: "reference-images",
        order: 2,
        canonicalTokens: ["@{reference-1}"],
        status: "active",
        value: "file:///tmp/reference-b.png",
      }],
      audio: {
        value: "blob:audio-b",
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
    });

    expect(first).toBe(second);
    expect(first).not.toContain("file:///tmp/reference-a.png");
    expect(first).not.toContain("blob:audio-a");
  });

  it.each([
    ["blob URL", "blob:provider-input-a"],
    ["file URL", "file:///tmp/provider-input-a.png"],
    [
      "expiring signed URL",
      "https://uploads.example.com/object?X-Amz-Expires=60&X-Amz-Signature=signature-a",
    ],
  ])("rejects a nested %s from provider-neutral submission keys", (_label, transientValue) => {
    expect(() => generationSubmissionDraftKey({
      projectId: "p1",
      provider: "wavespeed",
      providerInstanceId: "wavespeed-primary",
      routing: {
        providerInstanceId: "wavespeed-primary",
        providerModelId: "m1",
        requestedMode: "text-to-image",
        providerSchemaId: "schema-m1",
        providerEndpointId: "endpoint-generate",
        providerSchemaVersion: "s1",
      },
      modelId: "m1",
      modelSchemaVersion: "s1",
      target: { kind: "new-asset", placeholderMediaId: "placeholder-1" },
      context: {
        projectId: "p1",
        entryContext: { kind: "new-asset" },
        mode: "text-to-image",
        prompt: "scene",
        references: [],
        placementPolicy: "none",
      },
      providerInputs: {
        prompt: "scene",
        nested: { transport: transientValue },
      },
    })).toThrow(/providerInputs\.nested\.transport/);
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
        providerInstanceId: "wavespeed-primary",
        routing: {
          providerInstanceId: "wavespeed-primary",
          providerModelId: "m1",
          requestedMode: "text-to-image",
          providerSchemaId: "schema-m1",
          providerEndpointId: "endpoint-generate",
          providerSchemaVersion: "s1",
        },
        modelId: "m1",
        modelSchemaVersion: "s1",
        target: { kind: "new-asset" },
        context: {
          projectId: "p1",
          entryContext: { kind: "new-asset" },
          mode: "text-to-image",
          prompt: "hello",
          references: [],
          placementPolicy: "none",
        },
        providerInputs: { prompt: "hello" },
      },
      placeholderMediaId: "placeholder-1",
      updatedAt: 1000,
    });

    await cache.stagePending(entry);
    expect(cache.get("draft-key")).toEqual({ ...entry, status: "pending" });

    await cache.markFailed({
      key: "draft-key",
      error: { code: "generation-cache-failed", message: "cache down", retryable: true },
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
        providerInstanceId: "wavespeed-primary",
        routing: {
          providerInstanceId: "wavespeed-primary",
          providerModelId: "m1",
          requestedMode: "text-to-image",
          providerSchemaId: "schema-m1",
          providerEndpointId: "endpoint-generate",
          providerSchemaVersion: "s1",
        },
        modelId: "m1",
        modelSchemaVersion: "s1",
        canonicalPrompt: "hello @{reference-1}",
        target: { kind: "new-version", sourceMediaId: "source-1" },
        context: {
          projectId: "p1",
          entryContext: { kind: "new-asset" },
          mode: "text-to-image",
          prompt: "hello @{reference-1}",
          references: [],
          placementPolicy: "none",
        },
        providerInputs: { prompt: "hello" },
        references: [{
          key: "reference-1",
          mediaId: "ref-1",
          mediaVersionId: "version-1",
          role: "reference-images",
          order: 1,
          canonicalTokens: ["@{reference-1}"],
          status: "active",
          value: "file:///tmp/ref.png",
        }],
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
      referenceTokens: [{ tokenId: "ref-token" }],
      audioToken: { tokenId: "audio-token" },
    });

    expect(context).toMatchObject({
      projectId: "p1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      prompt: "hello @{reference-1}",
      placementPolicy: "none",
    });
    expect(context.references).toEqual([
      {
        id: "ref-1:version-1",
        order: 1,
        mediaId: "ref-1",
        versionId: "version-1",
        origins: ["user"],
        state: "active",
        preparationStatus: "preparing",
        errorHistory: [],
        uploadLeaseId: "ref-token",
      },
    ]);
    expect("audio" in context).toBe(false);
    expect(() => assertNoLocalSubmissionUrls(context, "context")).not.toThrow();
  });

  it.each([0, 1, 2])(
    "retries only the failed reference at position %s without disturbing successful uploads",
    async (failedIndex) => {
      const ids = ["first", "middle", "last"];
      const state = createGenerationReferenceRecoveryState({
        projectId: "p1",
        jobId: "j1",
        references: ids.map((id, index) => ({
          id,
          order: index + 1,
          mediaId: `${id}-media`,
          origins: ["user" as const],
          state: index === failedIndex ? "failed" as const : "active" as const,
          preparationStatus: index === failedIndex ? "failed" as const : "ready" as const,
          errorHistory: index === failedIndex
            ? [{ code: "upload", message: "down", retryable: true }]
            : [],
          uploadLeaseId: `lease-${id}`,
        })),
        drafts: ids.map((id) => ({ id, mediaId: `${id}-media` })),
      });
      const retryReference = vi.fn(async () => ({ tokenId: `retry-${ids[failedIndex]}` }));
      const releaseUploadLease = vi.fn(async () => {});

      const recovered = await applyGenerationReferenceCommand(
        state,
        { action: "retry", projectId: "p1", jobId: "j1", referenceId: ids[failedIndex] },
        { retryReference, releaseUploadLease },
      );

      expect(retryReference).toHaveBeenCalledTimes(1);
      expect(recovered.references.map((reference) => [
        reference.id,
        reference.order,
        reference.uploadLeaseId,
      ])).toEqual(ids.map((id, index) => [
        id,
        index + 1,
        index === failedIndex ? `retry-${id}` : `lease-${id}`,
      ]));
      expect(releaseUploadLease).toHaveBeenCalledOnce();
      expect(releaseUploadLease).toHaveBeenCalledWith({ tokenId: `lease-${ids[failedIndex]}` });
    },
  );

  it("removes or deactivates one reference and revalidates the active minimum", async () => {
    const state = createGenerationReferenceRecoveryState({
      projectId: "p1",
      jobId: "j1",
      references: [
        {
          id: "required",
          order: 1,
          mediaId: "required-media",
          origins: ["source"],
          state: "active",
          preparationStatus: "ready",
          errorHistory: [],
          uploadLeaseId: "required-lease",
        },
        {
          id: "optional",
          order: 2,
          mediaId: "optional-media",
          origins: ["user"],
          state: "failed",
          preparationStatus: "failed",
          errorHistory: [{ code: "upload", message: "down", retryable: true }],
        },
      ],
      drafts: [
        { id: "required", mediaId: "required-media" },
        { id: "optional", mediaId: "optional-media" },
      ],
    });
    const ports = {
      retryReference: vi.fn(async () => ({ tokenId: "unused" })),
      releaseUploadLease: vi.fn(async () => {}),
      referenceMinimum: 1,
    };

    const deactivated = await applyGenerationReferenceCommand(
      state,
      { action: "deactivate", projectId: "p1", jobId: "j1", referenceId: "optional" },
      ports,
    );
    expect(deactivated.references.find((reference) => reference.id === "optional")).toMatchObject({
      active: false,
      state: "failed",
    });
    expect(deactivated.providerReferences.map((reference) => [reference.id, reference.order])).toEqual([
      ["required", 1],
    ]);

    await expect(applyGenerationReferenceCommand(
      deactivated,
      { action: "remove", projectId: "p1", jobId: "j1", referenceId: "required" },
      ports,
    )).rejects.toThrow("generation-reference-required");
    expect(ports.releaseUploadLease).not.toHaveBeenCalled();
  });
});
