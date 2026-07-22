import { describe, expect, it, vi } from "vitest";
import { importMediaBatch } from "./media-import-batch";

function sizedFile(name: string, size: number): File {
  const file = new File([], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("importMediaBatch", () => {
  it("continues after returned and thrown failures and preserves file order", async () => {
    const importFile = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: { message: "bad codec" } })
      .mockRejectedValueOnce(new Error("decoder crashed"))
      .mockResolvedValueOnce({ success: true, actionId: "media-3" });

    const outcomes = await importMediaBatch(
      [sizedFile("bad.mov", 1), sizedFile("crash.mov", 1), sizedFile("ok.mov", 1)],
      { importFile, getStorageEvidence: async () => ({}) },
    );

    expect(outcomes.map((outcome) => [outcome.file.name, outcome.status])).toEqual([
      ["bad.mov", "failed"],
      ["crash.mov", "failed"],
      ["ok.mov", "durable-success"],
    ]);
    expect(importFile).toHaveBeenCalledTimes(3);
  });

  it("rejects an oversized file before calling the importer and continues", async () => {
    const importFile = vi.fn().mockResolvedValue({ success: true, actionId: "media-2" });

    const outcomes = await importMediaBatch(
      [sizedFile("huge.mov", 101), sizedFile("ok.mov", 10)],
      { maxSourceBytes: 100, importFile, getStorageEvidence: async () => ({}) },
    );

    expect(outcomes[0]).toMatchObject({
      status: "rejected",
      reason: "configured-cap",
      stage: "preflight",
    });
    expect(outcomes[1]).toMatchObject({ status: "durable-success", mediaId: "media-2" });
    expect(importFile).toHaveBeenCalledTimes(1);
  });

  it("reports persistence warnings as retryable degraded success", async () => {
    const outcomes = await importMediaBatch([sizedFile("clip.mov", 10)], {
      importFile: async () => ({
        success: true,
        actionId: "media-1",
        warnings: ["Local media persistence failed: quota exceeded"],
      }),
      getStorageEvidence: async () => ({}),
    });

    expect(outcomes[0]).toMatchObject({
      status: "degraded-success",
      reason: "persistence-failed",
      stage: "local-persistence",
      recoveryAction: "retry",
    });
  });

  it("publishes one-based progress for every file and stage", async () => {
    const onProgress = vi.fn();
    await importMediaBatch([sizedFile("a.mov", 1), sizedFile("b.mov", 1)], {
      importFile: async () => ({ success: true, actionId: "media" }),
      getStorageEvidence: async () => ({}),
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith({
      filename: "a.mov",
      index: 1,
      total: 2,
      stage: "preflight",
    });
    expect(onProgress).toHaveBeenCalledWith({
      filename: "b.mov",
      index: 2,
      total: 2,
      stage: "decode",
    });
  });
});
