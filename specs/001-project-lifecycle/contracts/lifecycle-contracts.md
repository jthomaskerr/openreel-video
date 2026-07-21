# Project Lifecycle Contracts

## Versioned project-data file (existing envelope; strict decoder Future Scope)

Current export payload:

```json
{
  "version": "1.0.0",
  "project": {
    "id": "stable-project-id",
    "name": "Project name",
    "createdAt": 1760000000000,
    "modifiedAt": 1760000001000,
    "settings": {},
    "timeline": { "duration": 0, "tracks": [], "markers": [], "subtitles": [] },
    "mediaLibrary": { "items": [] },
    "generatedImageDefinitions": []
  }
}
```

Proposed Future Scope decoder result:

```ts
type ProjectFileDecodeResult =
  | { ok: true; project: Project; sourceVersion: string; migrated: boolean }
  | { ok: false; code: "INVALID_JSON" | "INVALID_PROJECT" | "UNSUPPORTED_VERSION" | "PROJECT_ID_MISMATCH"; message: string };

decodeProjectFile(json: string, options?: { expectedProjectId?: string }): ProjectFileDecodeResult;
encodeProjectFile(project: Project): string;
```

The installed serializer exports the current envelope and normalizes legacy data. Strict future-version, incomplete-shape, and identity rejection are deferred.

## Authoritative dirty-state contract

```ts
isProjectDirty(
  project: Pick<Project, "id" | "modifiedAt">,
  status: Pick<PersistenceStatusState, "projectId" | "confirmedReceipt">,
): boolean;
```

Returns `false` only when the confirmed receipt belongs to the same project and its `sourceModifiedAt` matches the active project.

## Project replacement contract (Future Scope)

```ts
type ProjectTransitionChoice = "save" | "discard" | "cancel";

requestProjectTransition(input: {
  projectName: string;
  targetLabel: string;
}): Promise<ProjectTransitionChoice>;
```

- Save: await complete local recovery write and backend `save(fullProject, "user")`; proceed only on success.
- Discard: proceed without mutating durable state.
- Cancel/Escape: leave the current project and dialog state unchanged.
- Error: remain on the current project and expose affected identity plus retry/cancel actions.

## Project-bound scheduling contract

```ts
scheduleSave(project: Project, delayMs?: number): void;
save(project: Project, saveIntent?: SaveIntent): Promise<void>;
resetForProject(activeProjectId?: string): void;
```

Each queued snapshot, retry timer, upload, and confirmation poll retains the project ID captured when created. Activating another project changes visible active status but does not rebind or silently discard another project's work.

## Conflict recovery UI contract (Future Scope)

On `PROJECT_CONFLICT`, the newer durable state remains canonical and the local state remains in memory. The UI offers:

1. Export local state as a portable project-data file.
2. Reload the newer durable state after explicit confirmation.
3. Cancel and continue inspecting/editing the local state.

No action runs automatically. Errors use an announced message and keep both states available.

## Strict recovery contract (Future Scope)

`checkForRecovery` rejects storage access failures rather than converting them to an empty list. `recover(saveId, expectedProjectId?)` returns a validated project only when the record exists, is supported, is complete, and matches both the record and requested identity. Restoration installs that project as unsaved state and does not write canonical state until explicit save.
