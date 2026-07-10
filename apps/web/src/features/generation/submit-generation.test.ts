import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearGenerationSubmissionInflight, submitGeneration, type GenerationDraft, type SubmitGenerationPorts } from "./submit-generation";

const draft = (): GenerationDraft => ({ projectId: "p1", provider: "wavespeed", modelId: "m1", modelSchemaVersion: "s1", target: { kind: "new-version", sourceMediaId: "source-1" }, context: { projectId: "p1", references: [], placementPolicy: "none" }, providerInputs: { prompt: "hello", keep: false } });
function ports(overrides: Partial<SubmitGenerationPorts> = {}): SubmitGenerationPorts {
  return {
    mutations: { createPlaceholder: vi.fn(async () => "placeholder-1"), markPlaceholderFailed: vi.fn(async () => {}) },
    references: { uploadReference: vi.fn(async () => ({ tokenId: "ref-token" })) },
    audio: { uploadAudio: vi.fn(async () => ({ tokenId: "audio-token" })) },
    provider: { submit: vi.fn(async () => ({ providerJobId: "provider-1" })) },
    cache: { put: vi.fn(async () => {}) },
    sanitizer: { sanitize: vi.fn(({ draft: value }) => ({ inputs: value.providerInputs })) },
    clock: { now: vi.fn(() => 1000) }, ids: { next: vi.fn((prefix) => `${prefix}-1`) }, ...overrides,
  };
}

describe("submitGeneration", () => {
  beforeEach(() => clearGenerationSubmissionInflight());
  it("creates one placeholder and submits exact placeholder target", async () => {
    const p = ports(); const job = await submitGeneration(draft(), p);
    expect(p.mutations.createPlaceholder).toHaveBeenCalledTimes(1);
    expect(p.provider.submit).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ target: { kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" } }) }));
    expect(job.context.target).toEqual({ kind: "new-version", sourceMediaId: "source-1", placeholderMediaId: "placeholder-1" });
  });
  it("deduplicates concurrent and replayed submissions", async () => {
    const p = ports(); const first = submitGeneration(draft(), p); const second = submitGeneration(draft(), p);
    expect(await first).toBe(await second); expect(p.provider.submit).toHaveBeenCalledTimes(1);
  });
  it("marks placeholder failed when reference upload fails", async () => {
    const p = ports({ references: { uploadReference: vi.fn(async () => { throw new Error("upload down"); }) } });
    await expect(submitGeneration({ ...draft(), references: [{ mediaId: "r1" }] }, p)).rejects.toMatchObject({ code: "generation-reference-upload-failed" });
    expect(p.mutations.markPlaceholderFailed).toHaveBeenCalledWith(expect.objectContaining({ placeholderMediaId: "placeholder-1", error: expect.objectContaining({ code: "generation-reference-upload-failed" }) }));
  });
  it("requires explicit support for optional audio and never silently drops it", async () => {
    const p = ports({ audio: undefined });
    await expect(submitGeneration({ ...draft(), audio: { value: new Uint8Array([1]) } }, p)).rejects.toMatchObject({ code: "generation-audio-upload-failed" });
    expect(p.mutations.markPlaceholderFailed).toHaveBeenCalled(); expect(p.provider.submit).not.toHaveBeenCalled();
  });
  it("rejects invalid drafts before mutating", async () => {
    const p = ports(); await expect(submitGeneration({ ...draft(), projectId: "" }, p)).rejects.toMatchObject({ code: "invalid-draft" });
    expect(p.mutations.createPlaceholder).not.toHaveBeenCalled();
  });
  it("compensates provider and cache failures", async () => {
    const p = ports({ provider: { submit: vi.fn(async () => { throw new Error("provider"); }) } });
    await expect(submitGeneration(draft(), p)).rejects.toMatchObject({ code: "generation-provider-submit-failed" });
    expect(p.mutations.markPlaceholderFailed).toHaveBeenCalled();
  });
});
