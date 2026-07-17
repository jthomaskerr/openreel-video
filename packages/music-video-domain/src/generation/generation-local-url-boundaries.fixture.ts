import { describe, expect, it } from "vitest";
import {
  serializeGenerationEvidenceManifest, serializeGenerationEvent, serializeGenerationFinalizationInput,
  serializeGenerationJob, serializeGenerationMutation, serializeGenerationOutput, serializeGenerationProject,
  serializeGenerationProvenance,
} from "./schemas.js";
import { makeJob, route } from "./generation-job-dispositions.fixture.js";

const provenance = { provider: "wavespeed" as const, modelId: "model-1", modelSchemaVersion: "v1", jobId: "job-1", routing: route, checkpoints: [], references: [] };
const opaqueBoundarySerializers = (value: string) => [
  ["job", () => serializeGenerationJob({ ...makeJob("queued"), providerInputs: { source: value } })],
  ["output", () => serializeGenerationOutput({ mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 0, sha256: value })],
  ["provenance", () => serializeGenerationProvenance({ ...provenance, sha256: value })],
  ["project", () => serializeGenerationProject({ projectId: "project-1", generationJobIds: [value], mediaIds: ["media-1"] })],
  ["mutation", () => serializeGenerationMutation({ projectId: "project-1", mutationId: "mutation-1", kind: "generation-finalize", payload: { source: value } })],
  ["event", () => serializeGenerationEvent({ projectId: "project-1", eventId: "event-1", type: "generation-finalized", payload: { source: value } })],
  ["evidence-manifest", () => serializeGenerationEvidenceManifest({ projectId: "project-1", jobId: "job-1", artifacts: [{ id: "artifact-1", uri: value }] })],
  ["finalization-input", () => serializeGenerationFinalizationInput({ projectId: "project-1", jobId: "job-1", providerJobId: "provider-1", output: { mediaId: "media-1", versionId: "version-1", mimeType: "video/mp4", byteLength: 0, sha256: value } })],
] as const;

describe("generation-local-url-boundaries.fixture", () => {
  it.each(["blob:https://example.test/a", "local:asset-1"]) ("rejects %s in every typed durable boundary with zero writes", (value) => {
    let writes = 0;
    for (const [boundary, serialize] of opaqueBoundarySerializers(value)) {
      expect(() => { serialize(); writes += 1; }, boundary).toThrow("generation-local-url-forbidden");
    }
    expect(writes).toBe(0);
  });

  it("serializes opaque IDs through every typed durable boundary", () => {
    for (const [boundary, serialize] of opaqueBoundarySerializers("opaque-id-1")) expect(serialize(), boundary).toContain("opaque-id-1");
  });
});
