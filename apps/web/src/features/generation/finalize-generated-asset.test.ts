import { describe, expect, it, vi } from "vitest";
import type { ActionResult, MediaItem, Project } from "@openreel/core";
import {
  appendGeneratedShotAttempt,
  finalizeGeneratedAsset,
  type GeneratedAssetFinalizationStore,
} from "./finalize-generated-asset";

function media(id: string, assetGroupId?: string): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 10,
      height: 10,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
    thumbnailUrl: null,
    assetGroupId,
    isCurrent: true,
  };
}

function project(
  items: MediaItem[] = [media("placeholder")],
  generatedImageDefinitions: Project["generatedImageDefinitions"] = [],
): Project {
  return {
    id: "project",
    name: "test",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1,
      height: 1,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: { items },
    generatedImageDefinitions,
    timeline: { tracks: [], duration: 0, markers: [], subtitles: [] },
  };
}

function ok(actionId: string, replayed = false): ActionResult & { replayed?: boolean } {
  return {
    success: true,
    actionId,
    ...(replayed ? { replayed: true } : {}),
  };
}

describe("finalizeGeneratedAsset", () => {
  it("finalizes a new asset placeholder and appends one shot attempt with stable keys", async () => {
    const store: GeneratedAssetFinalizationStore = {
      project: project(),
      finalizePlaceholder: vi.fn(async () => ok("finalize")),
      appendShotAttempt: vi.fn(async () => ok("shot")),
    };

    const result = await finalizeGeneratedAsset(store, {
      target: { kind: "new-asset", placeholderMediaId: "placeholder" },
      item: media("placeholder"),
      blob: new Blob(["x"]),
      jobId: "job-1",
      shotId: "shot-1",
      attempt: { number: 1 },
    });

    expect(result).toEqual({
      success: true,
      mediaId: "placeholder",
      shotLinked: true,
      replayed: false,
    });
    expect(store.finalizePlaceholder).toHaveBeenCalledTimes(1);
    expect(store.finalizePlaceholder).toHaveBeenCalledWith(
      expect.objectContaining({
        placeholderMediaId: "placeholder",
        idempotencyKey: "generation-finalize:job-1:new-asset",
      }),
    );
    expect(store.appendShotAttempt).toHaveBeenCalledTimes(1);
    expect(store.appendShotAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        shotId: "shot-1",
        generatedMediaId: "placeholder",
        idempotencyKey: "generation-shot:job-1:shot-1",
      }),
    );
  });

  it("finalizes a new immutable version in the explicit source group", async () => {
    const definition = {
      id: "definition-1",
      projectId: "project",
      assetGroupId: "source-group",
      currentMediaVersionId: "source-v1",
      sourceMediaVersionId: "source-v1",
      title: "Generated still",
      draft: {
        prompt: "storm",
        roleByReferenceKey: {},
        inputs: {},
      },
      attemptIds: ["attempt-1"],
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    } satisfies Project["generatedImageDefinitions"][number];
    const store: GeneratedAssetFinalizationStore = {
      project: project([media("placeholder"), media("source-v1", "source-group")], [definition]),
      finalizeVersion: vi.fn(async () => ok("finalize-version")),
    };

    const result = await finalizeGeneratedAsset(store, {
      target: {
        kind: "new-version",
        sourceMediaId: "source-v1",
        placeholderMediaId: "placeholder",
      },
      item: {
        ...media("version-v2"),
        generationMeta: {
          provider: "wavespeed",
          model: "fixture/reference-audio",
          prompt: "storm",
          inputs: { seed: 7 },
          jobId: "job-2",
          status: "completed",
        },
      },
      blob: new Blob(["x"]),
      jobId: "job-2",
      attempt: { id: "attempt-2", number: 2 },
    });

    expect(result).toEqual({
      success: true,
      mediaId: "placeholder",
      shotLinked: false,
      replayed: false,
    });
    expect(store.finalizeVersion).toHaveBeenCalledTimes(1);
    expect(store.finalizeVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMediaId: "source-v1",
        placeholderMediaId: "placeholder",
        idempotencyKey: "generation-finalize:job-2:new-version",
      }),
    );
    expect(store.project.generatedImageDefinitions[0]).toMatchObject({
      currentMediaVersionId: "placeholder",
      sourceMediaVersionId: "source-v1",
      attemptIds: ["attempt-1", "attempt-2"],
    });
    expect(store.project.mediaLibrary.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "placeholder",
        assetGroupId: "source-group",
        isCurrent: true,
        generationMeta: expect.objectContaining({
          provider: "wavespeed",
          model: "fixture/reference-audio",
          jobId: "job-2",
        }),
      }),
      expect.objectContaining({
        id: "source-v1",
        assetGroupId: "source-group",
        isCurrent: false,
      }),
    ]));
  });

  it("replays duplicate keys without appending a second shot attempt", async () => {
    let finalizeCalls = 0;
    let shotCalls = 0;
    const store: GeneratedAssetFinalizationStore = {
      project: project(),
      finalizePlaceholder: vi.fn(async () => {
        finalizeCalls += 1;
        return {
          success: true,
          actionId: `finalize-${finalizeCalls}`,
          ...(finalizeCalls > 1 ? { replayed: true } : {}),
        } satisfies ActionResult & { replayed?: boolean };
      }),
      appendShotAttempt: vi.fn(async () => {
        shotCalls += 1;
        return {
          success: true,
          actionId: `shot-${shotCalls}`,
          ...(shotCalls > 1 ? { replayed: true } : {}),
        } satisfies ActionResult & { replayed?: boolean };
      }),
    };

    const input = {
      target: { kind: "new-asset" as const, placeholderMediaId: "placeholder" },
      item: media("placeholder"),
      blob: new Blob(["x"]),
      jobId: "job-3",
      shotId: "shot-3",
      attempt: { number: 1 },
    };

    const first = await finalizeGeneratedAsset(store, input);
    const second = await finalizeGeneratedAsset(store, input);

    expect(first).toMatchObject({
      success: true,
      shotLinked: true,
      replayed: false,
    });
    expect(second).toMatchObject({
      success: true,
      shotLinked: true,
      replayed: true,
    });
    expect(store.finalizePlaceholder).toHaveBeenCalledTimes(2);
    expect(store.appendShotAttempt).toHaveBeenCalledTimes(2);
    expect(store.finalizePlaceholder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "generation-finalize:job-3:new-asset",
      }),
    );
    expect(store.appendShotAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "generation-shot:job-3:shot-3",
      }),
    );
  });

  it("does not append a duplicate definition attempt when finalization replays", async () => {
    const store: GeneratedAssetFinalizationStore = {
      project: project([media("placeholder")], [{
        id: "definition-1",
        projectId: "project",
        assetGroupId: "placeholder-group",
        currentMediaVersionId: "placeholder",
        sourceMediaVersionId: "placeholder",
        title: "Generated still",
        draft: {
          prompt: "storm",
          roleByReferenceKey: {},
          inputs: {},
        },
        attemptIds: ["attempt-1"],
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }]),
      finalizePlaceholder: vi.fn(async () => ok("finalize", true)),
    };

    const input = {
      target: { kind: "new-asset" as const, placeholderMediaId: "placeholder" },
      item: {
        ...media("placeholder", "placeholder-group"),
        generationMeta: {
          provider: "wavespeed",
          model: "fixture/tti",
          prompt: "storm",
          inputs: { seed: 7 },
          jobId: "job-5",
          status: "completed",
        },
      },
      blob: new Blob(["x"]),
      jobId: "job-5",
      attempt: { id: "attempt-1", number: 1 },
    };

    const first = await finalizeGeneratedAsset(store, input);
    const second = await finalizeGeneratedAsset(store, input);

    expect(first).toMatchObject({ success: true });
    expect(second).toMatchObject({ success: true, replayed: true });
    expect(store.project.generatedImageDefinitions[0].attemptIds).toEqual(["attempt-1"]);
  });

  it("returns an action failure when shot linkage is requested but the store cannot append it", async () => {
    const store: GeneratedAssetFinalizationStore = {
      project: project(),
      finalizePlaceholder: vi.fn(async () => ok("finalize")),
    };

    const result = await finalizeGeneratedAsset(store, {
      target: { kind: "new-asset", placeholderMediaId: "placeholder" },
      item: media("placeholder"),
      blob: new Blob(["x"]),
      jobId: "job-4",
      shotId: "shot-4",
      attempt: { number: 1 },
    });

    expect(result).toEqual({
      success: false,
      mediaId: "placeholder",
      shotLinked: false,
      replayed: false,
      error: {
        code: "ACTION_FAILED",
        message: "Store does not expose shot mutation",
      },
    });
  });
});

describe("appendGeneratedShotAttempt", () => {
  it("uses a stable key and reports replayed actions", async () => {
    const store: GeneratedAssetFinalizationStore = {
      project: project(),
      appendShotAttempt: vi.fn(async () =>
        ({
          success: true,
          actionId: "shot-1",
          replayed: true,
        }) satisfies ActionResult & { replayed?: boolean },
      ),
    };

    const result = await appendGeneratedShotAttempt(store, {
      shotId: "shot-1",
      generatedMediaId: "placeholder",
      attempt: { number: 1 },
      jobId: "job-5",
    });

    expect(result).toEqual({ success: true, replayed: true });
    expect(store.appendShotAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        shotId: "shot-1",
        generatedMediaId: "placeholder",
        idempotencyKey: "generation-shot:job-5:shot-1",
      }),
    );
  });
});
