# Code Context

## Files Retrieved

1. `apps/orchestrator/src/projects/project-store.ts` (lines 1-227) — Backend project registry; `listProjects()` reads directories from the shared git repo
2. `apps/orchestrator/src/projects/git-store.ts` (lines 1-247) — Git worktree management; each project is a worktree in the shared repo
3. `apps/orchestrator/src/projects/routes.ts` (lines 1-254) — Express routes; `GET /api/projects` returns `store.listProjects()`
4. `apps/orchestrator/src/env.ts` (lines 1-70) — Default repo path: `~/openreel-projects`
5. `apps/orchestrator/src/app.ts` (lines 1-46) — App factory; mounts project routes at `/api/projects`
6. `apps/orchestrator/src/projects/storage-validation.ts` (lines 1-51) — Project ID format: `/^[a-z0-9][a-z0-9-]{0,127}$/`
7. `apps/web/src/components/welcome/RecentProjects.tsx` (lines 1-200) — Frontend recent projects; reads IndexedDB ONLY, never calls backend API
8. `apps/web/src/services/auto-save.ts` (lines 1-234) — IndexedDB auto-save (`openreel-autosave`); `checkForRecovery()` returns local saves
9. `apps/web/src/services/backend-save.ts` (lines 1-175) — Backend bridge; HAS `listProjects()` that calls `GET /api/projects`, but UNUSED by welcome screen
10. `apps/web/src/services/project-manager.ts` (lines 1-450) — Another IndexedDB store (`openreel-projects`) for "recent projects" tracking
11. `apps/web/src/stores/project-store.ts` (lines 1-50+) — `createNewProject()` calls `backendSaveService.create()` if reachable; `recoverFromAutoSave()` reads IndexedDB
12. `apps/image/src/components/welcome/WelcomeScreen.tsx` (lines 1-316) — Image editor welcome; reads localStorage (`openreel-image-project-*`)
13. `apps/image/src/hooks/useAutoSave.ts` (lines 1-60) — Image auto-save to localStorage
14. `apps/image/src/stores/project-store.ts` (lines 1-100+) — Image project store; Zustand with no backend integration

## Key Code

### Backend: How valid projects are defined

The orchestrator's `ProjectStore.listProjects()` (project-store.ts lines 85-105):
```typescript
async listProjects(): Promise<ProjectSummary[]> {
    await this.gitStore.ensureSharedRepo();
    const entries = await readdir(this.gitStore["repoDir"], { withFileTypes: true });
    const dirs = entries.filter(
      (entry) => entry.isDirectory() && entry.name !== ".git",
    );
    const summaries = (await Promise.all(dirs.map(async (dir) => {
      if (!isValidProjectId(dir.name)) return null;  // slug pattern check
      const jsonPath = join(this.gitStore["repoDir"], dir.name, "project.json");
      try {
        const raw = await readFile(jsonPath, "utf-8");
        const project = JSON.parse(raw) as Project;
        if (!isValidProjectId(project.id)) return null;
        return { id: project.id, name: project.name, createdAt: project.createdAt, modifiedAt: project.modifiedAt };
      } catch { return null; }
    }))).filter((summary): summary is ProjectSummary => summary !== null);
    return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
}
```

The repo dir defaults to `~/openreel-projects` (env.ts line 65):
```typescript
projectsRepo: env("MV_PROJECTS_REPO", join(home, "openreel-projects")),
```

Valid project IDs match: `/^[a-z0-9][a-z0-9-]{0,127}$/` (storage-validation.ts line 3)

The backend API route (routes.ts lines 141-148):
```typescript
router.get("/", async (_req: Request, res: Response) => {
    try {
      res.json(await store.listProjects());
    } catch (err) {
      res.status(500).json({ error: "Failed to list projects", detail: String(err) });
    }
  });
```

### Frontend (web): How recent projects are currently loaded

`RecentProjects.tsx` lines 31-56 — calls `checkForRecovery()` which only reads IndexedDB:
```typescript
useEffect(() => {
    async function loadProjects() {
      try {
        const saves = await checkForRecovery();  // IndexedDB ONLY
        const projectMap = new Map<string, AutoSaveMetadata>();
        for (const save of saves) {
          if (!projectMap.has(save.projectId)) {
            projectMap.set(save.projectId, save);
          }
        }
        const projects: RecentProject[] = Array.from(projectMap.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10)
          .map((save) => ({ id: save.projectId, saveId: save.id, name: save.projectName, lastModified: save.timestamp }));
        setRecentProjects(projects);
      } catch (error) { ... }
    }
    loadProjects();
  }, []);
```

