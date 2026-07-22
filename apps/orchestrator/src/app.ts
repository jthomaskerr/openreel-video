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
import { GenerationProjectActionAdapter } from "./services/generation/project-action-adapter";
import { createReplaySafeGenerationOutputDownloader } from "./services/generation/output-downloader";
import { WaveSpeedProvider } from "./services/wavespeed/client";
import { WaveSpeedInputMaterializer } from "./services/wavespeed/input-materializer";
import { mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
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

interface ResolveGenerationProviderInput {
  readonly injectedProvider?: GenerationProviderPort;
  readonly productionProvider?: GenerationProviderPort;
}

interface CreateAppOptions {
  readonly generationProvider?: GenerationProviderPort;
}

export function resolveGenerationProvider(input: ResolveGenerationProviderInput): {
  readonly provider: GenerationProviderPort;
  readonly configured: boolean;
  readonly productionProvider?: GenerationProviderPort;
} {
  const configuredProvider = input.injectedProvider ?? input.productionProvider;
  return {
    provider: configuredProvider ?? {
      submit: async () => { throw new Error("provider-not-configured"); },
      status: async () => { throw new Error("provider-not-configured"); },
    },
    configured: Boolean(configuredProvider),
    productionProvider: input.productionProvider,
  };
}

function inspectOutput(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png" && bytes.byteLength >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return {};
}

export function createApp(options: CreateAppOptions = {}): Express {
  const gitStore = new GitStore(config.projectsRepo);
  const projectStore = new ProjectStore(gitStore);
  const generationRepository = new FileGenerationJobRepository(config.generationDataDir);
  const uploadRepository = new UploadRepository(`${config.generationDataDir}/uploads`);
  const routes = parseGenerationRouteManifest(config.generationRouteManifestJson);
  const wavespeedProvider = !options.generationProvider && config.wavespeedApiKey
    ? new WaveSpeedProvider({ baseUrl: config.wavespeedBaseUrl, apiKey: config.wavespeedApiKey })
    : undefined;
  const generationRuntime = resolveGenerationProvider({
    injectedProvider: options.generationProvider,
    productionProvider: wavespeedProvider,
  });
  const provider = generationRuntime.provider;
  const inputMaterializer = wavespeedProvider
    ? new WaveSpeedInputMaterializer({ uploads: uploadRepository, routes, mediaUpload: wavespeedProvider })
    : undefined;
  const downloadCacheDir = join(config.generationDataDir, "download-cache");
  const projectActions = new GenerationProjectActionAdapter({
    projectStore,
    gitStore,
    downloadCacheDir,
  });
  const wavespeedRouter = createWaveSpeedRouter({
    repository: generationRepository,
    uploads: uploadRepository,
    provider,
    inputMaterializer,
    routes,
    releaseEnabled: config.generationV2ReleaseEnabled,
    configured: generationRuntime.configured,
    authenticate,
    owner: async ({ ownerId, projectId }) => ownerId === config.authenticatedOwnerId && Boolean(await projectStore.loadProject(projectId)),
    discoverModels: async () => routes.map(({ identity, inputSchema, supportsAudio }) => ({
      ...identity,
      inputSchema,
      supportsAudio,
    })),
    applyProjectAction: (command) => projectActions.applyProjectAction(command),
    createFinalizer: (repository) => new GenerationFinalizer(repository, {
      download: createReplaySafeGenerationOutputDownloader({ cacheDir: downloadCacheDir, provider }),
      verify: {
        verify: async ({ bytes, mimeType, maxBytes }) => {
          outputExtension(mimeType);
          if (bytes.byteLength === 0) throw new Error("generation-output-empty");
          if (bytes.byteLength > maxBytes) throw new Error("generation-output-too-large");
        },
      },
      inspect: { inspect: async ({ bytes, mimeType }) => inspectOutput(bytes, mimeType) },
      placeholder: projectActions,
      shot: projectActions,
      placement: projectActions,
      projectAction: projectActions,
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
      wavespeed: generationRuntime.configured,
      kieAi: !!config.kieAiApiKey,
      claude: !!config.claudeToken,
    });
  });

  app.use("/api/import/neuralframes", neuralframesRouter);
  app.use("/api/generate/wavespeed", wavespeedRouter);
  app.use("/api/projects", createProjectRouter(projectStore, gitStore));

  return app;
}
