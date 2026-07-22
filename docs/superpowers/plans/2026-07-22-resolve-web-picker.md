# Resolve Web Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Resolve directory handoff with a backend-driven master-detail picker and tracked Open-in-Resolve workflow.

**Architecture:** A typed web client consumes the backend preview/export contracts. Focused picker components render project navigation, rendered output, mini timeline, and clip groups. A controller polls the backend job and launches the registered Swift bridge only when the artifact is ready.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing OpenReel editor UI primitives and router.

## Global Constraints

- The backend is authoritative for projects, preview data, progress, and export results.
- Loading longer than 300 ms shows a visible status indicator.
- Video and audio controls appear inside their clip thumbnails.
- Missing data remains visible with an actionable explanation.
- All controls are keyboard-operable, screen-reader named, and usable at 200% zoom.
- Do not remove the iMovie path while replacing the Resolve path.
- Media marked `externallyReferenced: true` remains editable but its delete action is disabled with a specific Resolve-reference explanation.

---

### Task 1: Typed Resolve bridge client and launch boundary

**Files:**
- Create: `apps/web/src/services/resolve-bridge-client.ts`
- Create: `apps/web/src/services/resolve-bridge-client.test.ts`

**Interfaces:**
- Produces: `listProjects`, `getPreview`, `startExport`, `getExportJob`, `cancelExport`, and `launchResolveBridge`.

- [ ] **Step 1: Write failing client tests**

```ts
it("launches only a validated openreel-resolve URL returned by the backend", () => {
  const assign = vi.fn();
  launchResolveBridge("openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000", { assign });
  expect(assign).toHaveBeenCalledOnce();
  expect(() => launchResolveBridge("file:///tmp/export", { assign })).toThrow("invalid bridge URL");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/resolve-bridge-client.test.ts`

Expected: FAIL because the client is absent.

- [ ] **Step 3: Implement typed fetch and strict launch validation**

```ts
export function launchResolveBridge(url: string, location: Pick<Location, "assign"> = window.location): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "openreel-resolve:" || parsed.hostname !== "import" || parsed.search) {
    throw new Error("invalid bridge URL");
  }
  location.assign(parsed.toString());
}
```

Parse every JSON response through the shared Zod schema and map non-2xx responses to stable user-safe errors.

