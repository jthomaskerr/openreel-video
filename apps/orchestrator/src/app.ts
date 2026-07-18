import express from "express";
import type { Express } from "express";
import cors from "cors";
import { config } from "./env";
import { ProjectStore, createProjectRouter, GitStore } from "./projects";
import { neuralframesRouter } from "./routes/neuralframes";
import {
  createWaveSpeedRouter,
  parseGenerationRouteManifest,
} from "./routes/wavespeed";
import { GenerationFinalizer } from "./services/generation/finalization";
import { FileGenerationJobRepository } from "./services/generation/repository";
import { UploadRepository } from "./services/generation/uploads";
import type { GenerationProviderPort } from "./services/generation/index";
import { WaveSpeedProvider } from "./services/wavespeed/client";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

function authenticate(request: unknown): { ownerId: string } | undefined {
  if (!config.orchestratorAuthToken) return undefined;
  const header = String((request as { headers?: { authorization?: string } }).headers?.authorization ?? "");
  const expected = `Bearer ${config.orchestratorAuthToken}`;
  const receivedBytes = Buffer.from(header);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.byteLength !== expectedBytes.byteLength || !timingSafeEqual(receivedBytes, expectedBytes)) return undefined;
  return { ownerId: config.authenticatedOwnerId };
}

function outputExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/mp4") return "mp4";
  throw new Error("generation-output-mime-unsupported");
}

function inspectOutput(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png" && bytes.byteLength >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return {};
}

export function createApp(): Express {
  const gitStore = new GitStore(config.projectsRepo);
  const projectStore = new ProjectStore(gitStore);
  const generationRepository = new FileGenerationJobRepository(config.generationDataDir);
  const uploadRepository = new UploadRepository(`${config.generationDataDir}/uploads`);
  const routes = parseGenerationRouteManifest(config.generationRouteManifestJson);
  const provider: GenerationProviderPort = config.wavespeedApiKey
    ? new WaveSpeedProvider({ baseUrl: config.wavespeedBaseUrl, apiKey: config.wavespeedApiKey })
    : {
      submit: async () => { throw new Error("provider-not-configured"); },
      status: async () => { throw new Error("provider-not-configured"); },
    };
  const downloadCacheDir = join(config.generationDataDir, "download-cache");
  const wavespeedRouter = createWaveSpeedRouter({
    repository: generationRepository,
    uploads: uploadRepository,
    provider,
    routes,
    releaseEnabled: config.generationV2ReleaseEnabled,
    configured: Boolean(config.wavespeedApiKey),
    authenticate,
    owner: async ({ ownerId, projectId }) => ownerId === config.authenticatedOwnerId && Boolean(await projectStore.loadProject(projectId)),
    discoverModels: async () => routes.map(({ identity }) => ({ ...identity })),
    createFinalizer: (repository) => new GenerationFinalizer(repository, {
      download: {
        download: async ({ providerJobId }) => {
          const routing = routes[0]?.identity;
          if (!routing) throw new Error("generation-route-unsupported");
          const state = await provider.status({ providerJobId, routing });
          const outputUrls = state.outputUrls ?? [];
          if (state.status !== "completed" || outputUrls.length !== 1) throw new Error("generation-output-identity-invalid");
          const url = new URL(outputUrls[0]);
          if (url.protocol !== "https:") throw new Error("generation-local-url-forbidden");
          const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!response.ok) throw new Error("generation-output-download-failed");
          const mimeType = String(response.headers.get("content-type") ?? "").split(";")[0];
          outputExtension(mimeType);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const cacheKey = createHash("sha256").update(providerJobId).digest("hex");
          await mkdir(downloadCacheDir, { recursive: true });
          await Promise.all([
            writeFile(join(downloadCacheDir, `${cacheKey}.bin`), bytes),
            writeFile(join(downloadCacheDir, `${cacheKey}.json`), JSON.stringify({ mimeType }), "utf8"),
          ]);
          return { bytes, mimeType };
        },
      },
      verify: {
        verify: async ({ bytes, mimeType, maxBytes }) => {
          outputExtension(mimeType);
          if (bytes.byteLength === 0) throw new Error("generation-output-empty");
          if (bytes.byteLength > maxBytes) throw new Error("generation-output-too-large");
        },
      },
      inspect: { inspect: async ({ bytes, mimeType }) => inspectOutput(bytes, mimeType) },
      placeholder: {
        finalize: async ({ job, output }) => {
          const providerJobId = job.providerJobId;
          if (!providerJobId) throw new Error("generation-provider-id-missing");
          const project = await projectStore.loadProject(job.projectId);
          if (!project) throw new Error("generation-project-not-found");
          const existing = project.mediaLibrary.items.find((item) => item.generationMeta?.jobId === job.id);
          if (existing) return { mediaId: existing.assetGroupId ?? existing.id, versionId: existing.id };

          const cacheKey = createHash("sha256").update(providerJobId).digest("hex");
          const [{ mimeType }, bytes] = await Promise.all([
            readFile(join(downloadCacheDir, `${cacheKey}.json`), "utf8").then((value) => JSON.parse(value) as { mimeType: string }),
            readFile(join(downloadCacheDir, `${cacheKey}.bin`)),
          ]);
          const extension = outputExtension(mimeType);
          const mediaId = `generated-${job.id}`;
          const versionId = `${mediaId}-v1`;
          const filename = `${versionId}.${extension}`;
          await mkdir(config.generatedAssetsDir, { recursive: true });
          await writeFile(join(config.generatedAssetsDir, filename), bytes);
          const inspected = inspectOutput(bytes, mimeType);
          await projectStore.saveProject({
            ...project,
            mediaLibrary: {
              items: [...project.mediaLibrary.items, {
                id: versionId,
                name: filename,
                type: mimeType.startsWith("video/") ? "video" : "image",
                fileHandle: null,
                blob: null,
                metadata: {
                  fileSize: bytes.byteLength,
                  width: output.width ?? inspected.width ?? 0,
                  height: output.height ?? inspected.height ?? 0,
                  duration: output.durationSeconds ?? 0,
                  frameRate: 0,
                  codec: mimeType,
                  sampleRate: 0,
                  channels: 0,
                },
                thumbnailUrl: null,
                originalUrl: `/assets/${encodeURIComponent(filename)}`,
                assetGroupId: mediaId,
                isCurrent: true,
                generationMeta: {
                  provider: job.provider,
                  model: job.modelId,
                  prompt: job.context.prompt,
                  jobId: job.id,
                  status: "succeeded",
                },
              }],
            },
          });
          return { mediaId, versionId };
        },
      },
      shot: {
        link: async () => { throw new Error("generation-project-shot-link-unavailable"); },
      },
      placement: {
        place: async () => ({
          outcome: "not-applied",
          replaySafe: true,
          error: { code: "generation-project-placement-unavailable", message: "Server timeline placement is unavailable", retryable: false },
        }),
        reconcile: async () => ({ outcome: "unknown" }),
      },
    }),
  });
  void projectStore.migrateUuidDirs().catch((err) => {
    console.error("[ProjectStore] failed to migrate legacy project directories:", err);
  });
  const app = express();

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
  app.use("/api/projects", createProjectRouter(projectStore, gitStore));

  return app;
}
