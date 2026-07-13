# Timeline Clip Placement and Context Menu Regression

**Status:** Open regression contract.

**Outcome:** Media enters the selected timeline track at the user's intended time, and timeline context menus open at the pointer that invoked them.

## Reported Symptoms

1. Media dragged from the Media pane can be inserted at a time other than the visible drop position.
2. Pressing a media item's plus button can append the clip or place it on the wrong track instead of inserting it at the current scrub time on the selected compatible track.
3. Right-clicking a timeline clip can open its context menu away from the click position.

## Required Behavior

### Drag from the Media Pane

Dropping media on a compatible timeline track MUST set the new clip's `trackId` to the track under the pointer and its `startTime` to the timeline time represented by the pointer's horizontal drop coordinate. Coordinate conversion MUST account for the track content origin, horizontal scroll, and current timeline zoom. The result MUST be independent of the playhead position.

The drop preview and committed clip MUST resolve to the same track and time. Normal snapping MAY adjust both to the same displayed snap target. The implementation MUST NOT use a stale drag-over coordinate, append time, or event coordinate relative to the Media pane.

If the target track is locked or incompatible with the media type, the UI MUST reject the drop visibly and MUST NOT create a clip or silently redirect it to another track.

### Media Plus Button

Pressing the plus button on a Media-pane item MUST insert the new clip on the currently selected compatible track with `startTime` equal to the current scrub/playhead time at the moment the button is pressed.

If no track is selected, or the selected track is locked or incompatible, the application MUST select or create the documented default compatible track and still insert at the captured scrub time. It MUST NOT append to the end of that track. The resulting clip MUST become selected.

### Timeline Context Menus

Right-clicking a clip or empty timeline space MUST anchor the opened menu at the invoking pointer's viewport coordinates. The position MAY be clamped to the viewport edges so the full menu remains visible. Horizontal timeline scroll, vertical page or panel scroll, and timeline zoom MUST NOT offset the menu from the pointer.

Opening a new context menu MUST replace any previous menu and its coordinates. Dismissing and reopening MUST not reuse stale coordinates.

## Deterministic Regression Scenarios

1. With the playhead at 1 s, drag a 4 s video from the Media pane to 12.5 s on an unlocked video track. The committed clip has that track's ID and `startTime === 12.5` (or the exact snap target shown by the drop preview), not 1 s and not the previous track end.
2. Horizontally scroll and zoom the timeline, then repeat a drop at a known ruler time. Converting the pointer through the current scroll and zoom yields the committed `startTime`, and the preview matches it.
3. Select an audio track, place the scrubber at 7.25 s, and press plus on an audio media item. The new selected clip has the audio track's ID and `startTime === 7.25`.
4. With an incompatible or locked selected track, press plus. A compatible default track is selected or created, and the clip is inserted there at the captured scrub time; no clip is appended elsewhere.
5. Right-click near each viewport edge on both a clip and empty track space after scrolling and zooming. Each menu appears at the click, except for the minimum edge clamp needed to keep it visible.
6. Right-click two distant clips in succession. The second menu uses the second event's coordinates and target clip.

## Required Automated Evidence

- Unit tests for the shared pointer-to-timeline-time conversion at multiple zoom and horizontal-scroll values.
- Timeline interaction tests proving drag preview and committed placement share the same resolved track and time.
- Media-pane tests proving plus-button insertion captures the current scrub time and selected compatible track, including fallback behavior.
- Context-menu tests proving clip and empty-space menus use current viewport pointer coordinates and edge clamping rather than clip-relative or stale coordinates.
- A browser regression test that performs the drag, plus-button insertion, and right-click scenarios against a real timeline and asserts the rendered clip positions and menu bounding boxes.

## Important Failure Modes

- Mixing `clientX`, `pageX`, and element-relative coordinates.
- Applying scroll or zoom twice, or not applying it at all.
- Capturing playhead, selected track, or pointer coordinates after asynchronous state has changed.
- Recomputing commit placement differently from the drop preview.
- Treating zero seconds as a falsy missing value and appending instead.
- Positioning a portal-rendered menu with timeline-local coordinates.

## Related Contract

See `docs/spec/media-import-timeline.md` §2.2–§2.4 for track creation and timeline context-menu requirements.
