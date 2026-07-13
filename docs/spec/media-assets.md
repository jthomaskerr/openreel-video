# Media Assets — Operational Spec

**Status:** Canonical operational specification
**Owner:** Media and asset subsystem
**Supersedes:** Functional requirements formerly spread across [Asset & Project Management](./asset-management-ux.md), [Media Import & Timeline Placement](./media-import-timeline.md), and [Thumbnails & Missing-File Fallbacks](./thumbnails-fallbacks.md)

## Scope

This specification owns media identity, import, the Media pane, display titles, tags and grouping, asset versions, thumbnail data, runtime availability, verification, relinking, and deletion from the media library.

[Timeline](./timeline.md) owns clip placement and timeline rendering. [Project Lifecycle and Persistence](./project.md) owns durable storage and snapshot transactions. [Generation](./generation.md) owns generation jobs and hands finalized outputs to this subsystem.

## 1. Media Identity

`MediaItem.id` is the immutable identity of one concrete asset version. `assetGroupId` identifies versions of the same logical asset. Exactly one non-deleted version per group is current.

- `name` is the true filename used for matching, relinking, upload naming, and download-as behavior.
- `title` is the user-facing, editable display title.
- Runtime source handles and availability are not semantic identity and MUST NOT change IDs.
- Switching the current version updates project state without overwriting or deleting immutable media bytes.

## 2. Import

Import accepts supported local files and validated import adapters. Each successful file import:

1. validates type and size;
2. allocates a media ID and asset-group ID;
3. records the exact filename in `name`;
4. derives `title` according to §3;
5. extracts bounded metadata and thumbnail data;
6. retains a usable local source until durable upload completes;
7. adds the item atomically to the media library;
8. reports failures without creating partial or unreferenced records.

Importing media does not implicitly create timeline clips. Placement is an explicit [Timeline](./timeline.md) operation. Domain importers such as Neural Frames may create both domain records and clips, but must use the same media and placement contracts.

Replacing or relinking an item MUST preserve required trim/timing behavior and must not discard the only playable fallback source before the replacement is validated.

## 3. Display Titles

The canonical display name is:

```text
nonEmpty(item.title)
  ?? nonEmpty(deriveTitleFromMetadata(item))
  ?? titleCase(deriveTitleFromFilename(item.name))
```

At import, embedded metadata title is trimmed and stored when present; otherwise a deterministic filename-derived title is stored. The filename derivation removes only the final extension, replaces separators with spaces, preserves meaningful numbers/acronyms where possible, collapses whitespace, and title-cases ordinary words.

Existing projects without `title` use the render-time filename fallback until edited or migrated. Every user-facing media label uses the shared display-name helper. Technical diagnostics, relinking, and download surfaces may additionally show the true filename.

The detailed source investigation remains in [Media Title from Metadata Design](./2026-07-10-media-title-from-metadata-design.md).

## 4. Media Pane

The Media pane supports grid/list presentation, stable selection, search, sort, grouping, import, drag placement, add-at-playhead, missing-only filtering, and bulk relink.

It has exactly one pane-level toolbar row in this order:

1. flexible search field;
2. import button;
3. missing-only toggle with confirmed-missing count when non-zero;
4. relink-from-folder when confirmed-missing items exist;
5. group-by control;
6. collapse-all and expand-all controls when grouping is active.

Missing controls are never rendered as a competing second toolbar. Search, group, sort, and missing filter compose deterministically. Selection remains stable by media ID as filters change, but hidden selection is not acted on without explicit indication.

Groups are collapsible view state. Grouping and sorting do not mutate media records. Large libraries use stable item references, bounded subscriptions, lazy thumbnails, and virtualization where necessary.

## 5. Tags and Asset Versions

Tags are normalized, deduplicated labels stored on media metadata. Editing tags does not change media identity or create a version unless the product explicitly versions metadata edits.

Version history displays all items sharing `assetGroupId`, including the current item. Activating a previous version:

- changes the current marker without deleting subsequent versions;
- updates linked uses according to an explicit replace/current-version policy;
- is undoable;
- preserves provenance and immutable bytes;
- cannot result in zero or multiple current versions.

Generated variations create new media IDs in the intended asset group and store generation provenance defined by [Generation](./generation.md).

## 6. Runtime Availability

```ts
type MediaAvailability =
  | "available"
  | "verifying"
  | "temporarily_unavailable"
  | "confirmed_missing"
  | "decode_error"
  | "unauthorized";
```

