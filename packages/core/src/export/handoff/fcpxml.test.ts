import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import type { Element as XmldomElement } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { assessHandoff } from "./compatibility";
import { createHandoffPlan, serializeResolveFcpxml } from "./fcpxml";
import { createBasicMultitrackProject } from "./__fixtures__/projects";
import { HANDOFF_TARGET_PROFILES } from "./target-profiles";

const expectedXml = readFileSync(
  new URL("./__fixtures__/expected/basic-multitrack.fcpxml", import.meta.url),
  "utf8",
).trim();

function createPlan(range = { startTime: 0, endTime: 6 }) {
  const project = createBasicMultitrackProject();
  const availability = new Map(
    project.mediaLibrary.items.map((media) => [
      media.id,
      { available: true as const, source: "blob" as const, mediaType: media.type, byteLength: media.metadata.fileSize },
    ]),
  );
  const selection = {
    projectId: project.id,
    projectModifiedAt: project.modifiedAt,
    target: "resolve" as const,
    range,
  };
  const assessment = assessHandoff(project, selection, {
    mediaAvailability: availability,
    targetProfiles: HANDOFF_TARGET_PROFILES,
    now: () => 0,
  });
  expect(assessment.status).toBe("ready");
  return createHandoffPlan(project, assessment, HANDOFF_TARGET_PROFILES.get("resolve")!);
}

function parse(xml: string) {
  return new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(message);
    },
  }).parseFromString(xml, "application/xml");
}

describe("Resolve FCPXML 1.10", () => {
  it("serializes a standards-parseable 1.10 document with deterministic golden output", () => {
    const xml = serializeResolveFcpxml(createPlan());
    const document = parse(xml);
    const root = document.documentElement;
    expect(root).not.toBeNull();
    expect(root!.tagName).toBe("fcpxml");
    expect(root!.getAttribute("version")).toBe("1.10");
    if (xml !== expectedXml) {
      const mismatch = [...xml].findIndex((character, index) => character !== expectedXml[index]);
      throw new Error(
        `Golden mismatch at ${mismatch}: actual=${JSON.stringify(xml.slice(mismatch, mismatch + 120))} expected=${JSON.stringify(expectedXml.slice(mismatch, mismatch + 120))}`,
      );
    }
    expect(serializeResolveFcpxml(createPlan())).toBe(xml);
  });

  it("creates unique resource IDs and resolves every clip ref", () => {
    const document = parse(serializeResolveFcpxml(createPlan()));
    const resources = Array.from(document.getElementsByTagName("resources")[0].childNodes)
      .filter((node) => node.nodeType === node.ELEMENT_NODE)
      .map((node) => (node as XmldomElement).getAttribute("id"));
    const refs = Array.from(document.getElementsByTagName("asset-clip")).map((node) => node.getAttribute("ref"));
    expect(new Set(resources).size).toBe(resources.length);
    expect(refs.every((ref) => resources.includes(ref))).toBe(true);
  });

  it("serializes non-negative rational times, positive durations, and stable lanes", () => {
    const document = parse(serializeResolveFcpxml(createPlan()));
    const clips = Array.from(document.getElementsByTagName("asset-clip"));
    const timePattern = /^(?:0|\d+|\d+\/\d+)s$/;
    for (const clip of clips) {
      expect(clip.getAttribute("offset")).toMatch(timePattern);
      expect(clip.getAttribute("start")).toMatch(timePattern);
      expect(clip.getAttribute("duration")).toMatch(timePattern);
      expect(clip.getAttribute("duration")).not.toBe("0s");
    }
    expect(clips.map((clip) => clip.getAttribute("lane"))).toEqual(["0", "1", "-1"]);
  });

  it("contains every asset URL under Media with percent-encoded segments", () => {
    const document = parse(serializeResolveFcpxml(createPlan()));
    const sources = Array.from(document.getElementsByTagName("asset")).map((asset) => asset.getAttribute("src"));
    expect(sources).toEqual(["Media/Mix.wav", "Media/Title%20%26%20Logo.png", "Media/Camera%20A.mov"]);
    expect(sources.every((source) => source?.startsWith("Media/") && !decodeURIComponent(source).includes(".."))).toBe(true);
  });

  it("rebases a selected range while preserving source boundary trims", () => {
    const document = parse(serializeResolveFcpxml(createPlan({ startTime: 1, endTime: 4 })));
    const sequence = document.getElementsByTagName("sequence")[0];
    const clips = Array.from(document.getElementsByTagName("asset-clip"));
    expect(sequence.getAttribute("duration")).toBe("3s");
    expect(clips[0]).toMatchObject({});
    expect(clips[0].getAttribute("offset")).toBe("0s");
    expect(clips[0].getAttribute("start")).toBe("3s");
    expect(clips[0].getAttribute("duration")).toBe("3s");
  });
});
