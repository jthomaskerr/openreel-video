import type { CompatibilityIssue, CompatibilityReport, ReportArtifact } from "./types";

function safeText(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/`/g, "\\`").trim();
}

function artifactLabel(artifact: ReportArtifact): string {
  if (artifact.kind === "fcpxml") return "FCPXML";
  if (artifact.kind === "report") return "Markdown report";
  if (artifact.kind === "movie") return "QuickTime movie";
  return artifact.mediaType;
}

function issueLines(issue: CompatibilityIssue): string[] {
  const severity = issue.severity === "flattening" ? "FLATTENED" : issue.severity.toUpperCase();
  return [
    `- [${severity}] ${safeText(issue.message)}`,
    `  - Entity: ${issue.entity.kind} ${safeText(issue.entity.label)} (\`${safeText(issue.entity.id)}\`)`,
    `  - Action: ${safeText(issue.action)}`,
  ];
}

export function renderCompatibilityReport(report: CompatibilityReport): string {
  const lines = [
    "# OpenReel Handoff Compatibility Report",
    "",
    `- Project: ${safeText(report.project.name)} (\`${safeText(report.project.id)}\`)`,
    `- Target: ${safeText(report.target.label)} (${report.target.mode})`,
    `- Contract: ${safeText(report.target.contractVersion)}`,
    `- Range: ${safeText(report.range.startDisplay)} to ${safeText(report.range.endDisplay)} (${report.range.durationFrames} frames at ${safeText(report.range.frameRate)})`,
    `- Result: ${report.result.status}`,
    "",
    "## Artifacts",
    "",
    ...report.artifacts.map(
      (artifact) => `- \`${safeText(artifact.relativePath)}\` — ${artifactLabel(artifact)} — ${artifact.status}`,
    ),
    "",
    "## Compatibility issues",
    "",
    ...(report.issues.length ? report.issues.flatMap(issueLines) : ["No compatibility issues."]),
    "",
    "## Unsupported or flattened items",
    "",
    ...(report.unsupportedItems.length ? report.unsupportedItems.flatMap(issueLines) : ["None."]),
    "",
    `Generated: ${safeText(report.generatedAt)}`,
  ];
  return lines.join("\n");
}

