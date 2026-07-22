import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";
import type { Document as XmldomDocument, Element as XmldomElement, Node as XmldomNode } from "@xmldom/xmldom";
import type { Project } from "../../types/project";
import { createMediaMap, sanitizeMediaFileName } from "./media-map";
import { projectRange } from "./project-range";
import { frameIndexToRationalSeconds, rationalTimeToString } from "./timebase";
import type {
  CompatibilityAssessment,
  HandoffArtifact,
  HandoffTargetProfile,
  TimelineHandoffPlan,
} from "./types";

function stableDigest(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `plan-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function plannedArtifact(
  kind: HandoffArtifact["kind"],
  relativePath: string,
  mediaType: string,
): HandoffArtifact {
  return { kind, relativePath, mediaType, required: true, byteLength: null, sha256: null, status: "planned" };
}

export function createHandoffPlan(
  project: Project,
  assessment: CompatibilityAssessment,
  targetProfile: HandoffTargetProfile,
): TimelineHandoffPlan {
  if (assessment.status !== "ready") throw new Error("A handoff plan requires a ready assessment");
  if (
    assessment.selection.projectId !== project.id ||
    assessment.selection.projectModifiedAt !== project.modifiedAt ||
    assessment.target !== targetProfile.id
  ) {
    throw new Error("A handoff plan cannot be created from a stale or mismatched assessment");
  }

  const projection = projectRange(project, assessment.selection.range, assessment.timebase);
  const media = createMediaMap(project, assessment.requiredMediaIds);
  const projectName = sanitizeMediaFileName(project.name, project.id);
  const artifacts: HandoffArtifact[] = [
    plannedArtifact("fcpxml", `${projectName}.fcpxml`, "application/xml"),
    plannedArtifact("report", "compatibility-report.md", "text/markdown"),
    ...media.map((item) => plannedArtifact("media", item.relativeUrl, item.type === "image" ? "image/*" : item.type === "audio" ? "audio/*" : "video/quicktime")),
  ];
  const planId = stableDigest(
    JSON.stringify({ assessmentId: assessment.assessmentId, profile: targetProfile.contractVersion, media: media.map((item) => item.mediaId) }),
  );

  return {
    planId,
    assessmentId: assessment.assessmentId,
    project: { id: project.id, name: projectName, width: project.settings.width, height: project.settings.height },
    targetProfile,
    selection: assessment.selection,
    timebase: assessment.timebase,
    durationFrames: projection.frameRange.durationFrames,
    tracks: projection.tracks,
    clips: projection.clips,
    media,
    issues: assessment.issues.filter((entry) => entry.severity !== "blocking"),
    artifacts,
  };
}

function appendElement(
  parent: XmldomNode,
  name: string,
  attributes: Readonly<Record<string, string>>,
): XmldomElement {
  const document = parent.nodeType === parent.DOCUMENT_NODE ? (parent as XmldomDocument) : parent.ownerDocument!;
  const element = document.createElement(name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  parent.appendChild(element);
  return element;
}

export function serializeResolveFcpxml(plan: TimelineHandoffPlan): string {
  if (plan.targetProfile.id !== "resolve" || plan.targetProfile.contractVersion !== "fcpxml-1.10") {
    throw new Error("Resolve FCPXML serialization requires the fcpxml-1.10 target profile");
  }
  const implementation = new DOMImplementation();
  const documentType = implementation.createDocumentType("fcpxml", "", "");
  const document = implementation.createDocument(null, "fcpxml", documentType);
  const root = document.documentElement;
  if (!root) throw new Error("FCPXML document root could not be created");
  root.setAttribute("version", "1.10");
  const resources = appendElement(root, "resources", {});
  appendElement(resources, "format", {
    id: "r1",
    name: `OpenReel ${plan.project.width}x${plan.project.height} ${plan.timebase.framesPerSecondNumerator}/${plan.timebase.framesPerSecondDenominator}`,
    frameDuration: rationalTimeToString({
      numerator: plan.timebase.frameDurationNumerator,
      denominator: plan.timebase.frameDurationDenominator,
    }),
    width: String(plan.project.width),
    height: String(plan.project.height),
  });

  const resourceByMediaId = new Map<string, string>();
  plan.media.forEach((media, index) => {
    const id = `r${index + 2}`;
    resourceByMediaId.set(media.mediaId, id);
    const attributes: Record<string, string> = {
      id,
      name: media.sourceName,
      src: media.relativeUrl,
      start: "0s",
    };
    if (media.duration) attributes.duration = rationalTimeToString(media.duration);
    attributes.hasVideo = media.hasVideo ? "1" : "0";
    attributes.hasAudio = media.hasAudio ? "1" : "0";
    appendElement(resources, "asset", attributes);
  });

  const library = appendElement(root, "library", {});
  const event = appendElement(library, "event", { name: plan.project.name });
  const project = appendElement(event, "project", { name: plan.project.name });
  const sequence = appendElement(project, "sequence", {
    format: "r1",
    duration: rationalTimeToString(frameIndexToRationalSeconds(plan.durationFrames, plan.timebase)),
    tcStart: "0s",
    tcFormat: "NDF",
  });
  const spine = appendElement(sequence, "spine", {});
  for (const clip of plan.clips) {
    const ref = resourceByMediaId.get(clip.mediaId);
    if (!ref) throw new Error(`Clip ${clip.clipId} references missing media ${clip.mediaId}`);
    if (clip.timelineRange.durationFrames <= 0 || clip.sourceDurationFrames <= 0) {
      throw new Error(`Clip ${clip.clipId} must have a positive duration`);
    }
    appendElement(spine, "asset-clip", {
      name: clip.clipId,
      ref,
      offset: rationalTimeToString(frameIndexToRationalSeconds(clip.timelineRange.startFrame, plan.timebase)),
      start: rationalTimeToString(frameIndexToRationalSeconds(clip.sourceStartFrame, plan.timebase)),
      duration: rationalTimeToString(frameIndexToRationalSeconds(clip.timelineRange.durationFrames, plan.timebase)),
      lane: String(clip.lane),
    });
  }

  const serialized = new XMLSerializer()
    .serializeToString(document, { requireWellFormed: true })
    .replace(/^<!DOCTYPE fcpxml>/, "<!DOCTYPE fcpxml>\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}
