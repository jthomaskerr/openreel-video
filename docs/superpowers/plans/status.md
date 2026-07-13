# Plans Status

**Audited:** 2026-07-13 16:16 AEST

**Canonical specification index:** [Specification index](../../spec/index.md)

**Completed-plan archive:** [Completed plans](./completed/README.md)

## Scope and Method

This is the authoritative point-in-time summary for `docs/superpowers/plans`. The audit compared each plan with the canonical specifications, implementation and test evidence in the repository, and current worktree state. A plan's own checkboxes, percentages, status labels, and historical test claims were not accepted without corroborating evidence.

The active directory contains 30 dated documents: 20 executable plans, 8 findings documents, and 2 historical indexes. No executable plan currently satisfies all applicable implementation, specification-conformance, deterministic-test, eval, browser-verification, and delivery requirements, so 0 plans were moved to `completed/`.

## Executable Plans

| Plan | Relevant specification | Audited state | Current evidence | Blocking next action |
|---|---|---|---|---|
| [Timeline-native music video](./2026-06-28-music-video-timeline-native.md) | [Music-video workflow](../../spec/music-video-workflow.md), [timeline-native tasks](../../spec/music-video-timeline-native/tasks.md) | Partial, substantially implemented | Tasks 1-6 and 8-16 are substantially present; Task 7 is partial | Complete Task 7 and run the Task 17 end-to-end browser flow |
| [Backend autosave and Git LFS](./2026-07-01-backend-autosave-git-lfs.md) | [Backend persistence](../../spec/backend-persistence-versioning.md), [project lifecycle](../../spec/project-lifecycle.md) | Partial and nonconformant | Persistence infrastructure exists, but new-project identity is still created locally and swapped asynchronously | Make backend creation authoritative and verify offline/retry/reload behavior |
| [Alter storyboard tool](./2026-07-03-alter-storyboard-tool.md) | [Storyboard](../../spec/storyboard.md), [generation](../../spec/generation.md) | Not started; plan revision required | No conforming alteration tool implementation was found | Revise for the local Claude Code boundary, then implement tests and evals |
| [AtlasCloud support](./2026-07-03-atlascloud-support.md) | [AtlasCloud provider](../../spec/atlascloud-provider.md), [AI providers](../../spec/ai-generation-providers.md) | Not started; externally blocked | No provider implementation or authoritative contract evidence was found | Obtain authoritative provider documentation before revising the plan |
| [Audio analysis and selection](./2026-07-03-audio-analysis-and-selection.md) | [Audio analysis](../../spec/audio-analysis-subtitles.md), [song sections](../../spec/song-sections.md) | Not started | No complete analysis/selection workflow or required evidence was found | Implement the deterministic analysis boundary and its tests |
| [Audio auto-subtitle extraction](./2026-07-03-audio-auto-subtitle-extraction.md) | [Auto-subtitle extraction](../../spec/audio-auto-subtitle-extraction.md), [subtitle model](../../spec/subtitle-track-clip-type.md) | Pipeline not started; output model nonconformant | Existing caption paths do not provide the planned job pipeline and still target text clips | Implement the job pipeline against first-class subtitle clips |
| [Generate storyboard tool](./2026-07-03-generate-storyboard-tool.md) | [Storyboard](../../spec/storyboard.md), [generation](../../spec/generation.md) | Not started; plan revision required | No conforming generation tool implementation was found | Revise for local Claude Code, then add deterministic contracts and evals |
| [Section identification flow](./2026-07-03-section-identification-flow.md) | [Section identification](../../spec/sections-identification.md), [song sections](../../spec/song-sections.md) | Domain skeleton only | Basic domain structures exist without the complete identification flow | Implement analysis, persistence, UI integration, tests, and evals |
| [Storyboard UI](./2026-07-03-storyboard-ui.md) | [Storyboard](../../spec/storyboard.md) | Not started | No complete storyboard editing surface matching the plan was found | Implement after the generation and alteration contracts stabilize |
| [Subtitle track and clip type](./2026-07-03-subtitle-track-clip-type.md) | [Subtitle model](../../spec/subtitle-track-clip-type.md), [caption regression](../../spec/regressions/subtitle-caption-regression.md) | Partial and nonconformant | Subtitle track support exists, but a first-class `SubtitleClip` and complete CRUD/export tests do not | Introduce the first-class clip model and remove skipped conformance tests |
| [Track grouping expansion](./2026-07-03-track-grouping-expansion.md) | [Track grouping](../../spec/track-grouping.md), [timeline](../../spec/timeline.md) | Not started beyond generic metadata | Generic scene metadata exists without the required grouping behavior | Implement the grouping contract and timeline interactions |
| [AI generation providers implementation](./2026-07-05-ai-generation-providers-implementation.md) | [AI providers](../../spec/ai-generation-providers.md), [generation](../../spec/generation.md) | Historical partial decomposition | Some provider-oriented contracts exist; the document is not evidence of complete provider support | Reconcile remaining provider work into current provider-specific plans |
| [Backend save worktree race fix](./2026-07-08-backend-save-worktree-race-fix.md) | [Race-fix spec](../../spec/2026-07-08-backend-save-worktree-race-fix.md), [backend persistence](../../spec/backend-persistence-versioning.md) | Race fixed; identity flow nonconformant | Focused race tests pass, but backend-authoritative project creation remains unresolved | Replace local-first identity creation and verify the complete save lifecycle |
| [SRT drag/drop stall fix](./2026-07-08-srt-drag-drop-stall-fix.md) | [Auto-caption input](../../spec/2026-07-08-auto-caption-clip-input-spec.md), [subtitle model](../../spec/subtitle-track-clip-type.md) | Stall partially fixed; model nonconformant | Import behavior improved, but generated captions still use text clips | Complete first-class subtitle ingestion and browser verification |
| [Auto captions from selected clips](./2026-07-08-subtitle-files.md) | [Auto-caption input](../../spec/2026-07-08-auto-caption-clip-input-spec.md), [subtitle model](../../spec/subtitle-track-clip-type.md) | Substantially implemented; model and verification incomplete | Selected audio/video transcription, microphone preservation, error states, and component tests exist | Complete first-class subtitle output and run the browser/backend matrix |
| [Media title from metadata](./2026-07-10-media-title-from-metadata.md) | [Media-title design](../../spec/2026-07-10-media-title-from-metadata-design.md), [media assets](../../spec/media-assets.md) | Mostly implemented | Tasks 1-3 and 5 are implemented; constructor coverage and final proof remain incomplete | Normalize all import constructors and complete browser/full-suite evidence |
| [WaveSpeed generation](./2026-07-10-wavespeed-generation.md) | [WaveSpeed](../../spec/wavespeed-generation.md), [AI providers](../../spec/ai-generation-providers.md) | Partial deterministic foundation | Contracts, context, and schema exist; server submission/finalization/UI/recovery are partial | Implement timed audio/cache, finalization, recovery, and provider/browser gates |
| [Editor header layout and menu](./2026-07-13-editor-header-layout-and-menu.md) | [Header regression](../../spec/regressions/editor-header-layout-and-menu-regression.md) | Worktree implementation; verification open | Current source contains the planned layout/menu changes | Run exact desktop/mobile browser scenarios and delivery gates |
| [Media-pane missing filter toolbar](./2026-07-13-media-pane-missing-filter-toolbar.md) | [Media-pane regression](../../spec/regressions/media-pane-missing-filter-toolbar-regression.md), [asset UX](../../spec/asset-management-ux.md) | Deterministic implementation present; verification open | Tasks 1-4 and focused component tests pass | Run the exact browser transitions and complete delivery gates |
| [Project-save archive integrity and dangling clips](./2026-07-13-project-save-archive-integrity-and-dangling-clips.md) | [Archive-integrity regression](../../spec/regressions/project-save-archive-integrity-and-dangling-clips-regression.md), [backend persistence](../../spec/backend-persistence-versioning.md) | Tasks 1-7 implemented; remainder open/partial | Save serialization and Git receipts are present; broader archive/recovery/UI work is incomplete | Complete Tasks 8-12A first, then resolve partial Tasks 13-16 |

