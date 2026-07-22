import {
  ResolveExportJobSchema,
  ResolvePreviewSchema,
  type ResolveExportJob,
  type ResolvePreview,
} from "@openreel/core";
import { z } from "zod";

const DEFAULT_ORCHESTRATOR_URL =
  (import.meta.env["VITE_ORCHESTRATOR_URL"] as string | undefined) ??
  "http://localhost:4041";
const BRIDGE_TOKEN_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ResolveProjectListItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    createdAt: z.number().finite(),
    modifiedAt: z.number().finite(),
  })
  .strict();
const ResolveProjectListSchema = z.array(ResolveProjectListItemSchema);
const ResolveErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(100),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

const ResolveExportStartRequestSchema = z
  .object({
    revision: z.string().min(1),
    selection: z
      .object({
        projectId: z.string().min(1),
        projectModifiedAt: z.number().finite(),
        target: z.literal("resolve"),
        range: z
          .object({
            startTime: z.number().finite().min(0),
            endTime: z.number().finite(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ selection }) => selection.range.endTime > selection.range.startTime,
    "selection.range.endTime must be after selection.range.startTime",
  );

export type ResolveProjectListItem = z.infer<typeof ResolveProjectListItemSchema>;
export type ResolveExportStartRequest = z.infer<typeof ResolveExportStartRequestSchema>;

export interface ResolveBridgeRequestOptions {
  /** Cancels the browser request without changing the export job. */
  readonly signal?: AbortSignal;
  /** Injectable only for local tests and embedders. */
  readonly fetch?: typeof globalThis.fetch;
  /** Overrides the local orchestrator endpoint for local deployments. */
  readonly baseUrl?: string;
}

export class ResolveBridgeClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ResolveBridgeClientError";
  }
}

const SAFE_STATUS_MESSAGES: Record<number, string> = {
  400: "The Resolve export request is invalid.",
  404: "The requested Resolve resource was not found.",
  409: "The Resolve export conflicts with its current state.",
  410: "The Resolve launch request is no longer available.",
};

function endpoint(path: string, options?: ResolveBridgeRequestOptions): string {
  return new URL(path, options?.baseUrl ?? DEFAULT_ORCHESTRATOR_URL).toString();
}

function projectPath(projectId: string): string {
  return encodeURIComponent(projectId);
}

function jobPath(jobId: string): string {
  return encodeURIComponent(jobId);
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit,
  options?: ResolveBridgeRequestOptions,
): Promise<T> {
  let response: Response;
  try {
    response = await (options?.fetch ?? globalThis.fetch)(endpoint(path, options), {
      ...init,
      signal: options?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ResolveBridgeClientError(
      "REQUEST_FAILED",
      "The Resolve export could not be reached.",
    );
  }

  const payload = await responseJson(response);
  if (!response.ok) {
    const parsedError = ResolveErrorResponseSchema.safeParse(payload);
    const code = parsedError.success ? parsedError.data.error.code : "REQUEST_FAILED";
    const message = code === "ARTIFACT_CAPABILITY_EXPIRED"
      ? "Artifact access expired. Start a new Resolve export job."
      : (SAFE_STATUS_MESSAGES[response.status] ?? "The Resolve export could not be processed.");
    throw new ResolveBridgeClientError(code, message, response.status);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ResolveBridgeClientError(
      "INVALID_RESPONSE",
      "The Resolve export returned an invalid response.",
      response.status,
    );
  }
  return parsed.data;
}

export async function listProjects(
  options?: ResolveBridgeRequestOptions,
): Promise<ResolveProjectListItem[]> {
  return request("/api/projects", ResolveProjectListSchema, { method: "GET" }, options);
}

export async function getPreview(
  projectId: string,
  options?: ResolveBridgeRequestOptions,
): Promise<ResolvePreview> {
  return request(
    `/api/projects/${projectPath(projectId)}/resolve-preview`,
    ResolvePreviewSchema,
    { method: "GET" },
    options,
  );
}

export async function startExport(
  projectId: string,
  input: ResolveExportStartRequest,
  options?: ResolveBridgeRequestOptions,
): Promise<ResolveExportJob> {
  const parsed = ResolveExportStartRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ResolveBridgeClientError(
      "INVALID_REQUEST",
      "The Resolve export request is invalid.",
    );
  }
  return request(
    `/api/projects/${projectPath(projectId)}/exports/resolve`,
    ResolveExportJobSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    },
    options,
  );
}

export async function getExportJob(
  projectId: string,
  jobId: string,
  options?: ResolveBridgeRequestOptions,
): Promise<ResolveExportJob> {
  return request(
    `/api/projects/${projectPath(projectId)}/exports/resolve/${jobPath(jobId)}`,
    ResolveExportJobSchema,
    { method: "GET" },
    options,
  );
}

export async function cancelExport(
  projectId: string,
  jobId: string,
  options?: ResolveBridgeRequestOptions,
): Promise<ResolveExportJob> {
  return request(
    `/api/projects/${projectPath(projectId)}/exports/resolve/${jobPath(jobId)}`,
    ResolveExportJobSchema,
    { method: "DELETE" },
    options,
  );
}

/** Opens only the one-use URL minted by the local Resolve bridge. */
export function launchResolveBridge(
  url: string,
  location: Pick<Location, "assign"> = window.location,
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid bridge URL");
  }
  if (
    url !== `openreel-resolve://import${parsed.pathname}` ||
    parsed.protocol !== "openreel-resolve:" ||
    parsed.hostname !== "import" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !BRIDGE_TOKEN_PATH.test(parsed.pathname)
  ) {
    throw new Error("invalid bridge URL");
  }
  location.assign(parsed.toString());
}
