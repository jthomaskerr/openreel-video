import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { GenerationJob } from "@openreel/music-video-domain/generation";
import {
  applyGenerationReferenceCommand,
  createGenerationReferenceRecoveryState,
} from "../features/generation/drafts/v2.js";
import type { GenerationDraft } from "../features/generation/submit-generation.js";
import {
  buildWaveSpeedGenerationDraft,
  createProductionGenerationRuntime,
  prepareWaveSpeedProjectionAudio,
  prepareWaveSpeedGenerationDraft,
  type WaveSpeedGenerationCapabilities,
} from "./generation-job-store.js";

const route = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "wavespeed/model",
  requestedMode: "text-to-image" as const,
  providerSchemaId: "wavespeed-request",
  providerEndpointId: "wavespeed-submit",
  providerSchemaVersion: "2026-07",
  output: "image" as const,
  supportsAudio: false,
};

function serverJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  const identity = {
    providerInstanceId: route.providerInstanceId,
    providerModelId: route.providerModelId,
    requestedMode: route.requestedMode,
    providerSchemaId: route.providerSchemaId,
    providerEndpointId: route.providerEndpointId,
    providerSchemaVersion: route.providerSchemaVersion,
  };
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id: "logical-job-1",
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: route.providerInstanceId,
    modelId: route.providerModelId,
    modelSchemaVersion: route.providerSchemaVersion,
    routing: identity,
    providerJobId: "provider-job-9",
    status: "running",
    attempt: 1,
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      placementPolicy: "none",
      prompt: "typed prompt",
      references: [],
    },
    providerInputs: { seed: 0 },
    attempts: [{ attemptNumber: 1, routing: identity, providerJobId: "provider-job-9", startedAt: 10 }],
    checkpoints: {},
    createdAt: 10,
    updatedAt: 11,
    ...overrides,
  };
}

function capabilities(releaseEnabled = true): WaveSpeedGenerationCapabilities {
  return {
    configured: true,
    generationV2ReleaseEnabled: releaseEnabled,
    providerInstanceId: route.providerInstanceId,
    routes: [route],
  };
}

function draft(): GenerationDraft {
  return buildWaveSpeedGenerationDraft({
    projectId: "project-1",
    route,
    entryContext: { kind: "new-asset" },
    prompt: "typed prompt",
    target: { kind: "new-asset" },
    providerInputs: { seed: 0 },
  });
}

test("production runtime defaults to the same-origin authenticated application boundary", async () => {
  const urls: string[] = [];
  const runtime = createProductionGenerationRuntime({
    fetch: async (input) => {
      urls.push(String(input));
      return Response.json(capabilities());
    },
  });

  await runtime.readCapabilities();
  assert.deepEqual(urls, ["/api/generate/wavespeed/config"]);
});

