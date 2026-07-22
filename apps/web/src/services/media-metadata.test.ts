import { describe, expect, it } from "vitest";
import { normalizeMediaMetadataPatch } from "./media-metadata";

describe("normalizeMediaMetadataPatch", () => {
  it("trims and case-insensitively deduplicates tags", () => {
    expect(
      normalizeMediaMetadataPatch({
        title: "  Title  ",
        description: " description ",
        group: " Group ",
        tags: [" Promo ", "promo", "", "TRAILER"],
      }),
    ).toEqual({
      title: "Title",
      description: "description",
      group: "Group",
      tags: ["Promo", "TRAILER"],
    });
  });
});
