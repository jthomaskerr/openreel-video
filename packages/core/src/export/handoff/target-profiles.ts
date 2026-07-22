import type { HandoffTarget, HandoffTargetProfile } from "./types";

export interface CompatibilityCandidate {
  readonly target: HandoffTarget;
  readonly application: string;
  readonly version: string;
  readonly build: string;
}

export interface CompatibilityEvidenceRow {
  readonly target: HandoffTarget;
  readonly applicationVersion: string;
  readonly applicationBuild: string;
  readonly operatingSystem: string;
  readonly fixtureId: string;
  readonly artifactSha256: string;
  readonly result: "passed" | "failed";
  readonly comparisons: string;
  readonly evidence: string;
  readonly verifier: string;
  readonly verifiedAt: string;
}

function freezeProfile(profile: HandoffTargetProfile): HandoffTargetProfile {
  return Object.freeze({
    ...profile,
    applicationVersions: Object.freeze([...profile.applicationVersions]),
    requiredCapabilities: Object.freeze([...profile.requiredCapabilities]),
  });
}

const resolveProfile = freezeProfile({
  id: "resolve",
  label: "DaVinci Resolve",
  mode: "editable",
  contractVersion: "fcpxml-1.10",
  applicationVersions: [],
  requiredCapabilities: ["directory-write", "stream-write"],
  issueMatrixVersion: "1.0",
});

const imovieProfile = freezeProfile({
  id: "imovie",
  label: "iMovie",
  mode: "flattened",
  contractVersion: "mov-h264-aac-1.0",
  applicationVersions: [],
  requiredCapabilities: ["mov-h264-aac-encode", "file-write"],
  issueMatrixVersion: "1.0",
});

export const HANDOFF_TARGET_PROFILES: ReadonlyMap<HandoffTarget, HandoffTargetProfile> = new Map([
  [resolveProfile.id, resolveProfile],
  [imovieProfile.id, imovieProfile],
]);

export const RESOLVE_CANDIDATE: CompatibilityCandidate = Object.freeze({
  target: "resolve",
  application: "DaVinci Resolve",
  version: "20.3.2",
  build: "20.3.20009",
});

export const IMOVIE_CANDIDATE: CompatibilityCandidate | null = null;

function hasCompleteEvidence(evidence: CompatibilityEvidenceRow): boolean {
  return Boolean(
    evidence.operatingSystem.trim() &&
      evidence.fixtureId.trim() &&
      /^[a-f\d]{64}$/i.test(evidence.artifactSha256) &&
      evidence.comparisons.trim() &&
      evidence.evidence.trim() &&
      evidence.verifier.trim() &&
      /^\d{4}-\d{2}-\d{2}/.test(evidence.verifiedAt),
  );
}

export function promoteTargetProfile(
  profile: HandoffTargetProfile,
  candidate: CompatibilityCandidate,
  evidence: CompatibilityEvidenceRow,
): HandoffTargetProfile {
  const exactCandidate =
    profile.id === candidate.target &&
    evidence.target === candidate.target &&
    evidence.applicationVersion === candidate.version &&
    evidence.applicationBuild === candidate.build;
  if (evidence.result !== "passed" || !exactCandidate || !hasCompleteEvidence(evidence)) {
    throw new Error("A target can be promoted only from complete passing evidence for the exact candidate build");
  }
  const advertisedVersion = `${candidate.version} (${candidate.build})`;
  return freezeProfile({
    ...profile,
    applicationVersions: [...new Set([...profile.applicationVersions, advertisedVersion])],
  });
}

export { createImovieExportProfile as getImovieVideoSettings } from "./imovie-profile";
