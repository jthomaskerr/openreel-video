import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface UploadRecord { id: string; ownerId: string; projectId: string; mimeType: string; byteLength: number; createdAt: number; expiresAt: number; references: number; }
export class UploadRepository {
  constructor(readonly directory: string, readonly maxBytes = 50 * 1024 * 1024, readonly now = () => Date.now()) {}
  private meta(id: string) { return join(this.directory, `${id}.json`); }
  private blob(id: string) { return join(this.directory, `${id}.bin`); }
  async create(input: { ownerId: string; projectId: string; mimeType: string; bytes: Uint8Array; ttlMs?: number }) {
    if (input.bytes.byteLength === 0) throw new Error("upload-empty");
    if (!/^image\/(png|jpeg|webp)|^video\/(mp4|webm)|^audio\/(wav|mpeg|mp4|webm)$/.test(input.mimeType)) throw new Error("upload-invalid-mime");
    if (input.bytes.byteLength > this.maxBytes) throw new Error("upload-too-large");
    await mkdir(this.directory, { recursive: true }); const id = `upl_${randomUUID()}`; const now = this.now();
    const record: UploadRecord = { id, ownerId: input.ownerId, projectId: input.projectId, mimeType: input.mimeType, byteLength: input.bytes.byteLength, createdAt: now, expiresAt: now + (input.ttlMs ?? 60 * 60 * 1000), references: 0 };
    await writeFile(this.blob(id), input.bytes, { mode: 0o600 }); await writeFile(this.meta(id), JSON.stringify(record), { mode: 0o600 }); return record;
  }
  async get(id: string, ownerId: string, projectId: string) {
    try { const record = JSON.parse(await readFile(this.meta(id), "utf8")) as UploadRecord; if (record.ownerId !== ownerId || record.projectId !== projectId) throw new Error("upload-forbidden"); if (record.expiresAt <= this.now()) throw new Error("upload-expired"); return record; } catch (e) { if (e instanceof Error && e.message.startsWith("upload-")) throw e; return undefined; }
  }
  async bytes(id: string, ownerId: string, projectId: string) { const record = await this.get(id, ownerId, projectId); if (!record) return undefined; return readFile(this.blob(id)); }
  async retain(id: string, ownerId: string, projectId: string) { const record = await this.get(id, ownerId, projectId); if (!record) throw new Error("upload-not-found"); record.references++; await writeFile(this.meta(id), JSON.stringify(record)); return record; }
  async release(id: string, ownerId: string, projectId: string) { const record = await this.get(id, ownerId, projectId); if (!record) return; record.references = Math.max(0, record.references - 1); await writeFile(this.meta(id), JSON.stringify(record)); }
  async cleanup() { let removed = 0; await mkdir(this.directory, { recursive: true }); for (const name of await (await import("node:fs/promises")).readdir(this.directory)) if (name.endsWith(".json")) { const id = name.slice(0, -5); const record = JSON.parse(await readFile(this.meta(id), "utf8")) as UploadRecord; if (record.expiresAt <= this.now() && record.references === 0) { await rm(this.meta(id), { force: true }); await rm(this.blob(id), { force: true }); removed++; } } return removed; }
  async exists(id: string) { try { return (await stat(this.blob(id))).isFile(); } catch { return false; } }
}
