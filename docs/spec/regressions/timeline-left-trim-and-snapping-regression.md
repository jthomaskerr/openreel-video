# Timeline Left Trim and Snapping Regression

**Canonical functional spec:** [Timeline](../timeline.md).

**Status:** Implemented and verified 2026-07-16.

**Outcome:** Trimming a clip changes only the material outside the dragged edge: the retained material stays at the same timeline times, and either trim edge uses the configured timeline snap targets when snapping is enabled.

## Reported Symptoms

1. Dragging a clip's left trim handle changes its source `inPoint` and `duration` without changing `startTime`. The retained source content therefore shifts earlier on the timeline instead of remaining anchored.
2. Dragging either trim handle ignores timeline snapping even when snapping is enabled.

## Required Behavior

### Left-Edge Trim

At trim start, the interaction MUST capture the clip's original `startTime`, `duration`, `inPoint`, `outPoint`, and right timeline edge. Each pointer update MUST derive the candidate left timeline edge from that immutable snapshot rather than from values already mutated by an earlier pointer event.

For an effective left-edge timeline delta `d`, the clip update MUST be atomic and satisfy:

```text
newStartTime = originalStartTime + d
newInPoint   = originalInPoint + d
newDuration  = originalDuration - d
newStartTime + newDuration = originalStartTime + originalDuration
```

This means trimming material from the front advances both `startTime` and `inPoint` by the same amount while shortening `duration`. Extending the front performs the inverse operation. The retained source frames MUST remain at their existing timeline positions, and the clip's right timeline edge MUST not move.

The effective delta MUST be clamped so that `newStartTime >= 0`, `newInPoint >= 0`, the clip does not extend outside its available source range, and `newDuration` remains at or above the application's minimum clip duration. All dependent clip state, including exit-relative keyframes, MUST be updated from the same effective delta and committed in the same state transition.

### Trim Snapping

When timeline snapping is enabled, the dragged timeline edge MUST use the same enabled snap targets, target priority, pixel threshold, and current zoom conversion as ordinary timeline movement. Enabled clip-edge, playhead, and grid settings MUST be respected; disabled target types MUST be ignored. The clip being trimmed MUST be excluded from its own clip-edge targets.

Snapping MUST be calculated for the dragged edge itself. A left trim MUST NOT snap the fixed right edge, and a right trim MUST NOT snap the fixed left edge. The snapped edge time MUST be used both for the rendered preview and for the committed clip values. While snapped, the existing timeline snap indicator MUST identify the exact target; it MUST clear immediately when the edge leaves the threshold, trimming ends, or trimming is cancelled.

When snapping is disabled, the edge MUST follow the pointer-derived timeline time without snap quantization, subject only to source, zero-time, and minimum-duration clamps. Pointer-to-time conversion MUST continue to account for timeline origin, horizontal scroll, and current zoom.

### Right-Edge Compatibility

Right-edge trim MUST retain its existing placement semantics: `startTime` and `inPoint` stay fixed while the right timeline edge, `duration`, and source out boundary change together. Adding snap support MUST NOT cause the left timeline edge or retained source content to move.

## Deterministic Regression Scenarios

1. Given a clip with `startTime = 10`, `duration = 8`, `inPoint = 2`, and `outPoint = 10`, drag the left handle from 10 s to 13 s with snapping disabled. The result is `startTime = 13`, `inPoint = 5`, and `duration = 5`; the right timeline edge remains exactly 18 s.
2. Starting from the result of scenario 1, begin a new trim and drag the left handle back to 11 s. The result is `startTime = 11`, `inPoint = 3`, and `duration = 7`; the right timeline edge remains 18 s.
3. Drag the left handle past timeline zero or past source time zero. The effective delta clamps at the first applicable boundary, the right edge remains fixed, and no timing field becomes negative or non-finite.
4. Drag the left handle toward the right edge beyond the minimum duration. `startTime`, `inPoint`, and `duration` clamp consistently to the minimum-duration boundary in one update.
5. Enable clip-edge snapping, set a known pixel threshold, and drag the left handle within that threshold of another clip's edge. The left edge, `startTime`, and snap indicator resolve to that exact edge; `inPoint` and `duration` use the same snapped delta and the right edge remains fixed.
6. Enable playhead snapping and grid snapping separately and repeat a left trim at multiple zoom levels and after horizontal scrolling. Each enabled target snaps at the configured pixel threshold; disabling that target makes the same pointer position remain unsnapped.
7. With snapping enabled, drag the right handle near each enabled target type. The right edge and duration snap to the indicated target while `startTime` and `inPoint` remain unchanged.
8. Place the pointer within the snap threshold of the clip's own opposite edge but no external target. The trim MUST NOT self-snap, except for the normal minimum-duration clamp.

## Required Automated Evidence

- Pure unit tests for left-trim calculation covering inward trim, outward extension, timeline-zero and source-zero clamps, minimum duration, and the invariant that the original right timeline edge is preserved.
- Unit tests for trim-edge snapping covering clip starts and ends, playhead, grid, target enablement, target priority, zoom-dependent pixel thresholds, and exclusion of the trimmed clip.
- Timeline interaction tests proving each pointer update is derived from the trim-start snapshot and that preview and commit use the same snapped edge time.
- State tests proving `startTime`, `inPoint`, `duration`, and dependent keyframes are committed atomically without transient or persisted invalid combinations.
- A browser regression test that trims both edges with snapping on and off after zooming and horizontal scrolling, asserts the rendered edge positions, and verifies the snap indicator appears and clears at the correct times.

## Important Failure Modes

- Updating `inPoint` and `duration` while leaving `startTime` unchanged during a left trim.
- Applying successive pointer deltas to already-updated clip state, causing cumulative drift.
- Snapping a derived duration or the fixed opposite edge instead of the dragged timeline edge.
- Using a snap result for the indicator but raw pointer time for the committed clip, or vice versa.
- Including the trimmed clip in its own snap candidates.
- Applying a seconds-based snap threshold without converting the configured pixel threshold at the current zoom.
- Allowing source clamps, timeline-zero clamps, or minimum duration to update timing fields independently and break the fixed-edge invariant.
- Leaving a stale snap indicator visible after the pointer leaves the target or the trim interaction ends.

## Related Contract

This regression specializes `docs/spec/timeline.md` section 2.3. The canonical timeline contract's rule that time is quantized only when snapping is enabled applies to trim handles as well as clip movement.
