import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ResolvedGenerationReference } from "../../../../packages/core/src/generation/references";
import express from "express";
import { Client } from "wavespeed";

const dataDir = mkdtempSync(join(tmpdir(), "wavespeed-route-"));
process.env.MV_GENERATION_DATA_DIR = dataDir;
process.env.ORCHESTRATOR_PORT = "0";
process.env.WAVESPEED_API_KEY = "test-wavespeed-key";

const { wavespeedRouter } = await import(`./wavespeed.js?${randomUUID()}`);

const app = express();
app.use("/api/generate/wavespeed", wavespeedRouter);

function invoke(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      originalUrl: url,
      headers,
      body,
      header(name: string) {
        return headers[name.toLowerCase()];
      },
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    } as any;

    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      end(payload?: unknown) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      setHeader() {},
      getHeader() {
        return undefined;
      },
    } as any;

    (
      app as unknown as {
        handle: (
          request: unknown,
          response: unknown,
          next: (error?: unknown) => void,
        ) => void;
      }
    ).handle(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ status: res.statusCode, body: undefined });
    });
  });
}

function makeReference(
  key: string,
  role: string,
  order: number,
  status: ResolvedGenerationReference["status"] = "active",
): ResolvedGenerationReference {
  return {
    key,
    mediaId: `${key}-media`,
    mediaVersionId: `${key}-version`,
    origins: ["source"],
    role,
    canonicalTokens: [`@{${key}}`],
    order,
    status,
  };
}

function makeContext(
  references: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    projectId: "project-1",
    target: {
      kind: "new-asset",
      placeholderMediaId: "placeholder-media-1",
    },
    references,
    placementPolicy: "none",
  };
}

function baseSubmitBody(overrides: Record<string, unknown> = {}) {
  return {
    id: `job-${randomUUID()}`,
    provider: "wavespeed",
    modelId: "fixture/reference-audio",
    modelSchemaVersion: "fixture",
    context: makeContext(),
    providerInputs: {
      prompt: "scene @{reference-2} @{reference-1}",
    },
    ...overrides,
  };
}

test("upload route rejects empty bodies", async () => {
  const response = await invoke(
    "POST",
    "/api/generate/wavespeed/upload",
    {
      "content-type": "image/png",
      "x-project-id": "project-1",
      "x-user-id": "user-1",
    },
    Buffer.alloc(0),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "upload-empty" });
});

test("upload route rejects browser provider key headers before doing any work", async () => {
  const response = await invoke(
    "POST",
    "/api/generate/wavespeed/upload",
    {
      "content-type": "image/png",
      "x-project-id": "project-1",
      "x-user-id": "user-1",
      "x-wavespeed-api-key": "browser-key",
    },
    Buffer.from([1]),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "provider-key-header-forbidden" });
});

test("submit route maps top-level references and reaches provider only after validation", async () => {
  const calls: Array<{ model: string; inputs: Record<string, unknown> }> = [];
  const originalSubmit = (Client as any).prototype._submit;
  (Client as any).prototype._submit = async function submit(
    model: string,
    inputs: Record<string, unknown>,
  ) {
    calls.push({ model, inputs });
    return ["provider-job-1"];
  };

  try {
    const response = await invoke(
      "POST",
      "/api/generate/wavespeed",
      { "content-type": "application/json" },
      baseSubmitBody({
        references: [
          makeReference("reference-1", "reference", 2),
          makeReference("reference-2", "reference", 1),
        ],
      }),
    );

    assert.equal(response.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "fixture/reference-audio");
    assert.deepEqual(calls[0].inputs.references, [1, 2]);
    assert.equal(calls[0].inputs.prompt, "scene");
  } finally {
    (Client as any).prototype._submit = originalSubmit;
  }
});

test("submit route rejects out-of-bounds reference counts before network", async () => {
  let submitCalls = 0;
  const originalSubmit = (Client as any).prototype._submit;
  (Client as any).prototype._submit = async function submit() {
    submitCalls += 1;
    return ["provider-job-1"];
  };

  try {
    const response = await invoke(
      "POST",
      "/api/generate/wavespeed",
      { "content-type": "application/json" },
      baseSubmitBody({
        references: [
          makeReference("reference-1", "reference", 1),
          makeReference("reference-2", "reference", 2),
          makeReference("reference-3", "reference", 3),
          makeReference("reference-4", "reference", 4),
        ],
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "references: reference-count-out-of-bounds",
    });
    assert.equal(submitCalls, 0);
  } finally {
    (Client as any).prototype._submit = originalSubmit;
  }
});

test("submit route rejects undocumented roles before network", async () => {
  let submitCalls = 0;
  const originalSubmit = (Client as any).prototype._submit;
  (Client as any).prototype._submit = async function submit() {
    submitCalls += 1;
    return ["provider-job-1"];
  };

  try {
    const response = await invoke(
      "POST",
      "/api/generate/wavespeed",
      { "content-type": "application/json" },
      baseSubmitBody({
        references: [makeReference("reference-1", "source", 1)],
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "references.reference-1.role: undocumented-field",
    });
    assert.equal(submitCalls, 0);
  } finally {
    (Client as any).prototype._submit = originalSubmit;
  }
});

test("submit route rejects unknown provider fields before network", async () => {
  let submitCalls = 0;
  const originalSubmit = (Client as any).prototype._submit;
  (Client as any).prototype._submit = async function submit() {
    submitCalls += 1;
    return ["provider-job-1"];
  };

  try {
    const response = await invoke(
      "POST",
      "/api/generate/wavespeed",
      { "content-type": "application/json" },
      baseSubmitBody({
        modelId: "fixture/tti",
        providerInputs: {
          prompt: "clean frame",
          rogue: true,
        },
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "invalid-provider-inputs:rogue:unknown-field",
    });
    assert.equal(submitCalls, 0);
  } finally {
    (Client as any).prototype._submit = originalSubmit;
  }
});

test("submit route rejects leaked local URLs before network", async () => {
  let submitCalls = 0;
  const originalSubmit = (Client as any).prototype._submit;
  (Client as any).prototype._submit = async function submit() {
    submitCalls += 1;
    return ["provider-job-1"];
  };

  try {
    const response = await invoke(
      "POST",
      "/api/generate/wavespeed",
      { "content-type": "application/json" },
      baseSubmitBody({
        modelId: "fixture/tti",
        providerInputs: {
          prompt: "http://localhost:4041/private",
        },
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "invalid-provider-inputs:prompt:forbidden-url",
    });
    assert.equal(submitCalls, 0);
  } finally {
    (Client as any).prototype._submit = originalSubmit;
  }
});
