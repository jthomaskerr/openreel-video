import { describe, expect, it } from "vitest";
import { getRefImageUrls } from "./schema-injector";

describe("getRefImageUrls", () => {
  it("returns only provider-reachable HTTPS references", () => {
    const items = [
      { id: "https", originalUrl: "https://cdn.example/reference.png", thumbnailUrl: null },
      { id: "blob", originalUrl: "blob:http://localhost/blob", thumbnailUrl: null },
      { id: "data", originalUrl: "data:image/png;base64,abc", thumbnailUrl: null },
    ] as never[];
    expect(getRefImageUrls(items, ["https", "blob", "data"]).map((item) => item.id)).toEqual(["https"]);
  });
});
