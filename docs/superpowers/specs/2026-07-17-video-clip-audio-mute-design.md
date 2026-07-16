# Video Clip Audio Mute Repair

## Outcome

When a user enables **Mute clip audio** for a timeline video clip, that clip's embedded audio is silent during editor preview and export while its video remains visible. Unmuting restores the original clip volume.

## Root Cause

The inspector persists the mute state as `clip.muted`, and the export audio engine already consumes that field. Editor preview obtains playable audio through `getAudioPlaybackClips`, which filters hidden and muted tracks but does not filter muted clips. The preview scheduler therefore continues to queue a muted video clip's embedded audio.

## Design

Treat `clip.muted` as an audio-playback eligibility condition in `getAudioPlaybackClips`. Exclude a clip before media lookup and linked-audio handling when its mute flag is true. This keeps the fix at the shared preview-audio selection boundary used by native and multi-track playback, avoids scheduling unnecessary audio work, and leaves visual clip rendering unchanged.

No model, persistence, inspector, or export changes are required. Existing projects without the optional field retain the current default because only an explicit `true` value excludes a clip.

## Linked Audio

The existing duplicate-prevention rule remains unchanged: a video clip with a linked separated-audio clip does not fall back to embedded audio merely because the separated-audio track or clip is muted. Muting must never reveal a second audio source.

## Tests

Add deterministic regression coverage to `preview-audio-playback.test.ts` proving that:

1. A muted video clip with embedded audio is excluded from preview scheduling.
2. A muted audio-only clip is excluded from preview scheduling.
3. Existing linked-audio suppression tests continue to pass.

Verify the new test fails before the implementation change, then passes afterward. Run the focused test file, affected tests, and type checking. Finally, reproduce the editor flow in the browser: select a video clip, play it with audio, enable **Mute clip audio**, and confirm playback is silent while the video still advances and no relevant console errors appear.

## Failure Modes

- Filtering only the video element would not work because preview video elements are already muted and audio is emitted by the real-time audio graph.
- Setting scheduled volume to zero would retain unnecessary decoding and scheduling work and could allow later automation to reintroduce gain.
- Changing linked-audio detection to ignore muted separated clips could unexpectedly restore embedded video audio, so that behavior must remain unchanged.
