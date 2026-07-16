# Image Media on Video Tracks Regression

**Canonical functional specs:** [Timeline](../timeline.md) and [Media Import and Timeline](../media-import-timeline.md).

**Status:** Fixed regression contract.

**Outcome:** An image can be placed on an unlocked video track through every timeline insertion path.

## Reported Symptom

Dragging an image onto a video track, or pressing the Media-pane plus button while a video track is selected, rejects or redirects the image even though video tracks are defined to contain visual media.

## Required Behavior

1. An unlocked video track MUST accept both video and image media.
2. Dragging an image onto an unlocked video track MUST show the normal drop preview and MUST commit the image clip to that exact track and resolved timeline time.
3. Pressing plus on an image while an unlocked video track is selected MUST insert the image on that selected video track at the captured scrub/playhead time. It MUST NOT create or select a separate image track.
4. Image tracks MAY continue to accept images. Audio and subtitle tracks MUST reject images.
5. Locked video tracks MUST reject image placement with the normal locked-track reason.
6. All web insertion paths MUST use the shared core track/media compatibility contract. They MUST NOT independently compare media type and track type for equality.

## Deterministic Regression Scenarios

1. Given an image drag at 22.5 s over an unlocked video track, the preview is valid and the committed call uses that video track ID, image media ID, and `22.5`.
2. Given an image, an active unlocked video track, and a scrub position of 4.5 s, Media-pane insertion adds the clip to the video track at `4.5` without adding a track.
3. The shared compatibility matrix returns true for image media on both video and image tracks, and false for image media on audio and subtitle tracks.
4. A locked video track rejects an image before any clip mutation.

## Required Automated Evidence

- A focused compatibility test for image media on a video track.
- A rendered `TrackLane` drag/drop test proving the valid preview and committed placement.
- A Media-pane insertion test proving that the active video track is retained and no image track is created.

## Important Failure Modes

- Replacing the shared compatibility contract with `mediaType === track.type`.
- Treating the default track type for newly created tracks as the complete compatibility matrix.
- Fixing drag/drop while leaving plus-button insertion or another placement path strict.
- Redirecting a valid image placement to an image track without telling the user.
