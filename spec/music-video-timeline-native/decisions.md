# Music Video Timeline Native Decisions

## 2026-06-28 — Timeline-native workflow
- Context: User rejected wizard/sidebar Music Video UX.
- Decision: Music Video starts from audio import, creates timeline audio + metadata clips, and uses selected metadata clip inspector for editing.
- Rejected: standalone MusicVideoPanel card in AI Tools.
- Tradeoff: more timeline/store integration up front; simpler mental model and fewer disconnected panels.

## 2026-06-28 — Real media for metadata clips
- Context: clip/add validation requires mediaId to exist in mediaLibrary.
- Decision: Every metadata clip gets a real generated local image MediaItem.
- Rejected: empty string media IDs, validator bypasses, fake IDs.
- Tradeoff: small generated blobs in media storage; action validation stays honest.

## 2026-06-28 — Asset version history
- Context: Blob overwrite loses generated version history.
- Decision: Each version is a separate MediaItem sharing assetGroupId; one item is current.
- Rejected: overwriting an existing blob as version history.
- Tradeoff: more media records; recoverable, auditable generation history.

## 2026-06-28 — Generation jobs
- Context: WaveSpeed polling currently lives in the dialog and disappears with UI lifecycle.
- Decision: KieAI and WaveSpeed jobs use one persistent job store plus poller and management panel.
- Rejected: fire-and-forget dialog polling.
- Tradeoff: adds a small store; jobs survive navigation and can be retried/managed.