test("the dev same-origin API proxy injects application auth without a client-exposed token", async () => {
  const config = await readFile(new URL("../../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /loadEnv/);
  assert.match(config, /ORCHESTRATOR_AUTH_TOKEN/);
  assert.match(config, /proxy:\s*\{/);
  assert.match(config, /Authorization/);
  assert.match(config, /preview:\s*\{[\s\S]*proxy:/);
  assert.doesNotMatch(config, /VITE_ORCHESTRATOR_AUTH_TOKEN/);
});

test("one production controller posts the predeclared logical job ID and preserves provider identity", async () => {
  const calls: Array<{ url: string; init?: RequestInit; body?: any }> = [];
  const authoritative = serverJob();
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    if (url.endsWith("/config")) return Response.json(capabilities());
    if (url.endsWith("/api/generate/wavespeed/")) {
      assert.equal(body.jobId, "logical-job-1");
      assert.equal(body.projectId, "project-1");
      assert.deepEqual(body.routing, {
        providerInstanceId: route.providerInstanceId,
        providerModelId: route.providerModelId,
        requestedMode: route.requestedMode,
        providerSchemaId: route.providerSchemaId,
        providerEndpointId: route.providerEndpointId,
        providerSchemaVersion: route.providerSchemaVersion,
      });
      return Response.json({ job: authoritative }, { status: 202 });
    }
    throw new Error(`unexpected request ${url}`);
  };
  let placeholderCalls = 0;
  const runtime = createProductionGenerationRuntime({
    baseUrl: "http://orchestrator/api/generate/wavespeed",
    fetch: fakeFetch,
    nextId: (kind) => kind === "job" ? "logical-job-1" : "placeholder-1",
    now: () => 10,
    mutations: {
      createPlaceholder: async ({ target }) => {
        placeholderCalls += 1;
        return { placeholderMediaId: target.placeholderMediaId };
      },
      markPlaceholderFailed: async () => {},
    },
  });

  const [first, second] = await Promise.all([
    runtime.controller.submit(draft()),
    runtime.controller.submit(draft()),
  ]);

  assert.deepEqual(first, authoritative);
  assert.deepEqual(second, authoritative);
  assert.equal(first.id, "logical-job-1");
  assert.equal(first.providerJobId, "provider-job-9");
  assert.equal(placeholderCalls, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/generate/wavespeed/")).length, 1);
});

test("rollback fails closed before placeholder creation and provider reservation", async () => {
  let placeholderCalls = 0;
  let submitCalls = 0;
  const runtime = createProductionGenerationRuntime({
    baseUrl: "http://orchestrator/api/generate/wavespeed",
    fetch: async (input) => {
      if (String(input).endsWith("/config")) return Response.json(capabilities(false));
      submitCalls += 1;
      return Response.json({ job: serverJob() }, { status: 202 });
    },
    mutations: {
      createPlaceholder: async () => { placeholderCalls += 1; return { placeholderMediaId: "placeholder-1" }; },
      markPlaceholderFailed: async () => {},
    },
  });

  await assert.rejects(runtime.controller.submit(draft()), /generation-v2-rollback-active/);
  assert.equal(placeholderCalls, 0);
  assert.equal(submitCalls, 0);
});

test("submission refreshes rollback capabilities before every browser mutation", async () => {
  let capabilityReads = 0;
  let placeholderCalls = 0;
  let submitCalls = 0;
  const runtime = createProductionGenerationRuntime({
    baseUrl: "http://orchestrator/api/generate/wavespeed",
    nextId: (() => {
      let next = 0;
      return (kind) => `${kind}-${++next}`;
    })(),
    fetch: async (input) => {
      if (String(input).endsWith("/config")) {
        capabilityReads += 1;
        return Response.json(capabilities(capabilityReads === 1));
      }
      submitCalls += 1;
      return Response.json({ job: serverJob({ id: `job-${submitCalls}` }) }, { status: 202 });
    },
    mutations: {
      createPlaceholder: async ({ target }) => {
        placeholderCalls += 1;
        return { placeholderMediaId: target.placeholderMediaId };
      },
      markPlaceholderFailed: async () => {},
    },
  });

  await runtime.readCapabilities({ refresh: true });
  await assert.rejects(
    runtime.controller.submit({ ...draft(), idempotencyKey: "second-draft", context: { ...draft().context, prompt: "second" } }),
    /generation-v2-rollback-active/,
  );
  assert.equal(capabilityReads, 2);
  assert.equal(placeholderCalls, 0);
  assert.equal(submitCalls, 0);
});

test("authoritative recovery commands hydrate the full returned job and use the logical ID", async () => {
  const recovered = serverJob({ status: "succeeded", output: { mediaId: "media-1", versionId: "version-1", mimeType: "image/png", byteLength: 3, sha256: "abc" } });
  const urls: string[] = [];
  const runtime = createProductionGenerationRuntime({
    baseUrl: "http://orchestrator/api/generate/wavespeed",
    fetch: async (input) => {
      urls.push(String(input));
      return Response.json({ job: recovered });
    },
  });

  const result = await runtime.command("reconcile-placement", serverJob({
    status: "needs-attention",
    context: { ...serverJob().context, placementPolicy: "replace-selected-clip-media", entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-1", startTime: 0, endTime: 1 } },
    output: recovered.output,
    error: { code: "generation-placement-outcome-unknown", message: "unknown", retryable: true },
    checkpoints: { "placement-applied": { status: "failed", timestamp: 12, error: { code: "generation-placement-outcome-unknown", message: "unknown", retryable: true } } },
  }));

  assert.deepEqual(result, recovered);
  assert.equal(urls[0], "http://orchestrator/api/generate/wavespeed/logical-job-1/reconcile-placement");
});

test("recovery rejects a returned job from another project before hydration", async () => {
  const runtime = createProductionGenerationRuntime({
    baseUrl: "http://orchestrator/api/generate/wavespeed",
    fetch: async () => Response.json({
      job: serverJob({
        projectId: "project-2",
        context: { ...serverJob().context, projectId: "project-2" },
      }),
    }),
  });

  await assert.rejects(
    runtime.command("cancel", serverJob()),
    /generation-status-ownership-mismatch/,
  );
});

test("production reference recovery retries, deactivates, and removes in place without provider submission", async () => {
  const calls: string[] = [];
  const released: string[] = [];
  const runtime = createProductionGenerationRuntime({
    baseUrl: "http://orchestrator/api/generate/wavespeed",
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/upload")) {
        return Response.json({ uploadId: "lease-new" }, { status: 201 });
      }
      throw new Error(`provider submission is forbidden during reference recovery: ${url}`);
    },
    referenceRecovery: {
      releaseUploadLease: async ({ tokenId }) => { released.push(tokenId); },
    },
  });
  const priorError = {
    code: "generation-reference-upload-failed",
    message: "prior upload failed",
    field: "references.ref-a.value",
    retryable: true,
  };
  const initial = createGenerationReferenceRecoveryState({
    projectId: "project-1",
    jobId: "logical-job-1",
    references: [
      {
        id: "ref-a",
        order: 1,
        mediaId: "media-a",
        origins: ["user"],
        state: "failed",
        preparationStatus: "failed",
        errorHistory: [priorError],
        uploadLeaseId: "lease-old",
      },
      {
        id: "ref-b",
        order: 2,
        mediaId: "media-b",
        origins: ["shot"],
        state: "active",
        preparationStatus: "ready",
        errorHistory: [],
        uploadLeaseId: "lease-b",
      },
    ],
    drafts: [
      {
        id: "ref-a",
        mediaId: "media-a",
        origins: ["user"],
        value: {
          projectId: "project-1",
          body: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
        },
      },
      { id: "ref-b", mediaId: "media-b", origins: ["shot"] },
    ],
  });

  const retried = await applyGenerationReferenceCommand(initial, {
    action: "retry",
    projectId: "project-1",
    jobId: "logical-job-1",
    referenceId: "ref-a",
  }, runtime.referenceRecovery);
  assert.deepEqual(retried.references.map((reference) => reference.id), ["ref-a", "ref-b"]);
  assert.equal(retried.references[0].uploadLeaseId, "lease-new");
  assert.equal(retried.references[0].errorHistory[0], priorError);
  assert.deepEqual(retried.providerReferences.map((reference) => [reference.id, reference.order]), [["ref-a", 1], ["ref-b", 2]]);

  const deactivated = await applyGenerationReferenceCommand(retried, {
    action: "deactivate",
    projectId: "project-1",
    jobId: "logical-job-1",
    referenceId: "ref-a",
  }, runtime.referenceRecovery);
  assert.deepEqual(deactivated.references.map((reference) => reference.id), ["ref-a", "ref-b"]);
  assert.deepEqual(deactivated.providerReferences.map((reference) => [reference.id, reference.order]), [["ref-b", 1]]);

  const removed = await applyGenerationReferenceCommand(deactivated, {
    action: "remove",
    projectId: "project-1",
    jobId: "logical-job-1",
    referenceId: "ref-a",
  }, runtime.referenceRecovery);
  assert.deepEqual(removed.references.map((reference) => reference.id), ["ref-b"]);
  assert.deepEqual(removed.drafts.map((reference) => reference.id), ["ref-b"]);
  assert.deepEqual(released, ["lease-old", "lease-new"]);
  assert.deepEqual(calls, ["http://orchestrator/api/generate/wavespeed/upload"]);
});

test("shared dialog and inspector preparation exposes every canonical placement default", () => {
  const cases = [
    [{ kind: "new-asset" as const }, "none"],
    [{ kind: "unplaced-shot" as const, shotId: "shot-1" }, "none"],
    [{ kind: "unlinked-range" as const, rangeId: "range-1", startTime: 1, endTime: 2 }, "create-linked-clip"],
    [{ kind: "linked-projection" as const, shotId: "shot-1", clipId: "clip-1", startTime: 1, endTime: 2 }, "replace-selected-clip-media"],
  ] as const;

  for (const [entryContext, expectedDefault] of cases) {
    const prepared = prepareWaveSpeedGenerationDraft({
      projectId: "project-1",
      route: { ...route, supportsAudio: entryContext.kind === "linked-projection" },
      entryContext,
      prompt: "typed prompt",
      target: { kind: "new-asset" },
      providerInputs: {},
      placementPolicy: "none",
    });
    assert.equal(prepared.entryContextResult.defaultPlacementPolicy, expectedDefault);
    assert.equal(prepared.draft.context.placementPolicy, "none");
  }
});

test("audio preparation is projection-only and carries exact selected ranges", () => {
  const audio = {
    value: { projectId: "project-1", body: new Uint8Array([1, 2]), mimeType: "audio/wav" },
    sourceMediaId: "audio-1",
    sourceVersionId: "audio-v1",
    sourceClipId: "audio-clip-1",
    projectStartSeconds: 4,
    projectEndSeconds: 6,
    sourceStartSeconds: 2,
    sourceEndSeconds: 4,
    mimeType: "audio/wav",
    sha256: "audio-sha",
  };
  const prepared = prepareWaveSpeedGenerationDraft({
    projectId: "project-1",
    route: { ...route, requestedMode: "text-to-video", output: "video", supportsAudio: true },
    entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-1", startTime: 4, endTime: 6 },
    prompt: "typed prompt",
    target: { kind: "new-asset" },
    providerInputs: {},
    audio,
  });
  assert.equal(prepared.entryContextResult.audioEligible, true);
  assert.equal(prepared.draft.context.audioAssetId, "audio-1");
  assert.deepEqual(prepared.draft.context.audioRange, { startTime: 4, endTime: 6 });
  assert.throws(() => prepareWaveSpeedGenerationDraft({
    projectId: "project-1",
    route,
    entryContext: { kind: "new-asset" },
    prompt: "typed prompt",
    target: { kind: "new-asset" },
    providerInputs: {},
    audio,
  }), /generation-audio-not-allowed/);
});

test("live projection audio resolves one exact project source and hashes its bytes", async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
  const result = await prepareWaveSpeedProjectionAudio({
    projectId: "project-1",
    supportsAudio: true,
    entryContext: { kind: "linked-projection", shotId: "shot-1", clipId: "clip-1", startTime: 4, endTime: 6 },
    tracks: [{
      id: "audio-track",
      type: "audio",
      muted: false,
      hidden: false,
      clips: [{ id: "audio-clip", mediaId: "audio-version", startTime: 0, duration: 10, inPoint: 1, outPoint: 11, speed: 1, muted: false }],
    }],
    media: [{
      id: "audio-version",
      assetGroupId: "audio-media",
      type: "audio",
      blob,
      metadata: { codec: "audio/wav", channels: 2, sampleRate: 48_000 },
    }],
  });

  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") throw new Error("projection audio was not prepared");
  assert.equal(result.audio.sourceMediaId, "audio-media");
  assert.equal(result.audio.sourceVersionId, "audio-version");
  assert.equal(result.audio.sourceClipId, "audio-clip");
  assert.deepEqual(
    [result.audio.projectStartSeconds, result.audio.projectEndSeconds, result.audio.sourceStartSeconds, result.audio.sourceEndSeconds],
    [4, 6, 5, 7],
  );
  assert.match(result.audio.sha256 ?? "", /^[a-f0-9]{64}$/);
});

test("audio preparation performs zero work outside an eligible linked projection", async () => {
  let reads = 0;
  const result = await prepareWaveSpeedProjectionAudio({
    projectId: "project-1",
    supportsAudio: true,
    entryContext: { kind: "new-asset" },
    tracks: [],
    media: [],
    fetch: async () => { reads += 1; throw new Error("must not fetch"); },
  });
  assert.equal(result.kind, "zero-work");
  assert.equal(reads, 0);
});
