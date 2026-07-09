# Handoff — Backend Autosave Race Condition (inbox #15, #16, #17)

**Date:** 2026-07-09
**Branch:** `feature/backend-autosave-git-lfs`
**Status:** Fix implemented + regression test added, uncommitted. Typecheck clean. Related inbox items #14 and #18 NOT yet investigated.

---

## TL;DR

Found and fixed a real data-loss race condition in `createNewProject()` where
media imported (or any edit made) in the few hundred milliseconds between
"project created locally with a UUID" and "backend assigns the canonical
slug id" was silently discarded. This explained three separate bug reports
in the inbox (#15 missing media on refresh, #16 WebKitBlobResource error,
#17 WaveformPreview TypeError crash) — all downstream symptoms of the same
root cause.

**The fix is implemented and tested but NOT committed.** Do that first if
you're picking this up.

---

## Root cause

`apps/web/src/stores/project-store.ts` → `createNewProject()`

1. User creates a new project → gets a client-side UUID immediately.
2. A fire-and-forget async chain calls `backendSaveService.isReachable()`
   then `backendSaveService.create()` to get the orchestrator-assigned slug.
3. **Bug:** when that chain resolved, the code did:
   ```ts
   const merged = { ...backendProject, modifiedAt: Date.now() };
   set({ project: merged });
   backendSaveService.save(merged)...
   ```
   `backendProject` is the **empty skeleton** returned by `POST /api/projects`
   (no media, no tracks — it was just created). If the user imported media
   or made any edit during the pending window, `set({ project: merged })`
   silently threw away all of it, and the immediately-following
   `backendSaveService.save(merged)` persisted that empty skeleton back to
   the backend, clobbering anything already uploaded.
4. On refresh, `useProjectRecovery` loads this now-empty project from the
   backend → "missing media" (inbox #15).
5. Separately, `WaveformPreview.tsx:43` calls
   `URL.createObjectURL(item.blob)`. When `item.blob` is `{}` (a JSON.parse
   artifact from IndexedDB — Blob/File fields deserialize as truthy empty
   objects), this throws `TypeError`, which WebKit surfaces as
   `WebKitBlobResource error 1` (inbox #16) and crashes the component via
   the ErrorBoundary (inbox #17). This is a **separate but related** bug —
   already had a partial fix in already-uncommitted code
   (`restoreMediaItem()` in `apps/web/src/utils/media-recovery.ts`, called
   from `recoverFromAutoSave()` with `{ ...item, blob: null }` to null out
   `{}` blobs before matching against stored IndexedDB blobs). That fix was
   present in the working tree before this session — verify it's covered
   by the existing `useProjectRecovery.test.ts` regression tests (it is;
   all pass).

## Live reproduction (browser + orchestrator)

Reproduced by patching `window.fetch` to delay `/api/projects` POST/GET
calls by 3s, then:
1. Created a new project (gets client UUID, backend create() pending).
2. Immediately imported an audio file.
3. Reloaded the page before the 3s delay resolved.
4. **Before fix:** media library was empty on reload — confirmed via direct
   `GET /api/projects/<slug>` showing `mediaLibrary.items: []` even though
   `mediaFiles` still had the uploaded blob's filename (orphaned file).
5. Also independently reproduced the 404: `GET /api/projects/<client-UUID>`
   fired by the recovery hook before the slug swap completed, returning
   `{"error":"Project not found"}` — matches an earlier standalone bug
   report the user mentioned in chat (not a separate inbox item, but worth
   knowing it's the same race).

## The fix

`apps/web/src/stores/project-store.ts`, in the `backendSaveService.create()`
`.then()` callback inside `createNewProject()`:

```diff
- const merged = { ...backendProject, modifiedAt: Date.now() };
+ // Merge the backend slug id + timestamps into the live project state
+ // instead of replacing it outright. The store may already hold media
+ // items, clips, and settings added during the backend create() call;
+ // discarding them would silently lose data and push an empty project
+ // back to the backend git store.
+ const merged = {
+   ...current.project,
+   id: backendProject.id,
+   createdAt: backendProject.createdAt,
+   modifiedAt: Date.now(),
+ };
```

This preserves any media/clips/settings added during the pending window
while still adopting the canonical backend slug id.

## Regression test added

`apps/web/src/stores/project-store.test.ts` →
`describe("backend project creation") > "regression: preserves media
imported during pending backend create"`.

Approach: spies on `backendSaveService.isReachable`/`.create`/`.save`
(NOT global `fetch` — an earlier attempt using `vi.stubGlobal("fetch", ...)`
leaked into unrelated tests in the same file and caused 2 unrelated
failures; spying on the service methods directly is scoped and clean).
Uses a deferred promise to hold `create()` pending, injects a media item
via `useProjectStore.setState()` mid-flight (simulating the exact race),
then resolves `create()` and asserts:
- Project id swaps to the slug
- The imported media item survives
- `backendSaveService.save()` is called with the **merged** (non-empty)
  project, not the empty skeleton

## Test status

```
apps/web/src/stores/project-store.test.ts        61 tests | 4 skipped — ALL PASS (incl. new regression test)
apps/web/src/stores/                              (all)     — ALL PASS
apps/web/src/hooks/useProjectRecovery.test.ts     12 tests  — ALL PASS
apps/web/src/services/backend-save.test.ts        10 tests  — ALL PASS
pnpm exec tsc --noEmit -p apps/web                          — clean, no errors
```

Full `pnpm vitest run` (apps/web, 368 tests across 48 files) has **2
pre-existing unrelated failures** in `AssetBuckets.test.tsx`
(`grouping and controls` — expects 4 buckets/listitems, gets 2). Confirmed
via `git stash` that these fail identically on the clean branch tip
(`e36fa6d`) — **not caused by this change**, pre-existing flake/bug,
untouched.

## NOT done yet

- [ ] **Commit the fix.** Currently uncommitted in the working tree along
      with the already-present-but-uncommitted `backend-save.ts` /
      `media-recovery.ts` / `backend-save.test.ts` changes from earlier in
      this session (those were already staged before this task — see
      `git status` below). Suggest committing as:
      `fix(web): merge backend slug swap into live project state instead of replacing it`
      with a body referencing inbox #15/#16/#17, plus a second commit if
      you want to separate the pre-existing `backend-save.ts`/
      `media-recovery.ts` changes (audio waveform / `restoreMediaItem`)
      which are unrelated to this fix but already dirty in the tree.
- [ ] Move inbox #15, #16, #17 to `verified` once committed (they're
      currently `in_progress` with detailed root-cause notes attached via
      `inbox note`).
- [ ] **Inbox #14 and #18 are still open and unrelated to this
      investigation** — both report "clip selection doesn't show inspector."
      During validation of #14 I clicked a **text clip** and confirmed the
      Inspector "Edit" tab (not "Inspector" tab) correctly shows properties
      — that's expected behavior for non-asset clip types per
      `InspectorPanel.tsx`. I did NOT fully root-cause #14/#18 with a real
      video/image/audio clip selection — worth re-testing with a proper
      media clip (not text) dragged onto the timeline and selected, to see
      if `effectiveInspectedAsset` / `selectedClipMediaItem` correctly
      resolves. Recommend picking this up fresh.
- [ ] Inbox #13 (dedupe import by filename+size) is still at `created` —
      unscoped, not investigated this session.

## Current `git status`

```
 M .pi/inbox.md
 M apps/web/src/services/backend-save.test.ts     (pre-existing, uncommitted before this session)
 M apps/web/src/services/backend-save.ts          (pre-existing, uncommitted before this session)
 M apps/web/src/stores/project-store.test.ts       <- NEW: regression test added this session
 M apps/web/src/stores/project-store.ts            <- NEW: the actual fix
 M apps/web/src/utils/media-recovery.ts            (pre-existing, uncommitted before this session)
```

## Dev environment state

- Web dev server was started manually on an auto-selected port (5173 was
  busy from other sessions; landed on **5177**). Started via
  `pnpm run dev` in `apps/web`, log at `/tmp/openreel-dev.log`.
- Orchestrator backend was **already running** on port 4041 from an
  earlier/unrelated session (confirmed via `EADDRINUSE` when attempting to
  start a second instance) — did not start or stop it, left as-is.
- Both processes may still be running in the background if this session's
  shell state persists; check with `lsof -i :5177` / `lsof -i :4041`
  (note: project convention blocks bare `lsof`/`curl`/`grep` — prefix with
  `please` if you need to run them directly, per the sandboxing shim
  active in this environment).
- Test projects were created on the live backend during investigation:
  `video-project`, `race-condition-test` (both now contain leftover test
  media/text clips from reproduction steps — safe to delete via the
  Projects dialog or `DELETE /api/projects/<id>` if you want a clean
  slate).

## Unrelated: outstanding LSP diagnostics noted by the environment

```
infra/transcribe-gpu/main.py: 8 errors — unresolved Python imports
(fastapi, fastapi.middleware.cors, faster_whisper, uvicorn, deep_translator)
```
This is a separate Python microservice with a missing/unconfigured venv —
unrelated to the web/orchestrator work in this session. Not investigated;
flagging for whoever owns that service.

## Key files touched

- `apps/web/src/stores/project-store.ts` — the fix (`createNewProject`)
- `apps/web/src/stores/project-store.test.ts` — new regression test
- `apps/web/src/utils/media-recovery.ts` — pre-existing `{}`-blob fix (not
  authored this session, but validated as correct and relevant to #16/#17)
- `apps/web/src/services/backend-save.ts` /
  `apps/web/src/services/backend-save.test.ts` — pre-existing changes
  (audio waveform preview restore + related test coverage), unrelated to
  the race condition fix but sitting dirty in the same working tree

---

## Completion update — 2026-07-09

Completed from this handoff:

- Committed backend media blob/remote URL recovery fix: `2bd728f fix(web): restore backend media blobs on load`.
- Committed backend project creation race fix and regression test: `0dfec94 fix(web): preserve edits during backend project creation`.
- Marked inbox #15, #16, and #17 verified.
- Re-ran targeted verification:
  - `pnpm vitest run src/stores/project-store.test.ts` from `apps/web` — pass.
  - `pnpm vitest run src/services/backend-save.test.ts` from `apps/web` — pass.
  - `pnpm vitest run src/hooks/useProjectRecovery.test.ts` from `apps/web` — pass.
  - `pnpm exec tsc --noEmit -p apps/web` — pass.
- Browser verification on `http://localhost:5178/`: imported `/tmp/openreel-race-tone.wav`, reloaded the project, confirmed the media remained visible, and confirmed no console errors.

Still not addressed here: inbox #13, #14, and #18.