## Findings Documents

These are audit inputs, not executable plans. Their original percentages and status language are historical; each file's `Current State` section records the current disposition.

| Findings document | Governing specification | Current disposition |
|---|---|---|
| [Asset-management UX findings](./2026-07-05-asset-management-ux-findings.md) | [Asset-management UX](../../spec/asset-management-ux.md) | Mixed implementation; current gaps are owned by media-pane, media-title, and lifecycle work |
| [Export-pipeline findings](./2026-07-05-export-pipeline-findings.md) | [Export](../../spec/export.md) | Historical audit; unresolved subtitle/export conformance remains active |
| [Inspector-shell findings](./2026-07-05-inspector-shell-findings.md) | [Inspector shell](../../spec/inspector-shell.md) | Historical audit; not independently archivable |
| [Media import/timeline findings](./2026-07-05-media-import-timeline-findings.md) | [Media import/timeline](../../spec/media-import-timeline.md) | Mixed implementation with current regression ownership linked in-file |
| [Problems/errors/logging findings](./2026-07-05-problems-errors-logging-findings.md) | [Problems/errors/logging](../../spec/problems-errors-logging.md) | `problemBus` exists; retry still resolves a problem immediately after enqueue |
| [Project-lifecycle UX findings](./2026-07-05-project-lifecycle-ux-findings.md) | [Project lifecycle](../../spec/project-lifecycle.md) | Backend-authoritative creation and recovery remain nonconformant |
| [Testing-expectations findings](./2026-07-05-testing-expectations-findings.md) | [Testing expectations](../../spec/testing-expectations.md) | Historical audit; browser/eval evidence gaps remain across active plans |
| [Thumbnails/fallbacks findings](./2026-07-05-thumbnails-fallbacks-findings.md) | [Thumbnails/fallbacks](../../spec/thumbnails-fallbacks.md) | Mixed implementation; current regression ownership is recorded in-file |

