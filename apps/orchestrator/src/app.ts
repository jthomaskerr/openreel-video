import express from "express";
import type { Express } from "express";
import cors from "cors";
import { config } from "./env";
import {
  ProjectStore,
  createProjectRouter,
  GitStore,
  ProjectCommitScheduler,
} from "./projects";
import { neuralframesRouter, wavespeedRouter } from "./routes/index";
import { mkdirSync } from "node:fs";

export interface OrchestratorApp extends Express {
  readonly dispose: () => void;
}

export function createApp(): OrchestratorApp {
  const gitStore = new GitStore(config.projectsRepo);
  const projectStore = new ProjectStore(gitStore);
  const commitScheduler = new ProjectCommitScheduler({
    debounceMs: config.projectCommitDebounceMs,
    execute: async (projectId, _generation, shouldCommit) => {
      let audited: Awaited<ReturnType<ProjectStore["auditSnapshot"]>> | null = null;
      const result = await gitStore.commitCumulativeProjectDiff(
        projectId,
        async (project) => {
          audited = await projectStore.auditSnapshot(project, { pointerSource: "index" });
        },
        shouldCommit,
      );
      if (result.kind === "metadata-only") return result;
      const project = await projectStore.loadProject(projectId);
      const completedAudit = audited as Awaited<ReturnType<ProjectStore["auditSnapshot"]>> | null;
      if (!project || !completedAudit) {
        throw new Error(`Committed project ${projectId} could not be audited`);
      }
      const persistedAt = result.receipt.commitSha
        ? await gitStore.readCommitTimestamp(projectId, result.receipt.commitSha)
        : null;
      return {
        kind: "committed",
        receipt: {
          saved: true,
          committed: true,
          commitDueAt: null,
          projectId,
          persistedAt,
          sourceModifiedAt: project.modifiedAt,
          commitSha: result.receipt.commitSha,
          treeSha: result.receipt.treeSha,
          projectBlobSha: result.receipt.projectBlobSha,
          mediaManifestDigest: completedAudit.mediaManifestDigest,
          lfsPayloads: completedAudit.lfsPayloads,
        },
      };
    },
    publishStatus: (status) => {
      if (status.state === "retry-wait") {
        console.error("[Persistence] background commit failed", {
          projectId: status.projectId,
          error: status.error,
          retryAt: status.commitDueAt,
        });
      }
    },
  });
  void projectStore.migrateUuidDirs()
    .then(async () => {
      const projects = await projectStore.listProjects();
      await Promise.all(projects.map(async ({ id }) => {
        const dirty = await gitStore.inspectDirtyProject(id);
        if (!dirty) return;
        commitScheduler.noteAcceptedSave(
          id,
          dirty.sourceModifiedAt,
          dirty.newestChangedPathAt,
          dirty.semanticChanged,
        );
      }));
    })
    .catch((err) => {
      console.error("[ProjectStore] failed to recover dirty project commit timers:", err);
    });
  const app = express() as OrchestratorApp;
  Object.defineProperty(app, "dispose", {
    value: () => commitScheduler.dispose(),
    enumerable: false,
  });

  app.use(cors());
  app.use("/api/generate/wavespeed/upload", express.raw({ limit: "50mb", type: ["image/*", "video/*", "audio/*"] }));
  app.use(express.json({ limit: "50mb" }));

  // Serve locally cached generated assets (scene images etc.)
  mkdirSync(config.generatedAssetsDir, { recursive: true });
  app.use("/assets", (_req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  }, express.static(config.generatedAssetsDir));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      wavespeed: !!config.wavespeedApiKey,
      kieAi: !!config.kieAiApiKey,
      claude: !!config.claudeToken,
    });
  });

  app.use("/api/import/neuralframes", neuralframesRouter);
  app.use("/api/generate/wavespeed", wavespeedRouter);
  app.use("/api/projects", createProjectRouter(projectStore, gitStore, commitScheduler));

  return app;
}