### Frontend: The backend bridge already exists

`BackendSaveService` (backend-save.ts lines 140-151) HAS the needed method but it's not used by the welcome screen:
```typescript
async listProjects(): Promise<ProjectSummary[] | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/projects`);
      if (!res.ok) return null;
      return (await res.json()) as ProjectSummary[];
    } catch {
      return null;
    }
  }
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SINGLE SOURCE OF TRUTH                           │
│                                                                         │
│  ~/openreel-projects/  (git repo with worktrees)                       │
│  ├── .git/                                                              │
│  ├── my-awesome-video/        <-- project worktree (branch: project/..) │
│  │   ├── .git                                                           │
│  │   ├── .gitattributes                                                 │
│  │   ├── project.json          <-- canonical project state              │
│  │   └── media/                <-- git-lfs tracked media files          │
│  ├── another-project/                                                    │
│  └── untitled/                                                           │
│                                                                         │
│  Orchestrator (port 4041)                                               │
│  ├── GET /api/projects         → listProjects() reads repo directories │
│  ├── POST /api/projects        → create worktree + project.json        │
│  └── PUT /api/projects/:id     → save to project.json                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP (backendSaveService)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Frontend)                                │
│                                                                         │
│  ┌──────────────────────┐    ┌──────────────────────────────┐          │
│  │ IndexedDB             │    │ BackendSaveService            │          │
│  │ openreel-autosave     │    │  .listProjects() ← UNUSED    │          │
│  │  ← RecentProjects.tsx │    │  .create()      ← project-   │          │
│  │     reads from here!  │    │  .save()          store.ts   │          │
│  │                       │    │  .load()                      │          │
│  └───────────────────────┘    └──────────────────────────────┘          │
│                                                                         │
│  ┌──────────────────────┐                                               │
│  │ IndexedDB             │                                               │
│  │ openreel-projects     │                                               │
│  │  ← project-manager.ts │  (separate "recent" tracking)                │
│  └───────────────────────┘                                               │
│                                                                         │
│  ┌──────────────────────────────────────────────┐                       │
│  │ Image editor (apps/image)                     │                       │
│  │  ← localStorage: openreel-image-project-*    │  (no backend at all) │
│  └──────────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## The Gap

The frontend `RecentProjects.tsx` **only reads from IndexedDB** (`checkForRecovery()` from auto-save.ts). It never fetches the authoritative project list from the backend (`GET /api/projects`). This means:

1. The welcome screen shows every project that has ever been auto-saved locally, including stale/deleted/renamed ones
2. The backend git repo is the single source of truth, but the frontend ignores it for the recent projects list
3. If a project is deleted from the backend, it will still appear in the frontend recent projects list (until IndexedDB is manually cleared)
4. If a project ID changes (e.g., during migration from UUID to slug), the IndexedDB entry becomes orphaned

## How Frontend Projects Get Created (The ID Mismatch)

In `project-store.ts` `createNewProject()`:
1. Creates a project with a **UUID** id locally (via `createEmptyProject()`)
2. Fire-and-forget: if backend is reachable, creates via `backendSaveService.create()`
3. The backend returns a project with a **slug** id (e.g., `my-awesome-video`)
4. The store swaps the client UUID for the backend slug
5. But the auto-save IndexedDB still has the **original UUID** from the initial save!

This UUID-vs-slug mismatch means:
- IndexedDB may contain saves under UUIDs that no longer match any backend project
- The project may be in the git repo under the slug, but local auto-saves reference the UUID

## Start Here

1. **`apps/web/src/components/welcome/RecentProjects.tsx`** — The primary file that needs to be changed. It should fetch from the backend API instead of (or in addition to) IndexedDB.
2. **`apps/web/src/services/backend-save.ts`** — Already has `listProjects()` that calls `GET /api/projects`. Just needs to be wired in.

## Image Editor (Separate Concern)

The image editor (`apps/image/src/components/welcome/WelcomeScreen.tsx`) has its own welcome screen with a `loadRecentProjects` function that reads from **localStorage** (`openreel-image-project-*` keys). It has no backend integration at all. This is a separate app with a separate storage strategy and is not part of this issue.
