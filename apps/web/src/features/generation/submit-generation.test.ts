import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationContextSchema, GenerationJobSchema } from "@openreel/music-video-domain/generation";
import {
  clearGenerationSubmissionInflight,
  recoverGenerationReference,
  submitGeneration,
  type GenerationDraft,
  type SubmitGenerationPorts,
} from "./submit-generation";
import { createGenerationSubmissionDraftCache } from "./drafts/cache";
import { createGenerationReferenceRecoveryState, generationSubmissionDraftKey } from "./drafts/v2";

function draft(overrides: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
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
    canonicalPrompt: "hello",
    target: { kind: "new-version", sourceMediaId: "source-1" },
    context: {
      projectId: "p1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      prompt: "hello",
      references: [],
      placementPolicy: "none",
    },
    providerInputs: { prompt: "hello", keep: false },
    ...overrides,
  };
}

function ports(overrides: Partial<SubmitGenerationPorts> = {}): SubmitGenerationPorts {
  return {
    mutations: {
      createPlaceholder: vi.fn(async () => "placeholder-1"),
      markPlaceholderFailed: vi.fn(async () => {}),
    },
    references: {
      uploadReference: vi.fn(async () => ({ tokenId: "ref-token" })),
    },
    audio: {
      uploadAudio: vi.fn(async () => ({ tokenId: "audio-token" })),
    },
    provider: {
      submit: vi.fn(async () => ({ providerJobId: "provider-1" })),
    },
    cache: {
      put: vi.fn(async () => {}),
    },
    sanitizer: {
      sanitize: vi.fn(({ draft: value }) => ({ inputs: value.providerInputs })),
    },
    clock: {
      now: vi.fn(() => 1000),
    },
    ids: {
      next: vi.fn((prefix) => `${prefix}-1`),
    },
    draftCache: createGenerationSubmissionDraftCache(),
    ...overrides,
  };
}

