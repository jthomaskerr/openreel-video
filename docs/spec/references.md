# References and Generated Images

Status: Draft for review

## Scope and outcome

This specification owns:

- stable references to characters and image media inside generation prompts;
- the shared prompt mention editor and its rich `@` picker;
- reference cards and model-dependent reference roles;
- provider-specific prompt and request mapping for references;
- navigation from a mention or card to the referenced item;
- creation, conversion, editing, and regeneration of generated images.

[AI Generation and Providers](./generation.md) owns job execution and provider
boundaries. [Media Assets](./media-assets.md) owns media identity, versions, and
binary provenance. [Inspector Shell](./inspector-shell.md) owns modal and sidebar
placement. [Storyboard](./storyboard.md) owns shot creative intent.

The measurable outcome is that a user can type `@`, select a character or image,
see the selection as an inline pill and resolved reference card, assign any
model-supported role, and submit a provider-valid generation request without
typing provider syntax or copying URLs.

## 1. Design decisions

1. Prompt membership is the source of truth for user-selected references.
2. Automatic source and shot references remain authoritative in their owning
   records and appear in the same read-only reference presentation.
3. Persisted prompts use stable typed IDs. Display labels and thumbnails are
   resolved at render time and may change without changing prompt identity.
4. Provider-native prompt tokens and request fields are transient adapter
   output. They are never stored in project prompts.
5. A generated image is a logical, editable generation target. Binary
   provenance remains attached only to versions actually produced by a
   provider.
6. The same item editor renders in a modal and in the inspector sidebar.
7. Imported images are not converted merely by being referenced or opened.

## 2. Canonical prompt tokens

New picker selections serialize as:

```text
@{character:<character-id>}
@{media:<media-version-id>}
```

The rich editor renders these strings as atomic pills containing the resolved
display name and a micro-thumbnail. The stored prompt remains portable plain
text. Copy, paste, undo, redo, autosave, reload, and provider submission must
preserve the typed ID.

Legacy `@<character-slug>` tokens remain readable. Their existing stable binding
is used when available. Editing or reinserting a legacy mention writes the typed
character token.

The tokenizer must:

- recognize typed and legacy tokens without matching email addresses or partial
  words;
- report exact source ranges;
- preserve first-mention order;
- deduplicate reference resolution by typed entity identity;
- retain multiple textual occurrences in the prompt;
- distinguish unresolved, ambiguous, unavailable, and unsupported references;
- never infer a media item from a display title.

Deleting a pill removes its complete token. Backspace and Delete at a pill
boundary remove the pill atomically. Plain-text editing cannot leave a hidden
partial ID.

## 3. Shared media mention editor

All generation prompt surfaces use one `MediaMentionEditor`. A focused
Lexical-based editor is preferred over a custom `contenteditable` because
selection, composition input, clipboard behavior, undo, and accessibility must
be deterministic. Tiptap/ProseMirror is a valid alternative only if planning
finds a repository-wide editing requirement beyond this focused mention use
case.

Typing `@` opens a rich searchable menu at the caret. Additional text after `@`
filters the menu. The menu contains characters and image media from the active
project. Each option contains:

- a bold display title;
- a muted, one-line ellipsized description or generation prompt;
- a small fixed-size thumbnail on the right;
- an accessible type and availability label.

Characters use their display name, description, and primary image. Images use
the shared media display title, description, and current thumbnail. Missing
character primary images remain discoverable but are visibly unavailable.
Non-image media do not appear.

Arrow keys move through results, Enter or Tab selects, and Escape closes the
menu without changing the prompt. Pointer selection preserves editor focus.
The menu is an accessible combobox/listbox and announces result count and
unavailable entries.

Selecting an option inserts one pill at the caret. The pill displays its current
name and micro-thumbnail while retaining the stable typed token. Immediately
below the editor, every prompt surface displays:

```text
Type @ to refer to other media
```

The hint is subtle visual help, not placeholder text, and remains available to
assistive technology.

## 4. Reference resolution and cards

The References section is derived from the effective generation context. It
contains cards for:

1. a required source or first-frame image;
2. prompt-mentioned characters and image media in first-mention order;
3. explicit shot references in stored order.

The same media version appearing through multiple origins produces one card
with all origin labels. Each card shows a fixed-aspect thumbnail, name,
description or prompt, availability, and origins.

Cards are read-only except for a reference-role dropdown. The dropdown is shown
only when the selected generation model exposes more than one applicable role.
Examples include `first-frame`, `last-frame`, and general `reference-image`.
The UI uses normalized role IDs and labels supplied by model capability data.
Provider field names and prompt syntax do not leak into this control.

Role selections are stored in the generation draft under a stable reference
key, not embedded in the prompt. Changing models preserves compatible role
selections. An incompatible role or a reference beyond the new model maximum is
preserved, marked invalid and inactive, and excluded from submission.

Before submission, automatically invalidated or overflow references produce a
confirmation listing every excluded reference and reason. The dialog includes
`Do not show again`. Suppression is a user/workspace preference for this
warning class. It never hides invalid badges or inactive presentation. Manually
removing the prompt pill removes a prompt-derived reference and its stale role
assignment.

## 5. Item navigation

Clicking a mention pill or reference card opens the referenced item's
type-specific editor in a modal. Shift-click opens the same component directly
in the inspector sidebar.

- Character references open the character editor.
- Imported image references open the image inspector.
- Images with a generated-image definition open the generated-image editor.

The modal traps focus, restores focus to the invoking pill or card when closed,
and has an accessible title. Shift-click changes sidebar focus without opening
the modal. Missing or deleted targets open a recovery view rather than guessing
a replacement.

## 6. Generated image definition

