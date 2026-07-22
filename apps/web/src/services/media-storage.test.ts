import { describe, expect, it } from "vitest";
import {
  addRelinkCandidate,
  type FoundFileEntry,
} from "./media-storage";

function entry(name: string, size: number): FoundFileEntry {
  return {
    file: { name, size } as File,
    handle: {} as FileSystemFileHandle,
  };
}

describe("addRelinkCandidate", () => {
  it("indexes an exact normalized filename and size match", () => {
    const index = new Map<string, FoundFileEntry>();
    addRelinkCandidate(index, entry("Clip.MOV", 42));
    expect(index.get("clip.mov:42")).toMatchObject({ ambiguous: false });
  });

  it("marks duplicate filename-and-size candidates ambiguous", () => {
    const index = new Map<string, FoundFileEntry>();
    addRelinkCandidate(index, entry("clip.mov", 42));
    addRelinkCandidate(index, entry("CLIP.MOV", 42));
    expect(index.get("clip.mov:42")).toMatchObject({ ambiguous: true });
  });
});
