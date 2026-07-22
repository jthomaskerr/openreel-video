import { createDurableId, createInfrastructureNonce } from "@openreel/core/identity/durable-id";
import { mkdir, readFile, rename, rm, stat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { KeyedLock } from "./lock.js";

export interface UploadRecord { id: string; ownerId: string; projectId: string; mimeType: string; byteLength: number; createdAt: number; expiresAt: number; references: number; }
export interface UploadLease { id: string; uploadId: string; ownerId: string; projectId: string; expiresAt: number; }
export class UploadRepositoryError extends Error { constructor(readonly code: "upload-not-found" | "upload-forbidden" | "upload-expired" | "upload-corrupt", message = code) { super(message); this.name = "UploadRepositoryError"; } }
export class UploadRepository {
  private readonly lock = new KeyedLock();
  private readonly leases = new Map<string, UploadLease>();
  constructor(readonly directory: string, readonly maxBytes = 50 * 1024 * 1024, readonly now = () => Date.now()) {}
  private meta(id: string) { return join(this.directory, `${id}.json`); }
  private blob(id: string) { return join(this.directory, `${id}.bin`); }
  private async atomic(path: string, value: string | Uint8Array) {
    const tmp = `${path}.${createInfrastructureNonce()}.tmp`;
    const handle = await open(tmp, "w", 0o600);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await rename(tmp, path);
  }
  async create(input: { ownerId: string; projectId: string; mimeType: string; bytes: Uint8Array; ttlMs?: number }) {
    if (input.bytes.byteLength === 0) throw new Error("upload-empty");
    if (!/^image\/(png|jpeg|webp)|^video\/(mp4|webm)|^audio\/(wav|mpeg|mp4|webm)$/.test(input.mimeType)) throw new Error("upload-invalid-mime");
    if (input.bytes.byteLength > this.maxBytes) throw new Error("upload-too-large");
    await mkdir(this.directory, { recursive: true }); const id = createDurableId("upload"); const now = this.now();
    const record: UploadRecord = { id, ownerId: input.ownerId, projectId: input.projectId, mimeType: input.mimeType, byteLength: input.bytes.byteLength, createdAt: now, expiresAt: now + (input.ttlMs ?? 60 * 60 * 1000), references: 0 };
    try { await this.atomic(this.blob(id), input.bytes); await this.atomic(this.meta(id), JSON.stringify(record)); return record; }
    catch (cause) { await rm(this.blob(id), { force: true }); await rm(this.meta(id), { force: true }); throw cause; }
  }
  async get(id: string, ownerId: string, projectId: string) {
    try {
      const record = JSON.parse(await readFile(this.meta(id), "utf8")) as UploadRecord;
      if (!record || record.id !== id || !Number.isInteger(record.references) || record.references < 0) throw new UploadRepositoryError("upload-corrupt");
      if (record.ownerId !== ownerId || record.projectId !== projectId) throw new UploadRepositoryError("upload-forbidden");
      if (record.expiresAt <= this.now()) throw new UploadRepositoryError("upload-expired");
      return record;
    } catch (e) {
      if (e instanceof UploadRepositoryError) throw e;
      if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return undefined;
      throw new UploadRepositoryError("upload-corrupt");
    }
  }
  async bytes(id: string, ownerId: string, projectId: string) { const record = await this.get(id, ownerId, projectId); if (!record) return undefined; try { return await readFile(this.blob(id)); } catch { throw new UploadRepositoryError("upload-corrupt"); } }
  async retain(id: string, ownerId: string, projectId: string) {
    return this.lock.run(id, async () => {
      const record = await this.get(id, ownerId, projectId); if (!record) throw new UploadRepositoryError("upload-not-found");
      const next = { ...record, references: record.references + 1 }; await this.atomic(this.meta(id), JSON.stringify(next)); return next;
    });
  }
  async lease(id: string, ownerId: string, projectId: string): Promise<UploadLease> {
    const record = await this.retain(id, ownerId, projectId);
    const lease = { id: createDurableId("upload-lease"), uploadId: id, ownerId, projectId, expiresAt: record.expiresAt };
    this.leases.set(lease.id, lease);
    return lease;
  }
  async releaseLease(leaseId: string) {
    const lease = this.leases.get(leaseId); if (!lease) return;
    await this.lock.run(lease.uploadId, async () => {
      const record = await this.get(lease.uploadId, lease.ownerId, lease.projectId); if (!record) throw new UploadRepositoryError("upload-not-found");
      await this.atomic(this.meta(record.id), JSON.stringify({ ...record, references: Math.max(0, record.references - 1) }));
    });
    this.leases.delete(leaseId);
  }
  async release(id: string, ownerId: string, projectId: string) {
    await this.lock.run(id, async () => { const record = await this.get(id, ownerId, projectId); if (!record) throw new UploadRepositoryError("upload-not-found"); await this.atomic(this.meta(id), JSON.stringify({ ...record, references: Math.max(0, record.references - 1) })); });
  }
  async cleanup() { let removed = 0; await mkdir(this.directory, { recursive: true }); for (const name of await readdir(this.directory)) if (name.endsWith(".json")) { const id = name.slice(0, -5); await this.lock.run(id, async () => { let record: UploadRecord; try { record = JSON.parse(await readFile(this.meta(id), "utf8")) as UploadRecord; } catch { throw new UploadRepositoryError("upload-corrupt"); } if (!record || record.id !== id || !Number.isInteger(record.references) || record.references < 0) throw new UploadRepositoryError("upload-corrupt"); if (record.expiresAt <= this.now() && record.references === 0) { await rm(this.meta(id), { force: true }); await rm(this.blob(id), { force: true }); removed++; } }); } return removed; }
  async exists(id: string) { try { return (await stat(this.blob(id))).isFile(); } catch { return false; } }
}
