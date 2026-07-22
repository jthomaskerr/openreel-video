import { describe, expect, it } from "vitest";
import { createMusicVideoDomainId } from "./identity.js";

describe("createMusicVideoDomainId", () => {
  it("creates path-safe non-UUID durable identities", () => {
    const id = createMusicVideoDomainId("scene", {
      now: () => 1_721_670_400_000,
      randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 1),
    });

    expect(id).toMatch(/^scene-[a-z0-9]+-[a-z0-9]+$/);
    expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
