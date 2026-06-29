import { Router } from "express";
import type { Request, Response } from "express";
import type { ProjectSettings } from "@openreel/core";
import { ProjectStore } from "./project-store";

export function createProjectRouter(store: ProjectStore): Router {
  const router = Router();

  // GET /api/projects — list all projects
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const projects = await store.listProjects();
      res.json(projects);
    } catch (err) {
      res.status(500).json({ error: "Failed to list projects", detail: String(err) });
    }
  });

  // GET /api/projects/:id — get single project
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const project = await store.loadProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: "Failed to load project", detail: String(err) });
    }
  });

  // POST /api/projects — create a new project
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { name, settings } = req.body as {
        name?: string;
        settings?: Partial<ProjectSettings>;
      };
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Project name is required" });
        return;
      }
      const project = await store.createProject(name.trim(), settings);
      res.status(201).json(project);
    } catch (err) {
      res.status(500).json({ error: "Failed to create project", detail: String(err) });
    }
  });

  // PATCH /api/projects/:id — update project metadata (rename)
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Project name is required" });
        return;
      }
      const project = await store.renameProject(req.params.id, name.trim());
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: "Failed to rename project", detail: String(err) });
    }
  });

  // DELETE /api/projects/:id — delete a project
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const deleted = await store.deleteProject(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete project", detail: String(err) });
    }
  });

  return router;
}