Generated-image editability and binary provenance are separate contracts:

```ts
interface GeneratedImageDefinition {
  id: string;
  projectId: string;
  assetGroupId: string;
  currentMediaVersionId?: string;
  sourceMediaVersionId?: string;
  title: string;
  draft: {
    provider?: string;
    modelId?: string;
    prompt: string;
    negativePrompt?: string;
    roleByReferenceKey: Record<string, string>;
    inputs: Record<string, unknown>;
  };
  attemptIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

The final contract may extend the existing domain `GeneratedAsset`, but it must
retain the separation above. A `MediaItem.generationMeta` record means that
specific binary version was produced by a provider. It must not be added to an
imported binary merely to make the logical image regeneratable.

The shared `GeneratedImageEditor` renders in either a modal or the inspector
sidebar and contains:

- image-generator provider/model selection;
- title;
- the shared media mention prompt editor;
- the derived References section;
- negative prompt and schema-supported parameters;
- validation and estimated cost or limits when known;
- Generate, status, Cancel, Retry, and version history actions.

Closing the editor preserves its draft. Changing selection preserves drafts by
generated-image definition ID. Duplicate submission is disabled while a job is
active.

## 7. Media creation and conversion

The Media pane create control is one dropdown with:

- `Add Scene`;
- `Add Generated Image`.

`Add Generated Image` atomically creates an asset group, a generated-image
definition, and an unrealized image placeholder visible in Media, then opens its
generated-image editor. Closing without submitting leaves a valid editable
draft. Deleting that placeholder follows normal media deletion and affected-use
confirmation rules.

Every available image inspector places `Regenerate` next to `Replace`.

For an imported image, `Regenerate` atomically:

1. ensures the image belongs to an asset group;
2. creates a generated-image definition using the imported version as
   `sourceMediaVersionId` and current version;
3. preserves the imported bytes, filename, media ID, and provenance;
4. opens the generated-image editor.

For an existing generated image, `Regenerate` opens its existing definition and
recorded draft. It does not submit until the user chooses Generate.

A successful generation creates a new media version in the same asset group,
records complete generation provenance on that new version, makes it current
according to the explicit version policy, and retains the imported or earlier
versions. Conversion and current-version changes are undoable.

## 8. Provider mapping

The canonical resolver supplies typed references to the provider adapter:

```ts
interface ResolvedGenerationReference {
  key: string;
  mediaId: string;
  mediaVersionId: string;
  origins: Array<"source" | "character" | "prompt-media" | "shot">;
  role: string;
  canonicalTokens: string[];
  order: number;
}
```

The adapter owns all provider-specific mapping. For each provider/model it must:

1. select only schema-accepted fields;
2. order active references according to that API;
3. map normalized roles to exact fields or list entries;
4. rewrite canonical prompt tokens to exact provider-native positional or named
   syntax when required;
5. remove canonical tokens when references are carried only in structured
   fields;
6. reject unsupported cardinality, role, or media combinations before network
   submission.

For example, if a provider numbers only the active reference list, a stable
project token may map to a different transient provider position after another
reference is excluded. Rewriting therefore occurs after final reference
validation and ordering.

Every supported model requires a sanitized fixture captured from authoritative
provider documentation or live schema discovery. A fixture records model ID,
accepted fields, role mapping, limits, prompt-token rule, and a concrete request
example. Guessed rules such as an assumed Seedance `@reference_imageN` spelling
are forbidden.

## 9. Validation and failure modes

- Unresolved typed IDs remain visible as error pills and block submission when
  required.
- Missing optional media remains visible and requires explicit removal, relink,
  or acknowledged exclusion.
- A character without an available primary image cannot silently resolve to a
  different media item.
- Provider role or count changes preserve user data and mark affected
  references invalid and inactive.
- A generated image cannot depend directly or transitively on the version being
  generated. Dependency cycles block submission with the path shown.
- Deleting or replacing media never rewrites prompts silently.
- Provider-native tokens never enter saved prompts, project JSON, logs, or
  generated-image drafts.
- Cancellation stops polling but preserves the draft and prior current version.
- Conversion of imported media never claims that the imported binary was
  provider-generated.

## 10. Required evidence

Deterministic tests must cover:

- typed and legacy token parsing, ranges, copy/paste, and serialization;
- rename stability, duplicate mentions, missing IDs, and character image
  resolution;
- keyboard and pointer menu interaction, atomic pill deletion, focus recovery,
  and accessible combobox semantics;
- reference-card ordering, origin merging, role visibility, model switching,
  invalidation, overflow, and warning suppression;
- modal versus Shift-click sidebar routing;
- generated-image creation, imported-image conversion, draft persistence,
  cancellation, retry, and version/provenance invariants;
- dependency-cycle detection;
- provider mapping from canonical tokens to every supported fixture;
- rejection of unknown or schema-invalid provider fields.

Integration tests use fake provider servers and real project/media stores to
prove that the resolved references and sanitized request match while no local
IDs, temporary URLs, or credentials cross the provider boundary.

Browser verification covers:

- typing `@`, filtering, selecting by keyboard, and seeing the inline pill;
- matching reference cards and model-dependent role controls;
- click-to-modal and Shift-click-to-sidebar navigation;
- Add Generated Image;
- Regenerate on an imported image without losing its original version;
- generation, cancellation, retry, and final current-version selection;
- right-pane widths of 280, 320, and 420 pixels, 200% zoom, visible focus, and
  reduced motion.

The maintained provider eval includes multiple-reference image and video cases.
Release requires 100% technical pipeline completion, zero duplicate artifacts,
zero secret leakage, and at least 90% reference-adherence across the fixed
prompt set.
