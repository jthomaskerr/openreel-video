import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { test } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "wavespeed-route-"));
process.env.MV_GENERATION_DATA_DIR = dataDir;
process.env.ORCHESTRATOR_PORT = "0";

const { wavespeedRouter } = await import(`./wavespeed.js?${randomUUID()}`);

const app = express();
app.use("/api/generate/wavespeed", wavespeedRouter);

function invoke(method: string, url: string, headers: Record<string, string>, body: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
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
      getHeader() { return undefined; },
    } as any;
    (app as unknown as {
      handle: (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
    }).handle(req, res, (error?: unknown) => {
      if (error) reject(error);
      else resolve({ status: res.statusCode, body: undefined });
    });
  });
}

test("upload route rejects empty bodies", async () => {
  const response = await invoke("POST", "/api/generate/wavespeed/upload", {
    "content-type": "image/png",
    "x-project-id": "project-1",
    "x-user-id": "user-1",
  }, Buffer.alloc(0));

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "upload-empty" });
});

test("upload route rejects browser provider key headers before doing any work", async () => {
  const response = await invoke("POST", "/api/generate/wavespeed/upload", {
    "content-type": "image/png",
    "x-project-id": "project-1",
    "x-user-id": "user-1",
    "x-wavespeed-api-key": "secret",
  }, Buffer.from([1]));

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "provider-key-header-forbidden" });
});
