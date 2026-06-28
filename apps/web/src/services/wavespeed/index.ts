/**
 * WaveSpeed browser client — talks to the orchestrator (key stays server-side).
 */

import { ORCHESTRATOR_URL } from "../../stores/music-video-store";

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

export async function fetchModels(): Promise<WavespeedModel[]> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/generate/wavespeed/models`);
  if (!res.ok) throw new Error(`Failed to fetch WaveSpeed models: HTTP ${res.status}`);
  const json = await res.json() as { models: WavespeedModel[] };
  return json.models;
}

export async function submitGeneration(
  model: string,
  inputs: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/generate/wavespeed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, inputs }),
  });
  if (!res.ok) throw new Error(`WaveSpeed submit failed: HTTP ${res.status}`);
  const json = await res.json() as { jobId?: string; error?: string };
  if (!json.jobId) throw new Error(json.error ?? "No jobId returned");
  return json.jobId;
}

export async function pollJob(jobId: string): Promise<JobResult> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/generate/wavespeed/${jobId}`);
  if (!res.ok) throw new Error(`WaveSpeed poll failed: HTTP ${res.status}`);
  return res.json() as Promise<JobResult>;
}
