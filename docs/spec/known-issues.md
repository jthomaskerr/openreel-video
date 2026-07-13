# Known Issues

## WebKit thumbnail browser regression gate

**Status:** Outstanding

**Related regression:** `regressions/timeline-and-media-thumbnail-regression.md`

The deterministic tests now require persisted videos to generate thumbnails from
their durable backend media URL and explicitly prohibit the downloaded media blob
from being passed to thumbnail generation. Unit and component tests cover hydration,
serialization, and renderer URL selection.

The remaining gap is a real WebKit browser regression test. The repository does not
currently run the persisted-project workflow in WebKit. Until that gate exists, CI
cannot prove that Orion/Safari can decode the backend URL, seek, capture a canvas
frame, and display the resulting thumbnail in both the Media pane and timeline.

Required browser test:

1. Start the frontend and backend with a persisted project fixture containing a real
   MP4, `thumbnailUrl: null`, and a valid backend media mapping.
2. Load the project in Playwright WebKit.
3. Assert no requested thumbnail source starts with `blob:`.
4. Assert every expected Media-pane video image has non-zero natural dimensions.
5. Assert every expected timeline video clip has a thumbnail background.
6. Fail on `WebKitBlobResource`, media decode, canvas security, or unhandled resource
   errors.
7. Reload and repeat to cover persisted hydration rather than only live import.

This issue remains open until that test runs in the normal merge gate.
