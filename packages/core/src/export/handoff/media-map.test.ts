import { describe, expect, it } from "vitest";
import { createHandoffFixtureProject } from "./__fixtures__/projects";
import { assertContainedMediaPath, createMediaMap } from "./media-map";

describe("handoff media map", () => {
  it("creates deterministic names independent of requested media order", () => {
    const project = createHandoffFixtureProject();
    const forward = createMediaMap(project, ["video-media-1", "audio-media-1"]);
    const reverse = createMediaMap(project, ["audio-media-1", "video-media-1"]);
    expect(reverse).toEqual(forward);
    expect(forward.map((media) => media.mediaId)).toEqual(["audio-media-1", "video-media-1"]);
  });

  it("resolves case-insensitive output-name collisions", () => {
    const project = createHandoffFixtureProject();
    const first = project.mediaLibrary.items[0];
    const collision = { ...first, id: "video-media-2", name: "camera a.MOV" };
    const media = createMediaMap(
      { ...project, mediaLibrary: { items: [first, collision] } },
      [first.id, collision.id],
    );
    expect(media.map((item) => item.outputName)).toEqual(["Camera A.mov", "camera a-2.MOV"]);
  });

  it("sanitizes raw path segments and percent-encodes the contained URL", () => {
    const project = createHandoffFixtureProject();
    const unsafe = { ...project.mediaLibrary.items[0], name: "../Cámara #1?.mov" };
    const [media] = createMediaMap(
      { ...project, mediaLibrary: { items: [unsafe] } },
      [unsafe.id],
    );
    expect(media.outputName).toBe("Cámara #1_.mov");
    expect(media.relativeUrl).toBe("Media/C%C3%A1mara%20%231_.mov");
  });

  it.each([
    "../outside.mov",
    "Media/../outside.mov",
    "/Media/file.mov",
    "C:\\Media\\file.mov",
    "Media/%2e%2e/outside.mov",
    "Media/%252e%252e/outside.mov",
  ])("rejects raw or encoded traversal path %s", (candidate) => {
    expect(() => assertContainedMediaPath(candidate)).toThrow(/Media/i);
  });

  it("rejects a required media ID absent from the project", () => {
    expect(() => createMediaMap(createHandoffFixtureProject(), ["missing"])).toThrow(/missing/i);
  });
});

