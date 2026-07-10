import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileGenerationJobRepository } from "./repository.js";
const job = (id: string) => ({ schemaVersion: 2 as const, id, provider: "wavespeed", modelId: "m", modelSchemaVersion: "s", status: "queued" as const, createdAt: 1, updatedAt: 1, context: { projectId: "p", target: { kind: "new-asset" as const, placeholderMediaId: "ph" }, references: [], placementPolicy: "none" as const }, providerInputs: {}, attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1 }], checkpoints: {} });
test("repository survives a second instance and writes valid JSON", async () => { const dir = await mkdtemp(join(tmpdir(), "generation-repo-")); const first = new FileGenerationJobRepository(dir); await first.create(job("j1")); const second = new FileGenerationJobRepository(dir); assert.equal((await second.get("j1"))?.id, "j1"); assert.deepEqual(JSON.parse(await readFile(join(dir, "j1.json"), "utf8")), job("j1")); });
test("provider completion identity is conflict-safe", async () => { const dir = await mkdtemp(join(tmpdir(), "generation-repo-")); const repo = new FileGenerationJobRepository(dir); await repo.create(job("j1")); await assert.rejects(repo.create({ ...job("j2"), attempts: [{ attemptNumber: 1, providerJobId: "provider-1", startedAt: 1 }] }), /generation-provider-id-conflict/); });
