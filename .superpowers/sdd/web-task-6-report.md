# Web Task 6: External media deletion feedback

## Outcome

Externally referenced media now presents explicit deletion protection in the asset Inspector:

- Delete is a native disabled button with the accessible name `Delete asset`.
- Persistent helper text explains that an external Resolve project references the asset and that replacement and metadata editing remain available.
- The same explanation is available from an existing tooltip primitive through a focusable trigger around the disabled control.
- The helper includes a vector link icon and text, so protection is not communicated by color alone.
- Media without the external-reference marker keeps the normal enabled Delete action.

The project-store regression also proves that `EXTERNAL_MEDIA_DELETE_BLOCKED` passes through unchanged, leaves the project and media intact, does not add a failed delete to action history, and preserves undo of the preceding metadata edit.

## TDD evidence

### RED

Command:

```bash
rtk pnpm --filter @openreel/web exec vitest run src/components/editor/inspector/AssetInspectorWithTabs.test.tsx src/stores/project-store.test.ts
```

Result before the Inspector implementation: 2 Inspector tests failed because no accessible `Delete asset` control existed; the project-store suite and new history regression passed.

### GREEN

The same focused command passed after implementation:

- 2 test files passed
- 77 tests passed
- 4 tests skipped
- 0 tests failed
- Duration: 11.42 seconds

## Other verification

- `rtk pnpm --dir apps/web exec tsc --noEmit`: passed with no errors.
- Serena diagnostics: no diagnostics in the Inspector implementation, Inspector tests, or project-store tests.
- `rtk git diff --check`: passed.
- Browser connection: unavailable in this delegated session. The parent session must perform the repository-required live browser check before declaring the full UI feature complete.

## Failure modes covered

- Externally referenced media is deleted from the Inspector.
- Protection is conveyed only through color or hover.
- Replacement or metadata controls are accidentally disabled with deletion.
- Ordinary media loses its Delete action.
- The core error code is translated or discarded by the web store.
- A blocked delete mutates project/media state or inserts a bogus undo entry.
- A blocked delete corrupts the preceding valid undo history.
