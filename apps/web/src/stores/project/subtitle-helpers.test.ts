import { describe, expect, it } from "vitest";
import { parseImportableSRT } from "./subtitle-helpers";

describe("parseImportableSRT", () => {
  it("rejects empty or wholly invalid SRT content", () => {
    expect(parseImportableSRT("")).toMatchObject({ success: false });
    expect(parseImportableSRT("not a cue")).toMatchObject({ success: false });
  });

  it("returns valid cues while retaining parse warnings", () => {
    const result = parseImportableSRT(
      "1\n00:00:00,000 --> 00:00:01,000\nHello\n\nbroken cue",
    );
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.subtitles).toHaveLength(1);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
