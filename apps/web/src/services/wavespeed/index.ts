/**
 * WaveSpeed browser client — attaches the user's secure API key to orchestrator requests.
 */

import { ORCHESTRATOR_URL } from "../../stores/music-video-store";
import { getSecret } from "../secure-storage";
import { staleWhileRevalidate, CACHE_KEYS } from "../cache";
import type { CacheResult } from "../cache";
import { WAVESPEED_SECRET_ID } from "../service-instances";

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
        properties: Record<string, SchemaProperty>;
        required?: string[];
        type: string;
        "x-order-properties"?: string[];
      };
    }>;
  };
}

export interface SchemaProperty {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  items?: SchemaProperty;
  "x-ui-component"?: string;
  "x-ui-component-props"?: Record<string, unknown>;
  "x-rows"?: number;
  "x-accept"?: string;
  "x-order-properties"?: string[];
}

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobResult {
  status: JobStatus;
  outputUrl?: string;
  error?: string;
}
async function getWaveSpeedHeaders(extraHeaders: HeadersInit = {}): Promise<Headers> {
  const apiKey = await getSecret(WAVESPEED_SECRET_ID);
  if (!apiKey) {
    throw new Error("WaveSpeed API key not configured. Open Settings → API Keys.");
  }

  const headers = new Headers(extraHeaders);
  headers.set("X-WaveSpeed-Api-Key", apiKey);
  return headers;
}

export async function fetchModels(): Promise<WavespeedModel[]> {
  const headers = await getWaveSpeedHeaders();
  const res = await fetch(`${ORCHESTRATOR_URL}/api/generate/wavespeed/models`, {
    headers,
  });
  if (!res.ok) throw new Error(`Failed to fetch WaveSpeed models: HTTP ${res.status}`);
  const json = await res.json() as { models: WavespeedModel[] };
  return json.models;
}


/**
 * Fetch WaveSpeed models with stale-while-revalidate caching.
 * Returns cached data immediately (if available) + a refresh function.
 * Caller should: render `cached` immediately, then call `refresh()` and
 * update UI when the promise resolves.
 */
export function fetchModelsCached(): CacheResult<WavespeedModel[]> {
  return staleWhileRevalidate(
    CACHE_KEYS.WAVESPEED_MODELS,
    fetchModels,
    3_600_000, // 1 hour TTL
  );
}

export async function submitGeneration(
  model: string,
  inputs: Record<string, unknown>,
): Promise<string> {
  const headers = await getWaveSpeedHeaders({
    "Content-Type": "application/json",
  });
  const res = await fetch(`${ORCHESTRATOR_URL}/api/generate/wavespeed`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, inputs }),
  });
  if (!res.ok) throw new Error(`WaveSpeed submit failed: HTTP ${res.status}`);
  const json = await res.json() as { jobId?: string; error?: string };
  if (!json.jobId) throw new Error(json.error ?? "No jobId returned");
  return json.jobId;
}

export async function pollJob(jobId: string): Promise<JobResult> {
  const headers = await getWaveSpeedHeaders();
  const res = await fetch(`${ORCHESTRATOR_URL}/api/generate/wavespeed/${jobId}`, {
    headers,
  });
  if (!res.ok) throw new Error(`WaveSpeed poll failed: HTTP ${res.status}`);
  return res.json() as Promise<JobResult>;
}