Availability is runtime state keyed by project and media ID. It is not serialized into semantic project JSON and does not alter media identity or provenance.

- A backend media item without a current Blob starts `verifying`.
- Timeout, connection refusal, DNS, CORS-like rejection, abort, offline/HMR interruption, and `5xx` become `temporarily_unavailable`.
- `401` and `403` become `unauthorized`.
- Available bytes that cannot be decoded become `decode_error`.
- Only authoritative project-scoped absence may become `confirmed_missing`.

An absent Blob, failed hydration, broken thumbnail, or failed request is never by itself proof of missing durable media.

## 7. Verification

Verification is deduplicated per project/media ID, bounded, cancellable, retryable with backoff and jitter, and guarded by active project plus request generation.

The backend verifies both project mapping and stored object, returning version/ETag/size evidence when available. Authoritative `404` or `410`, rechecked when a manifest race is possible, may establish absence. When `HEAD` is unsupported, a small ranged `GET` is used.

HTML error bodies with `200`, invalid MIME/range metadata, zero or truncated objects, stale cache evidence, project-ID mismatch, and transport failures cannot establish availability. Late responses never update a different project or overwrite a newer relink.

## 8. Presentation and Recovery

Every surface consumes the same availability result.

| State | Presentation | Primary action | Missing count/filter |
|---|---|---|---|
| `available` | Normal asset | None | Excluded |
| `verifying` | Non-destructive progress | Verify/cancel | Excluded |
| `temporarily_unavailable` | Unavailable status | Retry | Excluded |
| `unauthorized` | Authentication status | Re-authenticate | Excluded |
| `decode_error` | Decode/corruption status | Retry/inspect source | Excluded |
| `confirmed_missing` | Missing treatment | Relink | Included |

Recovery atomically updates the Media pane, timeline, preview, inspector, missing filter/count, and Problems without reload. A transient state MUST NOT remove clips, clear media identity, prompt destructive relinking, or enter autosave JSON.

Relink validates the selected bytes before changing the item. It preserves stable identity when repairing the same version, regenerates transient thumbnails, resolves the corresponding problem, and updates every use. Confirmed removal is a separate explicit destructive action and must identify affected clips before proceeding.

## 9. Thumbnail and Fallback Data

Thumbnail source priority is:

1. valid current-session generated thumbnail or filmstrip;
2. durable stored thumbnail;
3. decoded frame from available media bytes or durable URL;
4. explicit first-frame/reference asset;
5. type-specific placeholder.

Fallback presentation does not change availability. A reference image can keep the UI informative while the source is verifying or unavailable, but the UI must still expose the actual availability state.

Thumbnail extraction is lazy, bounded, cached by media/version and parameters, cancellable, and invalidated on relink or version replacement. Page-scoped object URLs remain valid in the active page but are removed by [Project Lifecycle and Persistence](./project.md) before saving.

Timeline-specific filmstrip rendering is defined by [Timeline](./timeline.md).

## 10. Inspector and Problems

The asset inspector shows display title, true filename, metadata, availability, versions, tags, usages, and context-appropriate recovery. Its shell placement is defined by [Inspector Shell](./inspector-shell.md).

Availability and import failures use structured problems and logs from [Problems, Errors & Logging](./problems-errors-logging.md). Problems are deduplicated per project/media ID. Only `confirmed_missing` creates a durable missing-media problem.

## 11. Required Tests

Deterministic tests MUST cover import atomicity, title derivation, old-project display fallback, stable filtering/grouping, exactly one toolbar, version invariants, verification classification, project scoping, retry/cancel/late response handling, relink atomicity, shared recovery across consumers, thumbnail source priority, current-session object URLs, and persistence sanitization.

Browser verification MUST cover import, search/group/filter composition, drag/add placement handoff, title display, restored thumbnails, backend outage, authentication failure, confirmed missing relink, and recovery without reload.

## 12. Failure Modes

- Display code uses filename directly and bypasses `title`.
- Relink changes identity before validating replacement bytes.
- Transport failure increments the missing count.
- Different surfaces maintain divergent availability state.
- A late verification response mutates another project.
- Thumbnail failure is treated as media absence.
- Page-scoped URLs are persisted or rejected during their valid lifetime.
- Version activation deletes later versions or leaves multiple current items.
