# OpenReel Functional Specifications

This directory uses one canonical functional specification per subsystem. Redirect files preserve older inbound links but contain no independent normative requirements. Regression records remain unchanged except for links to their owning functional specifications.

## Canonical Specifications

| Subsystem | Canonical specification | Owns |
|---|---|---|
| Project | [Project Lifecycle and Persistence](./project.md) | Identity, creation, autosave, storage, Git history, restore, deletion |
| Media | [Media Assets](./media-assets.md) | Import, library, names, versions, thumbnails, availability, relinking |
| Timeline | [Timeline](./timeline.md) | Tracks, clips, grouping, placement, context menus, timeline rendering |
| Storyboard | [Storyboard](./storyboard.md) | Creative shots, generation and alteration of shot records, storyboard UI |
| Music video | [Music Video Workflow](./music-video-workflow.md) | Cross-subsystem music-video sequence and invariants |
| Audio/subtitles | [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) | Analysis, transcription, subtitle clips, caption import/edit/render/export contract |
| Song structure | [Song Sections](./song-sections.md) | Section inference, evidence, editing, confirmation, projection |
| AI generation | [AI Generation and Providers](./generation.md) | Provider boundary, models, references, jobs, finalization, adapters |
| References/generated images | [References and Generated Images](./references.md) | Typed media mentions, reference cards and roles, provider rewriting, generated-image creation and regeneration |
| Inspector | [Inspector / Right-Sidebar Shell](./inspector-shell.md) | Sidebar navigation, selection routing, reference pills, panel layout |
| Problems/logging | [Problems, Errors & Logging](./problems-errors-logging.md) | Problem and log models, lifecycle, actions, filtering, presentation |
| Export | [Export](./export.md) | Video, audio, image, sequence export, codecs, rendering and cancellation |
| Testing | [Testing Expectations](./testing-expectations.md) | Deterministic gates, regression tests, evals, organization and commands |

## Compatibility Redirects

| Retained filename | Canonical destination |
|---|---|
| [Track Grouping](./track-grouping.md) | [Timeline](./timeline.md) |
| [Media Import & Timeline Placement](./media-import-timeline.md) | [Media Assets](./media-assets.md), [Timeline](./timeline.md), and [Music Video Workflow](./music-video-workflow.md) |
| [Project Lifecycle](./project-lifecycle.md) | [Project Lifecycle and Persistence](./project.md) |
| [Backend, Persistence & Versioning](./backend-persistence-versioning.md) | [Project Lifecycle and Persistence](./project.md) |
| [Backend Save Worktree Race Fix](./2026-07-08-backend-save-worktree-race-fix.md) | [Project Lifecycle and Persistence](./project.md) |
| [Asset & Project Management](./asset-management-ux.md) | [Media Assets](./media-assets.md) and [Project Lifecycle and Persistence](./project.md) |
| [Thumbnails & Missing-File Fallbacks](./thumbnails-fallbacks.md) | [Media Assets](./media-assets.md) and [Timeline](./timeline.md) |
| [AI Generation & Providers](./ai-generation-providers.md) | [AI Generation and Providers](./generation.md) |
| [Atlascloud Provider Support](./atlascloud-provider.md) | [AI Generation and Providers](./generation.md) |
| [WaveSpeed Image and Video Generation](./wavespeed-generation.md) | [AI Generation and Providers](./generation.md) |
| [Sections Identification](./sections-identification.md) | [Song Sections](./song-sections.md) |
| [Audio Auto-Subtitle Extraction](./audio-auto-subtitle-extraction.md) | [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) |
| [Subtitle Track/Clip Type](./subtitle-track-clip-type.md) | [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) |
| [Auto Captions — Selected Clip Input Support](./2026-07-08-auto-caption-clip-input-spec.md) | [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) |
| [Music Video Timeline Native Decisions](./music-video-timeline-native/decisions.md) | [Music Video Workflow](./music-video-workflow.md) |
| [Music Video Timeline Native Tasks](./music-video-timeline-native/tasks.md) | [Music Video Workflow](./music-video-workflow.md) |

## Supporting Documents

- [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) records historical provenance and is not normative.
- [Media Title from Metadata Design](./2026-07-10-media-title-from-metadata-design.md) records the detailed source investigation behind [Media Assets](./media-assets.md#3-display-titles).
- [Known Issues](./known-issues.md) remains the issue register and is not modified by specification consolidation.

## Regression Contracts

Regression records preserve incident evidence, acceptance criteria, and regression-test requirements. A record's status describes the incident investigation, not implementation completion.

| Regression | Canonical owner(s) |
|---|---|
| [Backend outage false missing media](./regressions/backend-outage-false-missing-media-regression.md) | [Media Assets](./media-assets.md), [Project](./project.md) |
| [Editor header layout and menu](./regressions/editor-header-layout-and-menu-regression.md) | [Project](./project.md), [Inspector](./inspector-shell.md) |
| [Import video](./regressions/import-video-regression.md) | [Media Assets](./media-assets.md), [Timeline](./timeline.md) |
| [Media pane missing filter and toolbar](./regressions/media-pane-missing-filter-toolbar-regression.md) | [Media Assets](./media-assets.md) |
| [Project save archive integrity and dangling clips](./regressions/project-save-archive-integrity-and-dangling-clips-regression.md) | [Project](./project.md), [Media Assets](./media-assets.md), [Timeline](./timeline.md) |
| [Project save missing media](./regressions/project-save-missing-media-regression.md) | [Project](./project.md), [Media Assets](./media-assets.md) |
| [Project save async creation](./regressions/project-save-regression.md) | [Project](./project.md) |
| [Subtitle and caption](./regressions/subtitle-caption-regression.md) | [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) |
| [Timeline and media thumbnails](./regressions/timeline-and-media-thumbnail-regression.md) | [Media Assets](./media-assets.md), [Timeline](./timeline.md) |
| [Timeline clip placement and context menu](./regressions/timeline-clip-placement-and-context-menu-regression.md) | [Timeline](./timeline.md) |
| [Image preview and video thumbnail](./regressions/video-preview-broken-for-images-regression.md) | [Media Assets](./media-assets.md) |

## Implementation Plans

Plans under [`../superpowers/plans/`](../superpowers/plans/) are execution records, not specifications. Their audit status must be derived from current code, deterministic tests, required evals, and browser evidence. A plan moves to `plans/completed/` only when its scoped outcome conforms to the canonical specifications and every required verification gate has current evidence.

## Ownership Rule

When documents conflict, the canonical subsystem specification in this index controls functional behavior. A workflow, redirect, design, plan, regression record, or historical summary may add evidence and stricter regression acceptance criteria, but MUST NOT silently create a second definition of a functional contract. Any corrective regression requirement is incorporated into the owning canonical functional specification before implementation is declared complete.
