# Handoff Service Contract

**Contract version**: 1.0
**Scope**: Boundary between deterministic `@openreel/core` handoff logic and browser-side execution.

## Core API

```ts
type HandoffTarget = "resolve" | "imovie";

interface HandoffSelection {
  projectId: string;
  projectModifiedAt: number;
  target: HandoffTarget;
  range: ExportRange;
}

interface AssessHandoffOptions {
  mediaAvailability: ReadonlyMap<string, MediaAvailabilityHint>;
  targetProfiles?: ReadonlyMap<HandoffTarget, HandoffTargetProfile>;
  now?: () => number;
}

function assessHandoff(
  project: Project,
  selection: HandoffSelection,
  options: AssessHandoffOptions,
): CompatibilityAssessment;

function createHandoffPlan(
  project: Project,
  assessment: CompatibilityAssessment,
): TimelineHandoffPlan;

function serializeResolveFcpxml(plan: TimelineHandoffPlan): string;

function renderCompatibilityReport(
  report: CompatibilityReport,
): string;

function getImovieVideoSettings(
  project: Project,
  selection: HandoffSelection,
): VideoExportSettings;
```

### Core Preconditions

- `project.id === selection.projectId`.
- The project modification timestamp matches the selection at planning time.
- The selected range passes the existing export-range contract.
- `createHandoffPlan` accepts only a `ready` assessment with no blocking issues.
- `serializeResolveFcpxml` accepts only a Resolve plan using the supported FCPXML contract version.
- Core functions do not perform network, file-system, browser permission, rendering, analytics, or notification work.

### Core Errors

Core boundary errors are typed and stable:

| Code | Meaning | Retryable |
|------|---------|-----------|
| `handoff.invalid-range` | Range does not satisfy export range rules | No, edit selection |
| `handoff.invalid-frame-rate` | Frame rate cannot produce a safe timebase | No, edit project |
| `handoff.project-stale` | Project changed after assessment | Yes, reassess |
| `handoff.assessment-blocked` | Plan requested from a blocked assessment | No, resolve issues |
| `handoff.invalid-plan` | Internal plan invariant failed | No |
| `handoff.xml-serialization-failed` | FCPXML could not be serialized or round-tripped | Yes after defect fix |

Errors do not include blobs, native paths, signed URLs, or credentials.

## Browser Coordinator API

```ts
interface MediaResolver {
  inspect(media: MediaItem, signal: AbortSignal): Promise<MediaAvailabilityHint>;
  open(media: MediaItem, signal: AbortSignal): Promise<ResolvedMediaSource>;
}

interface ResolvedMediaSource {
  mediaId: string;
  fileName: string;
  byteLength: number;
  mediaType: string;
  stream(): ReadableStream<Uint8Array>;
}

interface ResolveDestination {
  createProjectDirectory(name: string): Promise<DirectoryWriter>;
}

interface DirectoryWriter {
  write(relativePath: string, body: string | ReadableStream<Uint8Array>, signal: AbortSignal):
    Promise<WrittenArtifact>;
  close(): Promise<void>;
}

interface MovieDestination {
  open(fileName: string, mediaType: string): Promise<FileSystemWritableFileStream>;
}

interface HandoffDependencies {
  mediaResolver: MediaResolver;
  resolveDestination: ResolveDestination;
  movieDestination: MovieDestination;
  exportEngine: ExportEngine;
  emitDiagnostic(event: HandoffDiagnosticEvent): void;
}

interface StartHandoffOptions {
  signal: AbortSignal;
  onProgress(progress: HandoffProgress): void;
}

async function startHandoff(
  project: Project,
  selection: HandoffSelection,
  dependencies: HandoffDependencies,
  options: StartHandoffOptions,
): Promise<HandoffResult>;
```

### Coordinator Guarantees

- It performs a fresh assessment before asking for a destination.
- It rejects a stale project before writing.
- It emits monotonic progress within each phase.
- It checks cancellation before and after every external await and between streamed media chunks.
- It writes one media file per required media ID.
- It writes FCPXML only after every required Resolve media copy succeeds.
- It marks completion only after every required writable closes.
- It maps all failures to a visible `HandoffFailure` with target, stage, retryability, and safe entity identity.
- It never logs native paths or signed media URLs.

## Progress Contract

```ts
type HandoffPhase =
  | "assessing"
  | "awaiting-destination"
  | "resolving-media"
  | "rendering"
  | "packaging"
  | "saving"
  | "completed"
  | "blocked"
  | "cancelled"
  | "failed";

interface HandoffProgress {
  operationId: string;
  target: HandoffTarget;
  phase: HandoffPhase;
  progress: number; // 0..1
  processedCount: number;
  totalCount: number;
  currentEntity?: HandoffEntityRef;
  message: string;
}
```

Rules:

- `progress` is finite and in `[0, 1]`.
- It is monotonic within one phase but may reset at a phase boundary.
- `completed`, `blocked`, `cancelled`, and `failed` emit at most once.
- User-facing messages never contain a native path or remote signed URL.

## Result Contract

```ts
type HandoffResult =
  | {
      status: "completed";
      target: HandoffTarget;
      report: CompatibilityReport;
      artifacts: WrittenArtifact[];
    }
  | {
      status: "blocked";
      target: HandoffTarget;
      assessment: CompatibilityAssessment;
    }
  | {
      status: "cancelled";
      target: HandoffTarget;
      stage: HandoffPhase;
      writtenArtifacts: WrittenArtifact[];
    }
  | {
      status: "failed";
      target: HandoffTarget;
      failure: HandoffFailure;
      writtenArtifacts: WrittenArtifact[];
    };
```

The UI must not treat `writtenArtifacts` from cancelled or failed results as import-ready.

## Media Resolution Contract

Resolution order:

1. live `MediaItem.blob`;
2. persisted media blob;
3. retained `FileSystemFileHandle` after permission confirmation;
4. already verified `remoteUrl` or `originalUrl`.

Rules:

- Inspection does not copy or fetch full media.
- `open()` returns a stream and byte length or fails with an actionable typed error.
- Remote sources must pass the existing media verification policy before use.
- A zero-byte source or content-type mismatch is a blocking failure.
- The coordinator never stores a second persistent cache.

## Destination Contract

### Resolve

```text
<sanitized-project-name>/
├── <sanitized-project-name>.fcpxml
├── compatibility-report.md
└── Media/
    └── <deterministic-media-name>.<ext>
```

- The directory API must support nested directory creation and streamed writes.
- Names are sanitized before any handle call.
- Relative paths cannot contain `..`, absolute roots, or encoded traversal.
- Existing entries require explicit user confirmation or a new collision-safe directory name.

### iMovie

- Primary artifact: `<sanitized-project-name>-imovie.mov`.
- Media type: `video/quicktime`.
- Compatibility report remains available from the completion UI and as an explicit Markdown download.
- Existing generic MOV/MP4 behavior is not changed.

## Diagnostic Events

Required event names:

- `handoff.assessment.completed`
- `handoff.assessment.blocked`
- `handoff.destination.selected`
- `handoff.media.resolve.completed`
- `handoff.media.resolve.failed`
- `handoff.artifact.write.started`
- `handoff.artifact.write.completed`
- `handoff.render.progress`
- `handoff.cancelled`
- `handoff.failed`
- `handoff.completed`

Allowed fields include target, contract version, issue counts by severity/code, media ID, clip ID, track ID, artifact kind and safe relative name, stage, elapsed milliseconds, byte counts, frame counts, retryability, and redacted error code.