## Historical Indexes

| Document | Current role |
|---|---|
| [Spec-gap priorities](./2026-07-05-spec-gap-priorities.md) | Historical prioritization snapshot; percentages are not authoritative and current owners are linked in its audit section |
| [Alignment](./2026-07-08-alignment.md) | Historical cross-document alignment snapshot; superseded claims are reconciled in its audit section |

## Priority Order

1. Complete project-save Tasks 8-12A: archive manifest/integrity, dangling-clip handling, and recovery foundations.
2. Implement the first-class subtitle model and migrate caption import, CRUD, and export paths.
3. Run and record exact browser verification for the media-pane, editor-header, and timeline-native music-video flows.
4. Complete WaveSpeed timed audio/cache, finalization, recovery, and provider/browser gates.
5. Implement storyboard generation, alteration, and UI after revising their LLM boundary; complete song-section analysis work.
6. Close testing-compliance gaps, including deterministic gates, required LLM evals, and traceable browser evidence.

## Verification Evidence

- The backend save race suite previously passed 3/3 focused tests.
- The media-title focused suites previously passed 64/64 tests.
- The focused `AssetsPanel.test.tsx` and `Toolbar.test.tsx` command exited successfully during this audit; output contained only existing Node local-storage and Zustand deprecation warnings.
- All 82 links in the updated specification index were previously validated.
- All 30 active dated documents contain a `Current State (Audited 2026-07-13 16:16 AEST)` section.
- No browser verification was run for this documentation audit. Existing browser-dependent plans therefore remain open unless independent repository evidence already proves the required scenario.

## Archive Decision and Failure Modes

No plan was moved to `completed/`. Archival requires more than substantial code presence: the implementation must conform to the canonical spec, required deterministic tests and probabilistic evals must pass, required browser scenarios must be evidenced, and delivery must be complete.

Important audit failure modes remain:

- Worktree implementation may change after this timestamp; this file is a snapshot, not live telemetry.
- Passing focused tests does not prove browser behavior, provider behavior, recovery behavior, or full-suite compatibility.
- Historical plan checkboxes can overstate completion when the canonical specification changed or the implementation uses a nonconformant model.
- Provider integrations cannot be called complete without authoritative provider contracts and real boundary verification.
- The current first-class subtitle-model gap blocks honest completion claims for caption import and export work.
- Backend local-first project identity can race with persistence even where isolated save-worktree race tests pass.

The next audit should update this file and the affected plan's `Current State` section together, using fresh implementation and verification evidence.