- [ ] **Step 4: Run tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/services/resolve-bridge-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/services/resolve-bridge-client.ts apps/web/src/services/resolve-bridge-client.test.ts
rtk git commit -m "feat(web): add typed Resolve bridge client"
```

### Task 2: Master-detail picker shell and metadata preview

**Files:**
- Create: `apps/web/src/components/editor/resolve-picker/ResolveProjectPicker.tsx`
- Create: `apps/web/src/components/editor/resolve-picker/ProjectList.tsx`
- Create: `apps/web/src/components/editor/resolve-picker/ProjectMetadata.tsx`
- Create: `apps/web/src/components/editor/resolve-picker/ResolveProjectPicker.test.tsx`

**Interfaces:**
- Consumes: project summaries and `ResolvePreview`.
- Produces: `ResolveProjectPicker({ open, onClose, onLaunch })`.

- [ ] **Step 1: Write failing accessible picker tests**

```tsx
it("searches projects and exposes selected project metadata", async () => {
  render(<ResolveProjectPicker open onClose={vi.fn()} onLaunch={vi.fn()} client={client} />);
  await user.type(screen.getByRole("searchbox", { name: /search projects/i }), "vintage");
  await user.click(await screen.findByRole("option", { name: /vintage tokyo/i }));
  expect(screen.getByRole("heading", { name: "Vintage Tokyo" })).toBeVisible();
  expect(screen.getByText("11 July 2026")).toBeVisible();
  expect(screen.getByText(/last edited/i)).toBeVisible();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/ResolveProjectPicker.test.tsx`

Expected: FAIL because components are absent.

- [ ] **Step 3: Implement master-detail selection**

Use a labelled dialog, `role="listbox"` project list with roving selection, explicit loading/empty/error states, backend ordering by modified date, and a responsive detail region. Render name, description, created/modified timestamps, duration, frame rate, track/clip/media counts, and compatibility status.

```tsx
<Dialog open={open} onOpenChange={value => !value && onClose()}>
  <DialogContent aria-describedby="resolve-picker-description">
    <ProjectList projects={projects} selectedId={selectedId} onSelect={setSelectedId} />
    <ProjectMetadata preview={preview} />
  </DialogContent>
</Dialog>
```

- [ ] **Step 4: Run component tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/ResolveProjectPicker.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/components/editor/resolve-picker
rtk git commit -m "feat(web): add Resolve project picker"
```

### Task 3: Rendered output, clip thumbnails, groups, and mini timeline

**Files:**
- Create: `apps/web/src/components/editor/resolve-picker/RenderedOutputPreview.tsx`
- Create: `apps/web/src/components/editor/resolve-picker/MiniTimeline.tsx`
- Create: `apps/web/src/components/editor/resolve-picker/ClipGroups.tsx`
- Create: `apps/web/src/components/editor/resolve-picker/MediaClipPreview.tsx`
- Create: `apps/web/src/components/editor/resolve-picker/preview-components.test.tsx`

**Interfaces:**
- Consumes: `ResolvePreview.render`, `.miniTimeline`, and `.clipGroups`.
- Produces reusable read-only preview components.

- [ ] **Step 1: Write failing media and accessibility tests**

```tsx
it("renders playable video and audio controls inside clip thumbnails", () => {
  render(<ClipGroups groups={clipGroupsFixture} />);
  expect(screen.getByRole("button", { name: /play shibuya crossing/i })).toBeInside(screen.getByTestId("clip-video-1"));
  expect(screen.getByRole("button", { name: /play vintage tokyo master/i })).toBeInside(screen.getByTestId("clip-audio-1"));
  expect(screen.getByRole("img", { name: /waveform for vintage tokyo master/i })).toBeVisible();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/preview-components.test.tsx`

Expected: FAIL because preview components are absent.

- [ ] **Step 3: Implement previews**

Use native `<video>` and `<audio>` elements with labelled play/pause buttons in fixed-aspect thumbnail containers. Render backend-provided signed peak arrays as an accessible SVG waveform. Render mini-timeline clips by exact frame offsets and track order, with gaps preserved. Use semantic disclosure buttons with `aria-expanded` for groups.

```tsx
<button aria-expanded={expanded} aria-controls={`clip-group-${group.type}`} onClick={toggle}>
  <span>{labelFor(group.type)}</span><span>{group.clips.length}</span>
</button>
```

- [ ] **Step 4: Run tests and typecheck**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/preview-components.test.tsx`

Expected: PASS.

Run: `rtk ./apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/components/editor/resolve-picker
rtk git commit -m "feat(web): add rich Resolve project previews"
```

### Task 4: Backend job progress and Open in Resolve action

**Files:**
- Create: `apps/web/src/components/editor/resolve-picker/useResolveExportJob.ts`
- Create: `apps/web/src/components/editor/resolve-picker/useResolveExportJob.test.tsx`
- Modify: `apps/web/src/components/editor/resolve-picker/ResolveProjectPicker.tsx`
- Modify: `apps/web/src/components/editor/HandoffExportDialog.tsx`
- Modify: `apps/web/src/components/editor/HandoffExportDialog.test.tsx`

**Interfaces:**
- Produces: `useResolveExportJob(client)` with `start`, `cancel`, `retryLaunch`, and state derived exclusively from backend jobs.

- [ ] **Step 1: Write failing job controller tests**

```tsx
it("starts the backend job, reports phases, and launches only when ready", async () => {
  const { result } = renderHook(() => useResolveExportJob(client));
  await act(() => result.current.start("vintage-tokyo", "rev-123"));
  expect(result.current.phase).toBe("assessing");
  await advanceJobToReady();
  expect(client.launch).toHaveBeenCalledWith("openreel-resolve://import/job-id");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/useResolveExportJob.test.tsx src/components/editor/HandoffExportDialog.test.tsx`

Expected: FAIL because the controller is absent and Resolve still uses browser-directory handoff.

- [ ] **Step 3: Implement tracked launch flow**

Poll with an abortable timer, preserve monotonic phases, announce progress through `aria-live="polite"`, expose cancellation before `launching`, and show stable recovery actions. Keep iMovie on the existing path.

```tsx
<Button onClick={() => job.start(selected.id, preview.revision)} disabled={!job.canStart}>
  Open in Resolve
</Button>
<div aria-live="polite">{job.statusMessage}</div>
```

- [ ] **Step 4: Run focused and integration gates**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker src/components/editor/HandoffExportDialog.test.tsx src/test/export-handoff.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/components/editor/resolve-picker apps/web/src/components/editor/HandoffExportDialog.tsx apps/web/src/components/editor/HandoffExportDialog.test.tsx
rtk git commit -m "feat(web): launch backend-managed Resolve exports"
```

### Task 5: Browser acceptance coverage

**Files:**
- Create: `apps/web/e2e/resolve-project-picker.spec.ts`

**Interfaces:**
- Verifies the user-visible picker and launch boundary against a deterministic fake backend.

- [ ] **Step 1: Add the Playwright scenario**

```ts
test("selects Vintage Tokyo and launches a verified Resolve job", async ({ page }) => {
  await installResolveExportFixtures(page);
  await page.goto("/editor?projectId=vintage-tokyo");
  await page.getByRole("button", { name: /export project/i }).click();
  await page.getByRole("option", { name: /vintage tokyo/i }).click();
  await expect(page.getByRole("heading", { name: "Vintage Tokyo" })).toBeVisible();
  await expect(page.getByRole("button", { name: /play vintage tokyo master/i })).toBeVisible();
  await page.getByRole("button", { name: "Open in Resolve" }).click();
  await expect(page.getByText(/ready to open in resolve/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the scenario**

Run: `rtk pnpm --filter @openreel/web exec playwright test e2e/resolve-project-picker.spec.ts`

Expected: PASS on Chromium with no external services.

- [ ] **Step 3: Run 200% zoom and keyboard-only checks**

Run the same test with the viewport fixture set to 1280x720 and `page.evaluate(() => document.body.style.zoom = "2")`; assert no document-level horizontal overflow and complete the flow using keyboard actions.

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
rtk git add apps/web/e2e/resolve-project-picker.spec.ts
rtk git commit -m "test(web): cover Resolve project picker workflow"
```

### Task 6: Externally referenced media deletion feedback

**Files:**
- Modify: `apps/web/src/stores/project-store.test.ts`
- Modify: `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`
- Modify: `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.test.tsx`

**Interfaces:**
- Consumes: `MediaItem.externallyReferenced` and the core `EXTERNAL_MEDIA_DELETE_BLOCKED` result.
- Produces: visible, non-color-only deletion protection while leaving metadata and replacement/update actions enabled.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("explains why Resolve-referenced media cannot be deleted", () => {
  renderInspector(mediaFixture({ externallyReferenced: true }));
  expect(screen.getByRole("button", { name: /delete asset/i })).toBeDisabled();
  expect(screen.getByText(/referenced by an external resolve project/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /replace media/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/inspector/AssetInspectorWithTabs.test.tsx src/stores/project-store.test.ts`

Expected: FAIL because the marker is not rendered or enforced in the web action path.

- [ ] **Step 3: Implement explicit feedback**

Disable only deletion for externally referenced media. Add visible helper copy and a tooltip using existing accessible UI primitives. Preserve rename, metadata, version, and replacement controls.

- [ ] **Step 4: Run focused tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/inspector/AssetInspectorWithTabs.test.tsx src/stores/project-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx apps/web/src/components/editor/inspector/AssetInspectorWithTabs.test.tsx apps/web/src/stores/project-store.test.ts
rtk git commit -m "feat(web): explain protected external media"
```
