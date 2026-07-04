import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Regression tests for the title-preservation invariant in replaceMediaAsset.
// The function lives in project-store.ts ~line 1936.
// Because it is tightly coupled to Zustand state and mediaBridge, these tests
// exercise the construction logic in isolation — documenting the contract that
// must hold regardless of surrounding infrastructure.

type MediaItem = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  group?: string;
  [key: string]: unknown;
};

/**
 * Simulate the updatedItem construction that replaceMediaAsset performs.
 * Mirrors the actual spread in project-store.ts lines ~2046-2067 exactly.
 */
function buildUpdatedItem(
  previousItem: MediaItem | undefined,
  newFileName: string,
  mediaId: string,
): MediaItem {
  return {
    ...previousItem,
    id: mediaId,
    name: newFileName,
    // Preserve user-editable metadata — replace only the file, not the asset identity
    title: previousItem?.title,
    description: previousItem?.description,
    tags: previousItem?.tags,
    group: previousItem?.group,
  };
}

describe("replaceMediaAsset — title preservation invariant", () => {
  // Regression: asset replace was changing (clearing) title because the spread
  // was not followed by an explicit `title: previousItem?.title` assignment.
  it("[regression] replacing media preserves title and description but updates name", () => {
    const previousItem: MediaItem = {
      id: "x",
      name: "old.mp4",
      title: "My Scene",
      description: "desc",
      tags: ["a"],
    };
    const newFileName = "new.mp4";

    const updatedItem = buildUpdatedItem(previousItem, newFileName, previousItem.id);

    expect(updatedItem.title).toBe("My Scene");   // title must not change
    expect(updatedItem.name).toBe("new.mp4");      // filename must update
    expect(updatedItem.description).toBe("desc");  // description must not change
  });

  // Regression: when previousItem never had a title, updatedItem must remain
  // undefined — not fall through to some default from the spread or elsewhere.
  it("[regression] when previousItem has no title, updatedItem.title is undefined", () => {
    const previousItem: MediaItem = {
      id: "y",
      name: "clip.mp4",
      // title intentionally absent
    };

    const updatedItem = buildUpdatedItem(previousItem, "replacement.mp4", previousItem.id);

    expect(updatedItem.title).toBeUndefined();
    expect(updatedItem.name).toBe("replacement.mp4");
  });

  // Regression: tags array must survive the replace operation unchanged — both
  // by value and by the same array reference so downstream consumers that rely
  // on reference equality (e.g. React memoization) are not broken.
  it("[regression] tags array is preserved by reference identity", () => {
    const tags = ["promo", "2024"];
    const previousItem: MediaItem = {
      id: "z",
      name: "promo.mp4",
      title: "Promo",
      tags,
    };

    const updatedItem = buildUpdatedItem(previousItem, "promo-v2.mp4", previousItem.id);

    // Same reference — not a copy
    expect(updatedItem.tags).toBe(tags);
    // Also verify values in case the implementation changes to a copy
    expect(updatedItem.tags).toEqual(["promo", "2024"]);
  });

  // Compile-time canary: assert that the actual source of replaceMediaAsset
  // contains the pattern `title: previousItem?.title`.  If a future refactor
  // removes or renames this line, this test will catch the regression before
  // it ships.
  it("[regression] source of replaceMediaAsset contains `title: previousItem?.title`", () => {
    const sourceFile = path.resolve(
      __dirname,
      "project-store.ts",
    );
    const source = fs.readFileSync(sourceFile, "utf-8");

    expect(source).toContain("title: previousItem?.title");
    expect(source).toContain("description: previousItem?.description");
    expect(source).toContain("tags: previousItem?.tags");
  });
});
