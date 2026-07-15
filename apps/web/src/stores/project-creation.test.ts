/**
 * Regression tests: projects must NEVER be silently auto-created.
 *
 * Joseph reported this twice (Jun 29):
 *   - "many new projects are often created — this should never happen"
 *   - "projects are still being automagically created"
 *
 * These tests are canaries: they fail fast if the guard (`explicitlyCreated: true`)
 * is removed or if new call-sites sneak createNewProject into lifecycle code.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createEmptyProject } from "./project/index";

// Resolve source paths relative to this test file so they work regardless of CWD.
const STORE_PATH = path.resolve(__dirname, "project-store.ts");
const APP_PATH = path.resolve(__dirname, "../App.tsx");

// ---------------------------------------------------------------------------
// 1. Source-level canary: createNewProject must always set explicitlyCreated:true
// ---------------------------------------------------------------------------
describe("createNewProject source guard", () => {
  it(
    // [regression] Jun 29: 'projects are being automagically created' — the
    // flag explicitlyCreated:true inside createNewProject is the single guard
    // that distinguishes an intentional user action from a silent auto-creation.
    // If this flag is ever removed or moved outside the function body, projects
    // will be created without user interaction again.
    "// [regression] createNewProject body must contain explicitlyCreated: true",
    () => {
      const source = fs.readFileSync(STORE_PATH, "utf-8");

      // Extract the createNewProject function body by finding it and the
      // block that follows. We look for the flag between the function header
      // Use lastIndexOf to get the *implementation* occurrence (line ~1506),
      // not the type-declaration occurrence (line ~120) that has no body.
      const fnStart = source.lastIndexOf("createNewProject: async (");
      expect(fnStart).toBeGreaterThan(-1); // function must exist

      // The function closes before `loadProject:` which is the next peer.
      const fnEnd = source.indexOf("loadProject:", fnStart);
      expect(fnEnd).toBeGreaterThan(fnStart); // sanity check

      const fnBody = source.slice(fnStart, fnEnd);

      // The critical guard: explicitlyCreated must be set to true inside
      // the function body — not outside it, not conditionally omitted.
      expect(fnBody).toContain("explicitlyCreated: true");
    },
  );

  it(
    // [regression] A project is not editable until backend creation returns a
    // confirmed persistence receipt.
    "// [regression] createNewProject activates only after a confirmed backend receipt",
    () => {
      const source = fs.readFileSync(STORE_PATH, "utf-8");

      const fnStart = source.lastIndexOf("createNewProject: async (");
      const fnEnd = source.indexOf("loadProject:", fnStart);
      const fnBody = source.slice(fnStart, fnEnd);

      const createIndex = fnBody.indexOf("await backendSaveService.create");
      const receiptIndex = fnBody.indexOf("!persistence.baseRevision");
      const activationIndex = fnBody.indexOf("explicitlyCreated: true");

      expect(createIndex).toBeGreaterThan(-1);
      expect(receiptIndex).toBeGreaterThan(createIndex);
      expect(activationIndex).toBeGreaterThan(receiptIndex);
      expect(fnBody).toContain("explicitlyCreated: false");
    },
  );
});

// ---------------------------------------------------------------------------
// 2. createEmptyProject produces a valid project object
// ---------------------------------------------------------------------------
describe("createEmptyProject", () => {
  it(
    // [regression] createEmptyProject is the underlying factory called by
    // createNewProject. If it returns an invalid/incomplete object, downstream
    // code could silently fall back to creating another project.
    "// [regression] returns a project with required fields",
    () => {
      const project = createEmptyProject();

      expect(project).toBeDefined();
      expect(typeof project.id).toBe("string");
      expect(project.id.length).toBeGreaterThan(0);
      expect(typeof project.name).toBe("string");
      expect(project.name.length).toBeGreaterThan(0);
      expect(typeof project.createdAt).toBe("number");
      expect(typeof project.modifiedAt).toBe("number");
      expect(project.mediaLibrary).toBeDefined();
      expect(Array.isArray(project.mediaLibrary.items)).toBe(true);
      expect(project.timeline).toBeDefined();
      expect(Array.isArray(project.timeline.tracks)).toBe(true);
    },
  );

  it(
    // [regression] Each call must produce a new unique project — if IDs were
    // ever shared, two separate user actions would corrupt each other's project.
    "// [regression] each call produces a distinct project ID",
    () => {
      const p1 = createEmptyProject();
      const p2 = createEmptyProject();

      expect(p1.id).not.toBe(p2.id);
    },
  );

  it(
    // [regression] Custom name must be honoured so the UI label matches what
    // the user typed; a mismatch was a secondary symptom of the regression.
    "// [regression] respects a custom name argument",
    () => {
      const project = createEmptyProject("My Regression Test Project");

      expect(project.name).toBe("My Regression Test Project");
    },
  );

  it(
    // [regression] Custom settings must be merged, not dropped.
    "// [regression] merges partial settings without discarding defaults",
    () => {
      const project = createEmptyProject(undefined, { width: 3840, height: 2160 });

      expect(project.settings.width).toBe(3840);
      expect(project.settings.height).toBe(2160);
      // Default fields survive
      expect(project.settings.frameRate).toBe(30);
      expect(project.settings.sampleRate).toBe(48000);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. App.tsx must not call createNewProject in lifecycle / initialization code
// ---------------------------------------------------------------------------
describe("App.tsx auto-creation invariant", () => {
  it(
    // [regression] Jun 29: root cause was that initialization or routing code
    // called createNewProject automatically without user interaction.
    // App.tsx is the primary lifecycle entry-point; any call to createNewProject
    // here would bypass the welcome screen and create projects silently.
    // This test reads the actual source to ensure the function is not referenced.
    "// [regression] App.tsx must not reference createNewProject",
    () => {
      const source = fs.readFileSync(APP_PATH, "utf-8");

      // If this assertion fails, someone added a call to createNewProject in
      // App.tsx. Before adding it back, verify it is gated on explicit user
      // interaction (e.g. a button click handler), never inside a useEffect
      // that runs unconditionally or on route change.
      expect(source).not.toContain("createNewProject");
    },
  );

  it(
    // [regression] The explicitlyCreated flag in App.tsx is read (not written)
    // — it gates URL sync. Confirm it is only ever destructured for reading,
    // never assigned a new value directly in App.tsx.
    "// [regression] App.tsx only reads explicitlyCreated, never forces it true",
    () => {
      const source = fs.readFileSync(APP_PATH, "utf-8");

      // App.tsx reads the flag from the store via destructuring:
      //   const { project, explicitlyCreated } = useProjectStore();
      // It must NOT write 'explicitlyCreated: true' or 'explicitlyCreated: false'.
      expect(source).not.toContain("explicitlyCreated: true");
      expect(source).not.toContain("explicitlyCreated: false");
    },
  );
});
