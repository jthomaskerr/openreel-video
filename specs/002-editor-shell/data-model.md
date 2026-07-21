# Editor Shell and Shared UI Data Model

This feature changes transient interaction state only. It adds no durable entity, schema, migration, or external data format.

## Initialization State

| Field | Meaning | Validation |
|---|---|---|
| `phase` | Progress, ready, or failed | Exactly one phase is visible at a time |
| `status` | Current human-readable startup stage | Non-empty during progress |
| `error` | Terminal attempt failure | Present only in failed phase |
| `attempt` | Identity of the current retry attempt | Increases for each explicit Retry |
| `retryAvailable` | Whether another attempt can start | True in failed phase, false while running |

Transitions:

```text
progress ──success──> ready
progress ──failure──> failed
failed ──Retry──> progress
```

The failed phase must not simultaneously present indefinite progress animation.

## Panel Boundary

| Field | Meaning | Validation |
|---|---|---|
| `target` | Media, inspector, chat, or timeline | One installed adjustable boundary |
| `orientation` | Vertical or horizontal separator | Side panels are vertical; timeline is horizontal |
| `value` | Current panel width or timeline-height percentage | Always within the installed target bounds |
| `minimum` / `maximum` | Allowed range | Preserve installed constants and viewport-derived stage constraints |
| `step` | Keyboard change per arrow press | 10 pixels for side panels; 2 percentage points for timeline |

Directional transitions move the physical boundary and then clamp the resulting value. Pointer transitions retain current geometry.

## Tab Set

| Field | Meaning | Validation |
|---|---|---|
| `tabs` | Ordered currently available tab identifiers | At least one when a tab set is rendered |
| `selected` | Active tab identifier | Must belong to `tabs` |
| `focused` | Tab receiving keyboard focus | Moves with automatic keyboard selection |
| `panel` | Content associated with the selected tab | Relationship is programmatically exposed |

Keyboard transitions wrap at the ends for Arrow keys; Home selects the first tab and End selects the last tab.

## Existing State Preserved

- Panel visibility and installed width persistence remain owned by the UI store.
- Engine instances and initialization flags remain owned by the engine store.
- Onboarding completion and tour step state remain unchanged.
- No shared mutable state is introduced.
