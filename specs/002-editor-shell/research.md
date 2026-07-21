# Editor Shell and Shared UI Research

## Decision 1: Preserve the installed shell architecture

**Decision**: Keep the existing editor interface, UI/engine stores, panel error boundaries, custom inspector/settings tabs, and shared UI package.

**Rationale**: Repository analysis shows the primary workspace, isolated regions, settings, shortcuts, onboarding, and reusable controls are already installed. Replacing them would introduce risk without addressing a demonstrated failure.

**Alternatives considered**: A dockable-panel framework, wholesale migration to shared tabs, or a shared-control redesign. Rejected as Future Scope because they are not required for minimal correct operation.

## Decision 2: Reuse the installed initialization operation for Retry

**Decision**: Present initialization failure as a terminal error state and retry the existing initialization sequence in place.

**Rationale**: The engine store already clears `initError` at the beginning of an attempt and returns to `initialized: false, initializing: false` after failure, so it is retryable. The shell defect is orchestration/presentation: failure is rendered inside an indefinitely animated initialization state and no retry action is exposed.

**Alternatives considered**: Reloading the page or adding a background initialization service. Reload loses context and is not an in-place recovery; a service is unnecessary for a local component lifecycle.

## Decision 3: Use one editor-local resize boundary component

**Decision**: Encapsulate separator semantics and keyboard handling in one local component, while the editor interface continues to own sizes, viewport-aware bounds, and pointer resizing.

**Rationale**: Four repeated mouse-only boundaries need the same focus, orientation, value, label, and key behavior. One small component prevents divergence without expanding the public shared-control package.

**Alternatives considered**: Duplicating key handling four times or adding a new public shared package primitive. Duplication risks inconsistent behavior; a public primitive broadens scope without another installed consumer.

## Decision 4: Keep automatic activation for custom tabs

**Decision**: Arrow, Home, and End keys move both focus and selection within the installed tab order.

**Rationale**: The specification already defines automatic selection, tab content is local, and no tab triggers a costly remote operation. This matches the interaction users receive when clicking a tab.

**Alternatives considered**: Manual activation with Enter/Space or replacing all custom sets with a different tab implementation. Manual activation conflicts with clarified behavior; replacement would create unnecessary styling and state risk.

## Decision 5: Defer every tour change

**Decision**: Preserve installed tour behavior and tests without modifying tour production code.

**Rationale**: The user explicitly deferred tour changes and restricted implementation to demonstrated critical errors or concrete usability defects outside the tour.

**Alternatives considered**: Dialog semantics, focus containment/restoration, control labels, content changes, or additional tour tests. All remain Future Scope.
