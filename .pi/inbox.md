## Inbox

- [x] **#1** implement @docs/superpowers/plans/2026-07-08-subtitle-files.md . NB planning is a no-op, go straight to implementation ➕ 2026-07-08 🔗 docs/spec/2026-07-08-auto-caption-clip-input-spec.md; ✅ 2026-07-08 ^item-1

- [x] **#2** [Error] [BackendSave] auto-save push failed: Error: Backend save failed: HTTP 500 — Error: Command failed: git worktree add -b project/08668435-6052-4a9a-9399-d8ad531831de /Volumes/Joseph/openreel-projects/08668435-6052-4a9a-9399-d8ad531831de HEAD Preparing worktree (new branch 'project/08668435-6052-4a9a-9399-d8ad531831de') fatal: a branch named 'project/08668435-6052-4a9a-9399-d8ad531831de' already exists save — backend-save.ts:92 (anonymous function) (main.tsx:13) (anonymous function) (project-store.ts:3371). But it shouldn't be the uuid anyway ➕ 2026-07-08 #errored 🔗 commit ✅ 2026-07-08 ^item-2

- [x] **#3** Trimming an item from the left edge must clip the beginning of the item not just its duration ➕ 2026-07-08 🔗 commit ✅ 2026-07-08 ^item-3

- [x] **#4** drag/drop of an srt subtitle file just stalls ➕ 2026-07-08 🔗 Root ✅ 2026-07-08 ^item-4

- [x] **#5** add an open project from file option in the main toolbar star dropdown menu that creates a new project in the backend using the project file ➕ 2026-07-08 🔗 commit ✅ 2026-07-08 ^item-5

- [x] **#6** we need to be able to mute the audio of individual clips (add a checkbox in the inspector ➕ 2026-07-08 🔗 commit ✅ 2026-07-08 ^item-6

- [x] **#7** the export project json does not add version or wrap everything else in the project tag ➕ 2026-07-08 🔗 No ✅ 2026-07-08 ^item-7

- [x] **#8** import neuralframes is broken "Load failed" ➕ 2026-07-08 🔗 No ✅ 2026-07-08 ^item-8

- [x] **#9** [Warning] Failed to create ImageBitmap for image ead7bcf7-3032-482f-9d2d-fef874cbb349: – TypeError: Type error — video-engine.ts:481 (video-engine.ts, line 488) TypeError: Type error — video-engine.ts:481 ➕ 2026-07-08 #errored ✅ 2026-07-08 ^item-9

- [x] **#10** Convert music-video-domain into a package and import into the backend rather than being a separate service ➕ 2026-07-08 #errored ✅ 2026-07-08 ^item-10

- [x] **#11** there are projects in the recent projects list in the frontend that do not exist in the backend git repo. The backend git repo (not the server, the repo itself) must be the single source of truth for the list of projects. And "recent projects" must be renamed to "Projects" ➕ 2026-07-08 🔗 Commit ✅ 2026-07-08 ^item-11

- [x] **#12** i have made many edits to the VintageTokyo project but none have appeared in the project git repo at ~/openreel-projects ➕ 2026-07-08 🔗 Fixed ✅ 2026-07-08 ^item-12

- [ ] **#13** if a file is imported with the same filename and size then it should replace the existing item not be added as a new one ➕ 2026-07-08 ^item-13

- [/] **#14** omfg how is this possible? the inspector display is broken AGAIN. Fucking get the regression testing right. i click on a clip and no inspector appears ➕ 2026-07-08 #errored ^item-14

- [x] **#15** the backend-down autosave is broken again. on refresh I get the outdated version from the backend complete with the missing media ➕ 2026-07-08 #errored 🔗 commit ✅ 2026-07-09 ^item-15

- [x] **#16** [Error] Failed to load resource: The operation couldn’t be completed. (WebKitBlobResource error 1.) (7a90da82-0066-4a73-aeec-48d129fadf56, line 0). The url is blob:http://localhost:5173/d1f58dda-46f7-..... you're clearly loading the remoteUrl instead of its contents into the blob ➕ 2026-07-08 #errored 🔗 commit ✅ 2026-07-09 ^item-16

- [x] **#17** [Error] [ErrorBoundary] Component error: (2) TypeError: Type error — WaveformPreview.tsx:43 {componentStack: "↵WaveformPreview@http://localhost:5173/src/compone…69:12↵App@http://localhost:5173/src/App.tsx:67:79"} (anonymous function) (main.tsx:13) componentDidCatch (ErrorBoundary.tsx:27) callback (chunk-YYN6DZAU.js:14084) callCallback (chunk-YYN6DZAU.js:11248) commitUpdateQueue (chunk-YYN6DZAU.js:11265) commitLayoutEffectOnFiber (chunk-YYN6DZAU.js:17075) commitLayoutMountEffects_complete (chunk-YYN6DZAU.js:17980) commitLayoutEffects_begin (chunk-YYN6DZAU.js:17969) commitLayoutEffects_begin (chunk-YYN6DZAU.js:17950) commitLayoutEffects (chunk-YYN6DZAU.js:17920) commitRootImpl (chunk-YYN6DZAU.js:19353) commitRoot (chunk-YYN6DZAU.js:19277) performSyncWorkOnRoot (chunk-YYN6DZAU.js:18895) flushSyncCallbacks (chunk-YYN6DZAU.js:9119) (anonymous function) (chunk-YYN6DZAU.js:18627) ➕ 2026-07-08 🔗 commit ✅ 2026-07-09 ^item-17

- [ ] **#18** clip/timeline clip selection does not trigger the inspector ➕ 2026-07-08 ^item-18

## Archived

