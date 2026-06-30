import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { mkdirSync, createWriteStream } from "node:fs";
import { join, extname } from "node:path";
import { get as httpsGet } from "node:https";
import { Client } from "wavespeed";
import { config } from "../env.js";

export const wavespeedRouter: ExpressRouter = Router();

// ── SDK client (per request — key comes from the request header or env fallback) ─────────────────

type WaveSpeedHeaderRequest = {
  header(name: string): string | undefined;
};

type WaveSpeedClient = {
  _submit(model: string, inputs: Record<string, unknown>): Promise<[string]>;
  _getResult(jobId: string): Promise<{
    data: { status: string; outputs: string[]; error: string };
  }>;
};

function getWaveSpeedApiKey(req: WaveSpeedHeaderRequest): string | null {
  const key = req.header("x-wavespeed-api-key") ?? config.wavespeedApiKey;
  return key ?? null;
}


// ── Model cache ────────────────────────────────────────────────────────────────

export interface WavespeedModel {
  model_id: string;
  name: string;
  type: string;
  description: string;
  base_price: number;
  formula: string;
  sort_order: number;
  api_schema: {
    api_schemas: Array<{
      type: string;
      method: string;
      server: string;
      api_path: string;
      request_schema: {
        properties: Record<string, unknown>;
        required?: string[];
        type: string;
        "x-order-properties"?: string[];
      };
    }>;
  };
}

let modelCache: WavespeedModel[] | null = null;
let modelCacheAt = 0;
const MODEL_TTL_MS = 60 * 60 * 1000;

async function fetchModels(apiKey: string): Promise<WavespeedModel[]> {
  if (modelCache && Date.now() - modelCacheAt < MODEL_TTL_MS) return modelCache;

  const res = await fetch("https://api.wavespeed.ai/api/v3/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`WaveSpeed models fetch failed: HTTP ${res.status}`);
  const json = await res.json() as { code: number; data: WavespeedModel[] };
  if (json.code !== 200) throw new Error(`WaveSpeed models error: ${json.code}`);

  modelCache = json.data;
  modelCacheAt = Date.now();
  return modelCache;
}

// ── Job tracking ───────────────────────────────────────────────────────────────

interface Job {
  wavespeedId: string;
  model: string;
  status: "pending" | "processing" | "completed" | "failed";
  outputUrl?: string;
  error?: string;
}

const jobs = new Map<string, Job>();

// ── Download helper ────────────────────────────────────────────────────────────

function downloadFile(url: string, destPath: string): Promise<void> {
  let resolve!: () => void, reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  httpsGet(url, (res) => {
    if (res.statusCode !== 200) {
      reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      res.resume();
      return;
    }
    const out = createWriteStream(destPath);
    res.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
  }).on("error", reject);
  return promise;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/** GET /api/generate/wavespeed/models — cached model list with full schemas */
wavespeedRouter.get("/models", async (req, res) => {
  const key = getWaveSpeedApiKey(req);
  if (!key) {
    res.status(503).json({ error: "WaveSpeed API key not configured" });
    return;
  }
  try {
    const models = await fetchModels(key);
    res.json({ models });
  } catch (e) {
    res.status(502).json({ error: `Failed to fetch models: ${(e as Error).message}` });
  }
});

/** POST /api/generate/wavespeed — submit generation, returns jobId immediately */
wavespeedRouter.post("/", async (req, res) => {
  const key = getWaveSpeedApiKey(req);
  if (!key) {
    res.status(503).json({ error: "WaveSpeed API key not configured" });
    return;
  }
  const { model, inputs } = req.body as { model: string; inputs: Record<string, unknown> };
  if (!model || !inputs) {
    res.status(400).json({ error: "model and inputs are required" });
    return;
  }
  try {
    const client = new Client(key) as unknown as WaveSpeedClient;
    const [wavespeedId] = await client._submit(model, inputs);
    if (!wavespeedId) throw new Error("No prediction ID returned from WaveSpeed");

    const jobId = crypto.randomUUID();
    jobs.set(jobId, { wavespeedId, model, status: "pending" });
    res.json({ jobId });
  } catch (e) {
    res.status(502).json({ error: `Submission failed: ${(e as Error).message}` });
  }
});

/** GET /api/generate/wavespeed/:jobId — poll job status */
wavespeedRouter.get("/:jobId", async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const key = getWaveSpeedApiKey(req);
  if (!key) {
    res.status(503).json({ error: "WaveSpeed API key not configured" });
    return;
  }
  try {
    const client = new Client(key) as unknown as WaveSpeedClient;
    const result = await client._getResult(job.wavespeedId);
    const { status, outputs, error } = result.data;

    if (status === "completed" && outputs?.length > 0) {
      const remoteUrl = outputs[0];
      const ext = extname(new URL(remoteUrl).pathname) || ".jpg";
      const cacheDir = join(config.generatedAssetsDir, "wavespeed", job.wavespeedId);
      mkdirSync(cacheDir, { recursive: true });
      const localFile = join(cacheDir, `result${ext}`);
      await downloadFile(remoteUrl, localFile);
      const rel = localFile.slice(config.generatedAssetsDir.length);
      job.status = "completed";
      job.outputUrl = `http://localhost:${config.port}/assets${rel}`;
      res.json({ status: "completed", outputUrl: job.outputUrl });
    } else if (status === "failed" || error) {
      job.status = "failed";
      job.error = error || "Generation failed";
      res.json({ status: "failed", error: job.error });
    } else {
      job.status = "processing";
      res.json({ status: "processing" });
    }
  } catch (e) {
    res.status(502).json({ error: `Poll failed: ${(e as Error).message}` });
  }
});