describe("submitGeneration", () => {
  beforeEach(() => {
    clearGenerationSubmissionInflight();
  });

  it("rejects invalid drafts before any mutation", async () => {
    const p = ports();
    await expect(submitGeneration({ ...draft(), projectId: "" }, p)).rejects.toMatchObject({
      code: "invalid-draft",
      field: "projectId",
    });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
    expect(p.provider.submit).not.toHaveBeenCalled();
    expect(p.cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ["access_key", { access_key: "secret" }],
    ["wavespeed_api_key", { wavespeed_api_key: "secret" }],
    ["token", { token: "secret" }],
  ])("rejects a reviewer-probed %s before any mutation", async (_name, nested) => {
    const p = ports();

    await expect(submitGeneration(draft({
      providerInputs: {
        prompt: "hello",
        nested,
      },
    }), p)).rejects.toMatchObject({
      code: "invalid-draft",
      field: expect.stringContaining("providerInputs.nested."),
    });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
    expect(p.provider.submit).not.toHaveBeenCalled();
  });

  it("accepts benign pre-sanitizer names near credential terminology", async () => {
    const providerInputs = {
      prompt: "hello",
      maxTokens: 512,
      tokenCount: 12,
      wavespeedApiKeyEnabled: false,
      accessKeyframeId: "frame-1",
    };
    const p = ports();

    await submitGeneration(draft({ providerInputs }), p);

    expect(p.provider.submit).toHaveBeenCalledOnce();
  });

  it("rejects a requested-mode mismatch before placeholder, upload, or provider work", async () => {
    const p = ports();
    const input = draft();
    input.routing = { ...input.routing, requestedMode: "image-to-image" };
    input.references = [{
      key: "reference-1",
      mediaId: "reference-media-1",
      mediaVersionId: "reference-version-1",
      order: 1,
      status: "active",
    }];
    input.audio = {
      value: "audio-bytes",
      sourceMediaId: "audio-media-1",
      sourceVersionId: "audio-version-1",
      sourceClipId: "audio-clip-1",
      projectStartSeconds: 0,
      projectEndSeconds: 1,
      sourceStartSeconds: 0,
      sourceEndSeconds: 1,
      mimeType: "audio/wav",
      sha256: "audio-sha-1",
    };

    await expect(submitGeneration(input, p)).rejects.toMatchObject({
      code: "invalid-draft",
      field: "routing.requestedMode",
    });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
    expect(p.references?.uploadReference).not.toHaveBeenCalled();
    expect(p.audio?.uploadAudio).not.toHaveBeenCalled();
    expect(p.sanitizer?.sanitize).not.toHaveBeenCalled();
    expect(p.provider.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["blob URL", "blob:provider-input-a"],
    ["file URL", "file:///tmp/provider-input-a.png"],
    [
      "expiring signed URL",
      "https://uploads.example.com/object?X-Amz-Expires=60&X-Amz-Signature=signature-a",
    ],
  ])("rejects a nested %s in provider inputs before any mutation", async (_label, transientValue) => {
    const p = ports();

    await expect(submitGeneration(draft({
      providerInputs: {
        prompt: "hello",
        nested: { transport: transientValue },
      },
    }), p)).rejects.toMatchObject({
      code: "invalid-draft",
      field: "providerInputs.nested.transport",
    });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
    expect(p.provider.submit).not.toHaveBeenCalled();
  });

  it("creates one placeholder and one provider submit for concurrent replay", async () => {
    const p = ports();
    const first = submitGeneration(draft(), p);
    const second = submitGeneration(draft(), p);
    const [jobA, jobB] = await Promise.all([first, second]);

    expect(jobA).toEqual(jobB);
    expect(p.mutations.createPlaceholder).toHaveBeenCalledTimes(1);
    expect(p.provider.submit).toHaveBeenCalledTimes(1);
    expect(p.provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          entryContext: { kind: "new-asset" },
        }),
      }),
    );
  });

  it("blocks a failed required source until recovery, then submits its preserved upload exactly once", async () => {
    const p = ports();
    const state = createGenerationReferenceRecoveryState({
      projectId: "p1",
      jobId: "j1",
      references: [
        {
          id: "source-id",
          order: 1,
          mediaId: "source-media",
          versionId: "source-version",
          origins: ["source"],
          state: "failed",
          preparationStatus: "failed",
          errorHistory: [{ code: "upload", message: "down", retryable: true }],
        },
        {
          id: "user-id",
          order: 2,
          mediaId: "user-media",
          versionId: "user-version",
          origins: ["user"],
          state: "active",
          preparationStatus: "ready",
          errorHistory: [],
          uploadLeaseId: "preserved-user-lease",
        },
      ],
      drafts: [
        { id: "source-id", mediaId: "source-media", versionId: "source-version", value: { blobId: "source-blob" } },
        { id: "user-id", mediaId: "user-media", versionId: "user-version", value: { blobId: "user-blob" } },
      ],
    });

    const failedPreparationReferences = state.references.map((reference) => ({
      key: reference.id,
      mediaId: reference.mediaId,
      versionId: reference.versionId,
      order: reference.order,
      origins: reference.origins,
      value: state.drafts.find((candidate) => candidate.id === reference.id)?.value,
      uploadLeaseId: reference.uploadLeaseId,
      status: reference.preparationStatus === "ready" ? "active" as const : "unavailable" as const,
      ...(reference.preparationStatus === "ready" ? {} : { reason: "required source preparation failed" }),
    }));

    await expect(submitGeneration(draft({ references: failedPreparationReferences }), p))
      .rejects.toMatchObject({ code: "generation-reference-required", field: "references.0.status" });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
    expect(p.provider.submit).not.toHaveBeenCalled();

    const recovered = await recoverGenerationReference({
      state,
      command: { action: "retry", projectId: "p1", jobId: "j1", referenceId: "source-id" },
      ports: {
        retryReference: vi.fn(async () => ({ tokenId: "recovered-source-lease" })),
        releaseUploadLease: vi.fn(async () => {}),
      },
    });

    const explicitReferences = recovered.references.map((reference) => ({
      key: reference.id,
      mediaId: reference.mediaId,
      versionId: reference.versionId,
      order: reference.order,
      origins: reference.origins,
      value: recovered.drafts.find((candidate) => candidate.id === reference.id)?.value,
      uploadLeaseId: reference.uploadLeaseId,
      status: "active" as const,
    }));
    expect(p.provider.submit).not.toHaveBeenCalled();

    await submitGeneration(draft({ references: explicitReferences }), p);

    expect(p.references?.uploadReference).not.toHaveBeenCalled();
    expect(p.provider.submit).toHaveBeenCalledOnce();
    expect(p.provider.submit).toHaveBeenCalledWith(expect.objectContaining({
      references: [
        expect.objectContaining({ key: "source-id", remoteInput: { kind: "upload-token", value: "recovered-source-lease" } }),
        expect.objectContaining({ key: "user-id", remoteInput: { kind: "upload-token", value: "preserved-user-lease" } }),
      ],
      context: expect.objectContaining({
        references: [
          expect.objectContaining({ mediaId: "source-media", uploadLeaseId: "recovered-source-lease" }),
          expect.objectContaining({ mediaId: "user-media", uploadLeaseId: "preserved-user-lease" }),
        ],
      }),
    }));
  });

  it("carries immutable V2 route, context, and current-attempt identity through submission", async () => {
    const p = ports();
    const job = await submitGeneration(draft(), p);

    expect(p.provider.submit).toHaveBeenCalledWith(expect.objectContaining({
      providerInstanceId: "wavespeed-primary",
      routing: expect.objectContaining({
        providerInstanceId: "wavespeed-primary",
        providerModelId: "m1",
        requestedMode: "text-to-image",
      }),
      context: expect.objectContaining({
        projectId: "p1",
        entryContext: { kind: "new-asset" },
        mode: "text-to-image",
        prompt: "hello",
      }),
    }));
    expect(() => GenerationContextSchema.parse(job.context)).not.toThrow();
    expect(() => GenerationJobSchema.parse(job)).not.toThrow();
    expect(job).toMatchObject({
      contractVersion: 2,
      projectId: "p1",
      providerInstanceId: "wavespeed-primary",
      providerJobId: "provider-1",
      attempt: 1,
      routing: expect.objectContaining({ providerInstanceId: "wavespeed-primary" }),
      attempts: [expect.objectContaining({
        attemptNumber: 1,
        providerJobId: "provider-1",
        routing: expect.objectContaining({ providerInstanceId: "wavespeed-primary" }),
      })],
    });
  });

  it("submits the validated snapshot when the caller mutates the draft while placeholder creation is pending", async () => {
    let resolvePlaceholder!: (value: string) => void;
    const placeholder = new Promise<string>((resolve) => {
      resolvePlaceholder = resolve;
    });
    const uploadReference = vi.fn(async () => ({ tokenId: "ref-token" }));
    const uploadAudio = vi.fn(async () => ({ tokenId: "audio-token" }));
    const providerSubmit = vi.fn(async () => ({ providerJobId: "provider-1" }));
    const p = ports({
      mutations: {
        createPlaceholder: vi.fn(() => placeholder),
        markPlaceholderFailed: vi.fn(async () => {}),
      },
      references: { uploadReference },
      audio: { uploadAudio },
      provider: { submit: providerSubmit },
    });
    const input = draft({
      canonicalPrompt: "original @{reference-1}",
      providerInputs: {
        prompt: "original @{reference-1}",
        options: { guidance: 7 },
      },
      references: [{
        key: "reference-1",
        mediaId: "ref-media-1",
        mediaVersionId: "ref-version-1",
        role: "source-image",
        order: 1,
        origins: ["user"],
        canonicalTokens: ["@{reference-1}"],
        status: "active",
      }],
      audio: {
        sourceMediaId: "audio-media-1",
        sourceVersionId: "audio-version-1",
        sourceClipId: "audio-clip-1",
        projectStartSeconds: 0,
        projectEndSeconds: 1,
        sourceStartSeconds: 2,
        sourceEndSeconds: 3,
        mimeType: "audio/wav",
        sha256: "audio-sha-1",
      },
    });
    const original = structuredClone(input);
    const expectedKey = generationSubmissionDraftKey({
      projectId: original.projectId,
      provider: original.provider,
      providerInstanceId: original.providerInstanceId,
      routing: original.routing,
      modelId: original.modelId,
      modelSchemaVersion: original.modelSchemaVersion,
      target: original.target.kind === "new-version"
        ? {
            kind: "new-version",
            sourceMediaId: original.target.sourceMediaId ?? "",
            placeholderMediaId: "__submission__",
          }
        : { kind: "new-asset", placeholderMediaId: "__submission__" },
      context: original.context,
      providerInputs: original.providerInputs,
      canonicalPrompt: original.canonicalPrompt,
      references: original.references,
      audio: original.audio,
      placementPolicy: original.placementPolicy ?? original.context.placementPolicy,
      referenceOverflowAcknowledged: original.referenceOverflowAcknowledged,
    });

    const submission = submitGeneration(input, p);
    expect(p.mutations.createPlaceholder).toHaveBeenCalledTimes(1);

    input.provider = "kieai";
    input.providerInstanceId = "mutated-provider-instance";
    input.routing.providerModelId = "mutated-route-model";
    input.modelId = "mutated-model";
    input.canonicalPrompt = "mutated prompt";
    input.context.prompt = "mutated prompt";
    input.providerInputs.prompt = "mutated prompt";
    (input.providerInputs.options as { guidance: number }).guidance = 99;
    input.references![0]!.mediaId = "mutated-reference";
    input.references![0]!.status = "cyclic";
    input.audio!.sourceMediaId = "mutated-audio";

    resolvePlaceholder("placeholder-1");
    const job = await submission;

    expect(uploadReference).toHaveBeenCalledWith(expect.objectContaining({
      key: "reference-1",
      mediaId: "ref-media-1",
      mediaVersionId: "ref-version-1",
      role: "source-image",
      status: "active",
    }));
    expect(uploadAudio).toHaveBeenCalledWith(expect.objectContaining({
      sourceMediaId: "audio-media-1",
      sourceVersionId: "audio-version-1",
      sha256: "audio-sha-1",
    }));
    expect(providerSubmit).toHaveBeenCalledWith(expect.objectContaining({
      provider: "wavespeed",
      modelId: "m1",
      routing: expect.objectContaining({
        providerInstanceId: "wavespeed-primary",
        providerModelId: "m1",
      }),
      inputs: {
        prompt: "original @{reference-1}",
        options: { guidance: 7 },
      },
      context: expect.objectContaining({
        entryContext: { kind: "new-asset" },
        prompt: "hello",
      }),
      idempotencyKey: expectedKey,
    }));
    expect(job).toMatchObject({
      provider: "wavespeed",
      providerInstanceId: "wavespeed-primary",
      modelId: "m1",
      routing: expect.objectContaining({ providerModelId: "m1" }),
      context: expect.objectContaining({
        entryContext: { kind: "new-asset" },
        prompt: "hello",
      }),
    });
  });

  it("uses the explicit target instead of deriving from references", async () => {
    const p = ports();
    await submitGeneration(
      draft({
        target: { kind: "new-version", sourceMediaId: "explicit-source" },
        references: [{ mediaId: "reference-source", value: "https://example.com/ref.png" }],
      }),
      p,
    );

    expect(p.provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          entryContext: { kind: "new-asset" },
        }),
      }),
    );
  });

  it("marks the placeholder failed and keeps a retryable draft when reference upload fails", async () => {
    const p = ports({
      references: {
        uploadReference: vi.fn(async () => {
          throw new Error("upload down");
        }),
      },
    });

    await expect(
      submitGeneration(
        draft({
          idempotencyKey: "submission-key",
          references: [{
            key: "reference-1",
            mediaId: "ref-1",
            mediaVersionId: "ref-version-1",
            role: "reference-images",
            order: 1,
            canonicalTokens: ["@{reference-1}"],
            status: "active",
            value: "file:///tmp/ref.png",
          }],
        }),
        p,
      ),
    ).rejects.toMatchObject({
      code: "generation-reference-upload-failed",
      retryable: true,
    });

    expect(p.mutations.createPlaceholder).toHaveBeenCalledTimes(1);
    expect(p.mutations.markPlaceholderFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        placeholderMediaId: "placeholder-1",
        error: expect.objectContaining({ code: "generation-reference-upload-failed", retryable: true }),
      }),
    );
    expect(p.provider.submit).not.toHaveBeenCalled();
    expect(p.draftCache?.get("submission-key")).toMatchObject({
      status: "failed",
      placeholderMediaId: "placeholder-1",
      draft: {
        canonicalPrompt: "hello",
        references: [{
          key: "reference-1",
          mediaId: "ref-1",
          mediaVersionId: "ref-version-1",
          role: "reference-images",
          order: 1,
          status: "active",
        }],
      },
      error: { code: "generation-reference-upload-failed", retryable: true },
    });
    expect(JSON.stringify(p.draftCache?.get("submission-key"))).not.toContain("file:///tmp/ref.png");
  });

  it("marks the placeholder failed and keeps a retryable draft when provider submission fails", async () => {
    const p = ports({
      provider: {
        submit: vi.fn(async () => {
          throw new Error("provider down");
        }),
      },
    });

    await expect(
      submitGeneration(
        draft({
          idempotencyKey: "submission-key",
          references: [{ mediaId: "ref-1", value: "https://example.com/ref.png" }],
        }),
        p,
      ),
    ).rejects.toMatchObject({
      code: "generation-submit-failed",
      retryable: true,
    });

    expect(p.mutations.createPlaceholder).toHaveBeenCalledTimes(1);
    expect(p.mutations.markPlaceholderFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        placeholderMediaId: "placeholder-1",
        error: expect.objectContaining({ code: "generation-submit-failed", retryable: true }),
      }),
    );
    expect(p.draftCache?.get("submission-key")).toMatchObject({
      status: "failed",
      placeholderMediaId: "placeholder-1",
      error: { code: "generation-submit-failed", retryable: true },
    });
  });

  it("marks the placeholder failed and keeps a retryable draft when cache persistence fails", async () => {
    const draftCache = {
      stagePending: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      clear: vi.fn(async () => {
        throw new Error("cache down");
      }),
      get: vi.fn(),
      clearAll: vi.fn(),
    } satisfies SubmitGenerationPorts["draftCache"];
    const p = ports({
      draftCache,
      references: {
        uploadReference: vi.fn(async () => ({ tokenId: "ref-token" })),
      },
    });

    await expect(
      submitGeneration(
        draft({
          idempotencyKey: "submission-key",
          references: [{ mediaId: "ref-1", value: "https://example.com/ref.png" }],
        }),
        p,
      ),
    ).rejects.toMatchObject({
      code: "generation-cache-failed",
      retryable: true,
    });

    expect(p.provider.submit).toHaveBeenCalledTimes(1);
    expect(p.mutations.markPlaceholderFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        placeholderMediaId: "placeholder-1",
        error: expect.objectContaining({ code: "generation-cache-failed", retryable: true }),
      }),
    );
    expect(draftCache?.stagePending).toHaveBeenCalledTimes(1);
    expect(draftCache?.markFailed).toHaveBeenCalledTimes(1);
    expect(draftCache?.get).toHaveBeenCalledWith("submission-key");
  });

  it("rejects local urls leaked from sanitization before provider submission", async () => {
    const p = ports({
      sanitizer: {
        sanitize: vi.fn(() => ({ inputs: { prompt: "ok", sourceUrl: "blob:local-source" } })),
      },
    });

    await expect(submitGeneration(draft(), p)).rejects.toMatchObject({
      code: "generation-sanitize-failed",
      retryable: true,
    });
    expect(p.provider.submit).not.toHaveBeenCalled();
    expect(p.mutations.markPlaceholderFailed).toHaveBeenCalled();
  });

  it.each([
    ["access_key_id", { nested: { access_key_id: "AKIA_TEST" } }],
    ["secret-access-key", { credentials: [{ "secret-access-key": "secret" }] }],
    ["X-Goog-API-Key", { headers: { "X-Goog-API-Key": "secret" } }],
    ["awsAccessKeyId", { auth: { awsAccessKeyId: "AKIA_TEST" } }],
    ["aws_secret_access_key", { auth: { aws_secret_access_key: "secret" } }],
    ["google_api_key", { auth: { google_api_key: "secret" } }],
    ["accessKeySecret", { auth: { accessKeySecret: "secret" } }],
    ["AWS_SESSION_TOKEN", { auth: { AWS_SESSION_TOKEN: "secret" } }],
    ["access_key", { auth: { access_key: "secret" } }],
    ["wavespeed_api_key", { auth: { wavespeed_api_key: "secret" } }],
    ["token", { auth: { token: "secret" } }],
  ])("rejects a sanitizer-introduced %s before provider submission", async (_name, inputs) => {
    const p = ports({
      sanitizer: { sanitize: vi.fn(() => ({ inputs })) },
    });

    await expect(submitGeneration(draft(), p)).rejects.toMatchObject({
      code: "generation-sanitize-failed",
      retryable: true,
    });
    expect(p.provider.submit).not.toHaveBeenCalled();
  });

  it("accepts benign sanitizer fields that merely contain credential words", async () => {
    const inputs = {
      accessKeyframeId: "frame-1",
      maxTokens: 512,
      tokenCount: 12,
      wavespeedApiKeyEnabled: false,
      authorizationStatus: "approved",
      secretSceneDescription: "a hidden room",
    };
    const p = ports({
      sanitizer: { sanitize: vi.fn(() => ({ inputs })) },
    });

    await submitGeneration(draft(), p);

    expect(p.provider.submit).toHaveBeenCalledOnce();
    expect(p.provider.submit).toHaveBeenCalledWith(expect.objectContaining({ inputs }));
  });

  it("keeps reference uploads opaque in the submitted context", async () => {
    const p = ports();
    const input = draft({
      canonicalPrompt: "hello @{reference-2} @{reference-1}",
      referenceOverflowAcknowledged: true,
      references: [
        {
          key: "reference-1",
          mediaId: "ref-1",
          mediaVersionId: "v1",
          role: "reference-images",
          order: 2,
          canonicalTokens: ["@{reference-1}"],
          status: "active",
          value: "file:///tmp/ref-a.png",
        },
        {
          key: "reference-2",
          mediaId: "ref-2",
          mediaVersionId: "v2",
          role: "source-image",
          order: 1,
          canonicalTokens: ["@{reference-2}"],
          status: "active",
          value: "file:///tmp/ref-b.png",
        },
        {
          key: "reference-3",
          mediaId: "ref-3",
          mediaVersionId: "v3",
          role: "reference-images",
          order: 3,
          canonicalTokens: ["@{reference-3}"],
          status: "overflow",
          reason: "Only two references are allowed.",
          value: "file:///tmp/ref-c.png",
        },
      ],
    });

    const job = await submitGeneration(input, p);

    expect(job.context.references).toEqual([
      {
        id: "reference-2",
        order: 1,
        mediaId: "ref-2",
        versionId: "v2",
        origins: ["user"],
        active: true,
        state: "active",
        preparationStatus: "ready",
        errorHistory: [],
        uploadLeaseId: "ref-token",
      },
      {
        id: "reference-1",
        order: 2,
        mediaId: "ref-1",
        versionId: "v1",
        origins: ["user"],
        active: true,
        state: "active",
        preparationStatus: "ready",
        errorHistory: [],
        uploadLeaseId: "ref-token",
      },
    ]);
    expect(p.references?.uploadReference).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: "reference-2", mediaVersionId: "v2" }),
    );
    expect(p.references?.uploadReference).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ key: "reference-1", mediaVersionId: "v1" }),
    );
    expect(p.provider.submit).toHaveBeenCalledWith(expect.objectContaining({
      references: [
        expect.objectContaining({
          key: "reference-2",
          role: "source-image",
          order: 1,
          remoteInput: { kind: "upload-token", value: "ref-token" },
        }),
        expect.objectContaining({
          key: "reference-1",
          role: "reference-images",
          order: 2,
          remoteInput: { kind: "upload-token", value: "ref-token" },
        }),
      ],
    }));
    expect(JSON.stringify(job.context)).not.toContain("file:///tmp/ref.png");
    expect(JSON.stringify(job.context)).not.toContain("blob:");
    expect(JSON.stringify(job.context)).not.toContain("http://localhost");
  });

  it("requires overflow acknowledgement before any mutation", async () => {
    const p = ports();
    await expect(submitGeneration(draft({
      canonicalPrompt: "hello @{reference-1}",
      references: [{
        key: "reference-1",
        mediaId: "ref-1",
        mediaVersionId: "v1",
        role: "reference-images",
        order: 1,
        canonicalTokens: ["@{reference-1}"],
        status: "overflow",
        reason: "Only one reference is allowed.",
        value: "file:///tmp/ref.png",
      }],
    }), p)).rejects.toMatchObject({
      code: "invalid-draft",
      field: "references",
    });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
    expect(p.provider.submit).not.toHaveBeenCalled();
  });

  it("rejects cyclic references before any mutation", async () => {
    const p = ports();
    await expect(submitGeneration(draft({
      canonicalPrompt: "hello @{reference-1}",
      references: [{
        key: "reference-1",
        mediaId: "ref-1",
        mediaVersionId: "v1",
        role: "reference-images",
        order: 1,
        canonicalTokens: ["@{reference-1}"],
        status: "cyclic",
        reason: "This generated image would reference itself.",
        value: "file:///tmp/ref.png",
      }],
    }), p)).rejects.toMatchObject({
      code: "invalid-draft",
      field: "references.0.status",
    });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
    expect(p.provider.submit).not.toHaveBeenCalled();
  });

  it("reuses the retryable placeholder on retry instead of creating a duplicate", async () => {
    let first = true;
    const p = ports({
      references: {
        uploadReference: vi.fn(async () => {
          if (first) {
            first = false;
            throw new Error("upload down");
          }
          return { tokenId: "ref-token" };
        }),
      },
    });
    const input = draft({
      idempotencyKey: "retry-key",
      canonicalPrompt: "hello @{reference-1}",
      references: [{
        key: "reference-1",
        mediaId: "ref-1",
        mediaVersionId: "ref-version-1",
        role: "reference-images",
        order: 1,
        canonicalTokens: ["@{reference-1}"],
        status: "active",
        value: "file:///tmp/ref.png",
      }],
    });

    await expect(submitGeneration(input, p)).rejects.toMatchObject({
      code: "generation-reference-upload-failed",
    });
    await expect(submitGeneration(input, p)).resolves.toMatchObject({
      context: expect.objectContaining({ entryContext: { kind: "new-asset" } }),
    });
    expect(p.mutations.createPlaceholder).toHaveBeenCalledTimes(1);
  });
});
