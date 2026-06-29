#!/usr/bin/env -S npx tsx
/**
 * Project management CLI for OpenReel.
 *
 * Usage:
 *   tsx scripts/project.ts list
 *   tsx scripts/project.ts create <name> [--width W] [--height H] [--fps N]
 *   tsx scripts/project.ts rename <id> <new-name>
 *   tsx scripts/project.ts delete <id>
 *   tsx scripts/project.ts info <id>
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore } from "../apps/orchestrator/src/projects/project-store";

const __dir = dirname(fileURLToPath(import.meta.url));

function projectsDir(): string {
  const envDir = process.env.MV_PROJECTS_DIR;
  if (envDir) return envDir;
  return join(__dir, "..", "..", "music-video-studio", "projects");
}

const store = new ProjectStore(projectsDir());

function usage(): never {
  console.log(`Usage: tsx scripts/project.ts <command> [args]

Commands:
  list                     List all projects
  create <name>            Create a new project
  rename <id> <new-name>   Rename a project
  delete <id>              Delete a project
  info <id>                Show project details
`);
  process.exit(1);
}

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

async function cmdList(): Promise<void> {
  const projects = await store.listProjects();
  if (projects.length === 0) {
    console.log("No projects found.");
    return;
  }
  console.log(`Projects (${projects.length}):\n`);
  for (const p of projects) {
    const mod = new Date(p.modifiedAt).toLocaleString();
    console.log(`  ${p.id}  "${p.name}"  (modified ${mod})`);
  }
}

async function cmdCreate(name: string, args: string[]): Promise<void> {
  let width = 1920;
  let height = 1080;
  let fps = 30;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--width" && args[i + 1]) width = parseInt(args[++i], 10);
    else if (args[i] === "--height" && args[i + 1]) height = parseInt(args[++i], 10);
    else if (args[i] === "--fps" && args[i + 1]) fps = parseInt(args[++i], 10);
    else fail(`Unknown flag: ${args[i]}`);
  }

  if (isNaN(width) || width <= 0) fail("Invalid --width");
  if (isNaN(height) || height <= 0) fail("Invalid --height");
  if (isNaN(fps) || fps <= 0) fail("Invalid --fps");

  const project = await store.createProject(name, {
    width,
    height,
    frameRate: fps,
  });
  console.log(`Created project: ${project.id}  "${project.name}"`);
  console.log(`  ${width}x${height} @ ${fps}fps`);
}

async function cmdRename(id: string, name: string): Promise<void> {
  const project = await store.renameProject(id, name);
  if (!project) fail(`Project not found: ${id}`);
  console.log(`Renamed project ${id} to "${project.name}"`);
}

async function cmdDelete(id: string): Promise<void> {
  const deleted = await store.deleteProject(id);
  if (!deleted) fail(`Project not found: ${id}`);
  console.log(`Deleted project: ${id}`);
}

async function cmdInfo(id: string): Promise<void> {
  const project = await store.loadProject(id);
  if (!project) fail(`Project not found: ${id}`);
  const created = new Date(project.createdAt).toLocaleString();
  const modified = new Date(project.modifiedAt).toLocaleString();
  console.log(`Project: ${project.id}`);
  console.log(`  Name:       ${project.name}`);
  console.log(`  Created:    ${created}`);
  console.log(`  Modified:   ${modified}`);
  console.log(`  Resolution: ${project.settings.width}x${project.settings.height}`);
  console.log(`  Frame rate: ${project.settings.frameRate} fps`);
  console.log(`  Audio:      ${project.settings.sampleRate} Hz, ${project.settings.channels} ch`);
  console.log(`  Tracks:     ${project.timeline.tracks.length}`);
  console.log(`  Duration:   ${project.timeline.duration.toFixed(1)}s`);
  console.log(`  Media items: ${project.mediaLibrary.items.length}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const cmd = args[0];
  switch (cmd) {
    case "list":
      await cmdList();
      break;
    case "create": {
      const name = args[1];
      if (!name) fail("Project name required: tsx scripts/project.ts create <name>");
      await cmdCreate(name, args.slice(2));
      break;
    }
    case "rename": {
      const id = args[1];
      const newName = args[2];
      if (!id || !newName) fail("Usage: tsx scripts/project.ts rename <id> <new-name>");
      await cmdRename(id, newName);
      break;
    }
    case "delete": {
      const id = args[1];
      if (!id) fail("Usage: tsx scripts/project.ts delete <id>");
      await cmdDelete(id);
      break;
    }
    case "info": {
      const id = args[1];
      if (!id) fail("Usage: tsx scripts/project.ts info <id>");
      await cmdInfo(id);
      break;
    }
    default:
      fail(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
