import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { filenameToTitle } from "./filename-to-title";

describe("filenameToTitle", () => {
  const cases: Array<[string, string]> = [
    ["my_video_clip-01.mp4", "My video clip 01"],
    ["MyVideoClip.mov", "MyVideoClip"],
    ["myVideoClip.mov", "MyVideoClip"],
    ["sunset-beach.jpg", "Sunset beach"],
    ["SUNSET_BEACH.PNG", "Sunset beach"],
    ["___leading_seps.mp3", "Leading seps"],
    ["trailing_seps___.wav", "Trailing seps"],
    ["a---b__c.mp4", "A b c"],
    ["2024-01-15_final_cut.mp4", "2024 01 15 Final cut"],
    [".gitignore", "Untitled"],
    ["no_extension_file", "No extension file"],
    ["émigré_clip.mov", "Émigré clip"],
    ["😀party.mp4", "😀party"],
    ["", "Untitled"],
    ["video.mp4", "Video"],
    ["IMG_1234.HEIC", "Img 1234"],
  ];

  it.each(cases)("filenameToTitle(%j) === %j", (input, expected) => {
    expect(filenameToTitle(input)).toBe(expected);
  });

  it("never throws for arbitrary string input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => filenameToTitle(s)).not.toThrow();
        expect(typeof filenameToTitle(s)).toBe("string");
      }),
    );
  });

  it("never throws for filenames containing path separators", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(() => filenameToTitle(`${a}/${b}\\x.mp4`)).not.toThrow();
      }),
    );
  });

  it("handles Korean (no case distinction) without altering spacing", () => {
    expect(filenameToTitle("클립_영상.mp4")).toBe("클립 영상");
  });
});
