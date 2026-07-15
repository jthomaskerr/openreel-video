import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGenerationSubmissionInflight,
  submitGeneration,
  type GenerationDraft,
  type SubmitGenerationPorts,
} from "./submit-generation";
import { createGenerationSubmissionDraftCache } from "./drafts/cache";

function draft(overrides: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    projectId: "p1",
    provider: "wavespeed",
    modelId: "m1",
    modelSchemaVersion: "s1",
    target: { kind: "new-version", sourceMediaId: "source-1" },
    context: {
      projectId: "p1",
      shotId: "shot-1",
      clipId: "clip-1",
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
          target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" },
        }),
      }),
    );
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
          target: expect.objectContaining({
            kind: "new-version",
            sourceMediaId: "explicit-source",
          }),
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
          references: [{ mediaId: "ref-1", value: "file:///tmp/ref.png" }],
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
      error: { code: "generation-reference-upload-failed", retryable: true },
    });
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
    expect(draftCache?.get).not.toHaveBeenCalled();
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

  it("keeps reference uploads opaque in the submitted context", async () => {
    const p = ports();
    const input = draft({
      references: [{ mediaId: "ref-1", versionId: "v1", value: "file:///tmp/ref.png" }],
    });

    const job = await submitGeneration(input, p);

    expect(job.context.references).toEqual([
      {
        mediaId: "ref-1",
        versionId: "v1",
        origins: ["user"],
        remoteInput: { kind: "upload-token", value: "ref-token" },
      },
    ]);
    expect(JSON.stringify(job.context)).not.toContain("file:///tmp/ref.png");
    expect(JSON.stringify(job.context)).not.toContain("blob:");
    expect(JSON.stringify(job.context)).not.toContain("http://localhost");
  });
});
