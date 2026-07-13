import { describe, expect, it } from "vitest";

describe("decode-worker module", () => {
  it("can be imported in Node without a worker global", async () => {
    const module = await import("./decode-worker");

    expect(typeof module.decodeWorkerCode).toBe("string");
    expect(module.decodeWorkerCode.length).toBeGreaterThan(0);
  });
});
