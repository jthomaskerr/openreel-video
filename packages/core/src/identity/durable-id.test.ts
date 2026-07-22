import { describe, expect, it } from "vitest";
import {
  createDurableId,
  createInfrastructureNonce,
  isDurableId,
  isInfrastructureNonce,
  type DurableIdEntropy,
} from "./durable-id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fixedEntropy(bytes: number[]): DurableIdEntropy {
  return {
    now: () => 1_726_000_000_000,
    randomBytes: (length) => Uint8Array.from(
      Array.from({ length }, (_, index) => bytes[index % bytes.length] ?? 0),
    ),
  };
}

describe("durable domain identity", () => {
  it("creates a final path-safe non-UUID identity with an entity prefix", () => {
    const id = createDurableId("media", fixedEntropy([0, 1, 2, 3, 4, 5, 6, 7]));

    expect(id).toMatch(/^media-[a-z0-9]+-[a-z0-9]+$/);
    expect(id).not.toMatch(UUID_PATTERN);
    expect(isDurableId(id, "media")).toBe(true);
    expect(isDurableId(id, "clip")).toBe(false);
  });

  it("does not reuse an identity when entropy differs", () => {
    const first = createDurableId("clip", fixedEntropy([1]));
    const second = createDurableId("clip", fixedEntropy([2]));

    expect(first).not.toBe(second);
  });

  it("validates hyphenated entity kinds without absorbing entropy into the kind", () => {
    const id = createDurableId("resolve-job", fixedEntropy([4]));

    expect(isDurableId(id)).toBe(true);
    expect(isDurableId(id, "resolve-job")).toBe(true);
    expect(isDurableId(id, "resolve-request")).toBe(false);
  });

  it("keeps infrastructure nonces distinguishable from domain identities", () => {
    const nonce = createInfrastructureNonce(fixedEntropy([3]));

    expect(nonce).toMatch(/^nonce-[a-z0-9]+-[a-z0-9]+$/);
    expect(isDurableId(nonce)).toBe(false);
    expect(isInfrastructureNonce(nonce)).toBe(true);
    expect(isInfrastructureNonce("resolve-job-test-1")).toBe(false);
    expect(isInfrastructureNonce("nonce-")).toBe(false);
    expect(nonce).not.toMatch(UUID_PATTERN);
  });
});
