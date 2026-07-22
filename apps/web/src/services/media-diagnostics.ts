export interface MediaDiagnosticInput {
  readonly operation: string;
  readonly projectId: string;
  readonly mediaId?: string;
  readonly filename?: string;
  readonly stage: string;
  readonly error: unknown;
}

export function createMediaDiagnostic(input: MediaDiagnosticInput) {
  const normalized =
    input.error instanceof Error
      ? { errorName: input.error.name, errorMessage: input.error.message }
      : { errorName: "UnknownError", errorMessage: String(input.error) };
  return {
    operation: input.operation,
    projectId: input.projectId,
    ...(input.mediaId ? { mediaId: input.mediaId } : {}),
    ...(input.filename ? { filename: input.filename } : {}),
    stage: input.stage,
    ...normalized,
  };
}
