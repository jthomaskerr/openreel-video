import { describe, expect, it } from "vitest";
import type {
  ProjectBaseRevision,
  ProjectSaveConflictResponse,
  ProjectSaveDestructiveChangeRequiresIntentResponse,
  ProjectSaveMediaIncompleteResponse,
  ProjectSaveReceipt,
  ProjectSaveRequest,
  RequiredMediaManifestEntry,
} from "./project-persistence";
import { serializeRequiredMediaManifest } from "./project-persistence";

const baseRevision = {
  commitSha: "1111111111111111111111111111111111111111",
  treeSha: "2222222222222222222222222222222222222222",
  projectBlobSha: "3333333333333333333333333333333333333333",
  sourceModifiedAt: 1_780_000_000_000,
} satisfies ProjectBaseRevision;

const currentRevision = {
  commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  treeSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  projectBlobSha: "cccccccccccccccccccccccccccccccccccccccc",
  sourceModifiedAt: 1_780_000_000_123,
} satisfies ProjectBaseRevision;

const manifestEntryA = {
  mediaId: "media-a",
  semanticFilename: "alpha.mp4",
  relativePhysicalPath: "media/alpha.mp4",
  expectedByteSize: 123,
} satisfies RequiredMediaManifestEntry;

const manifestEntryB = {
  mediaId: "media-b",
  semanticFilename: "beta.mp4",
  relativePhysicalPath: "media\\beta.mp4",
  expectedByteSize: 456,
  lfsOid: "sha256:beta",
} satisfies RequiredMediaManifestEntry;

const makeSaveProject = () =>
  ({
    id: "project-1",
    name: "Project One",
    createdAt: 1_780_000_000_000,
    modifiedAt: 1_780_000_000_123,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    generatedImageDefinitions: [],
    timeline: {
      tracks: [],
      subtitles: [],
      duration: 0,
      markers: [],
    },
  }) satisfies ProjectSaveRequest["project"];

describe("project persistence contracts", () => {
  it("serializes the required media manifest deterministically", () => {
    const request = {
      projectId: "project-1",
      baseRevision,
      project: makeSaveProject(),
      requiredMediaManifest: [manifestEntryB, manifestEntryA],
    } satisfies ProjectSaveRequest;

    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect(serializeRequiredMediaManifest(request.requiredMediaManifest)).toBe(
      JSON.stringify([
        {
          mediaId: "media-a",
          semanticFilename: "alpha.mp4",
          relativePhysicalPath: "media/alpha.mp4",
          expectedByteSize: 123,
        },
        {
          mediaId: "media-b",
          semanticFilename: "beta.mp4",
          relativePhysicalPath: "media/beta.mp4",
          expectedByteSize: 456,
          lfsOid: "sha256:beta",
        },
      ]),
    );
  });

  it("rejects duplicate manifest ids and relative physical paths", () => {
    expect(() =>
      serializeRequiredMediaManifest([
        manifestEntryA,
        { ...manifestEntryA, relativePhysicalPath: "media/alpha-copy.mp4" },
      ]),
    ).toThrow("Duplicate mediaId in required media manifest: media-a");

    expect(() =>
      serializeRequiredMediaManifest([
        manifestEntryA,
        { ...manifestEntryB, mediaId: "media-c", relativePhysicalPath: "media/alpha.mp4" },
      ]),
    ).toThrow("Duplicate relativePhysicalPath in required media manifest: media/alpha.mp4");
  });

  it("models MEDIA_INCOMPLETE 409 responses", () => {
    const response = {
      saved: false,
      code: "MEDIA_INCOMPLETE",
      projectId: "project-1",
      missingItems: [manifestEntryB, manifestEntryA],
    } satisfies ProjectSaveMediaIncompleteResponse;

    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
    expect(serializeRequiredMediaManifest(response.missingItems)).toBe(
      JSON.stringify([
        {
          mediaId: "media-a",
          semanticFilename: "alpha.mp4",
          relativePhysicalPath: "media/alpha.mp4",
          expectedByteSize: 123,
        },
        {
          mediaId: "media-b",
          semanticFilename: "beta.mp4",
          relativePhysicalPath: "media/beta.mp4",
          expectedByteSize: 456,
          lfsOid: "sha256:beta",
        },
      ]),
    );
  });

  it("models PROJECT_CONFLICT 409 responses", () => {
    const response = {
      saved: false,
      code: "PROJECT_CONFLICT",
      projectId: "project-1",
      submittedBaseRevision: baseRevision,
      currentBaseRevision: currentRevision,
    } satisfies ProjectSaveConflictResponse;

    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
    expect(response.submittedBaseRevision).toEqual(baseRevision);
    expect(response.currentBaseRevision).toEqual(currentRevision);
  });

  it("models DESTRUCTIVE_CHANGE_REQUIRES_INTENT 409 responses", () => {
    const response = {
      saved: false,
      code: "DESTRUCTIVE_CHANGE_REQUIRES_INTENT",
      projectId: "project-1",
      submittedBaseRevision: baseRevision,
      currentBaseRevision: currentRevision,
      mediaCountDelta: -2,
      clipCountDelta: -5,
      trackCountDelta: -1,
      serializedStructuralSizeDelta: -42_000,
    } satisfies ProjectSaveDestructiveChangeRequiresIntentResponse;

    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
    expect(response.mediaCountDelta).toBe(-2);
    expect(response.clipCountDelta).toBe(-5);
    expect(response.trackCountDelta).toBe(-1);
    expect(response.serializedStructuralSizeDelta).toBe(-42_000);
  });

  it("models project save receipts with commit and digest identities", () => {
    const receipt = {
      saved: true,
      projectId: "project-1",
      persistedAt: 1_780_000_001_000,
      sourceModifiedAt: 1_780_000_000_123,
      commitSha: "dddddddddddddddddddddddddddddddddddddddd",
      treeSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      projectBlobSha: "ffffffffffffffffffffffffffffffffffffffff",
      mediaManifestDigest: "sha256:manifest-digest",
      lfsPayloads: [],
      committed: true,
    } satisfies ProjectSaveReceipt;

    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
    expect(receipt.commitSha).toBe("dddddddddddddddddddddddddddddddddddddddd");
    expect(receipt.treeSha).toBe("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(receipt.projectBlobSha).toBe("ffffffffffffffffffffffffffffffffffffffff");
    expect(receipt.sourceModifiedAt).toBe(1_780_000_000_123);
    expect(receipt.mediaManifestDigest).toBe("sha256:manifest-digest");
  });
});
