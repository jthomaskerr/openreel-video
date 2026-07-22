export const DEFAULT_MAX_MEDIA_SOURCE_BYTES = 2 * 1024 ** 3;

export function parseConfiguredMaxMediaSourceBytes(
  value: string | undefined,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_MEDIA_SOURCE_BYTES;
}

export interface MediaImportPreflightInput {
  readonly sourceBytes: number;
  readonly maxSourceBytes?: number;
  readonly knownAvailableBytes?: number;
  readonly runtimeLimitBytes?: number;
}

export type MediaImportPreflightResult =
  | {
      readonly accepted: true;
      readonly effectiveLimitBytes: number;
    }
  | {
      readonly accepted: false;
      readonly reason:
        | "configured-cap"
        | "available-capacity"
        | "runtime-capability";
      readonly limitBytes: number;
    };

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a non-negative finite integer`);
  }
}

export function evaluateMediaImportPreflight(
  input: MediaImportPreflightInput,
): MediaImportPreflightResult {
  const maxSourceBytes = input.maxSourceBytes ?? DEFAULT_MAX_MEDIA_SOURCE_BYTES;
  requireNonNegativeInteger(input.sourceBytes, "sourceBytes");
  requireNonNegativeInteger(maxSourceBytes, "maxSourceBytes");
  if (maxSourceBytes === 0) {
    throw new RangeError("maxSourceBytes must be greater than zero");
  }

  const limits: Array<{
    reason: "configured-cap" | "available-capacity" | "runtime-capability";
    bytes: number;
  }> = [{ reason: "configured-cap", bytes: maxSourceBytes }];

  if (input.knownAvailableBytes !== undefined) {
    requireNonNegativeInteger(input.knownAvailableBytes, "knownAvailableBytes");
    limits.push({ reason: "available-capacity", bytes: input.knownAvailableBytes });
  }
  if (input.runtimeLimitBytes !== undefined) {
    requireNonNegativeInteger(input.runtimeLimitBytes, "runtimeLimitBytes");
    limits.push({ reason: "runtime-capability", bytes: input.runtimeLimitBytes });
  }

  const effective = limits.reduce((lowest, current) =>
    current.bytes < lowest.bytes ? current : lowest,
  );
  if (input.sourceBytes > effective.bytes) {
    return {
      accepted: false,
      reason: effective.reason,
      limitBytes: effective.bytes,
    };
  }
  return { accepted: true, effectiveLimitBytes: effective.bytes };
}

interface StorageEstimateLike {
  readonly quota?: number;
  readonly usage?: number;
}

interface StorageManagerLike {
  estimate(): Promise<StorageEstimateLike>;
}

export async function getMediaStorageEvidence(
  storageManager: StorageManagerLike | undefined = navigator.storage,
): Promise<{ knownAvailableBytes?: number; warning?: string }> {
  if (!storageManager?.estimate) {
    return {
      knownAvailableBytes: undefined,
      warning: "Browser storage capacity could not be estimated.",
    };
  }
  try {
    const { quota, usage } = await storageManager.estimate();
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) {
      return {
        knownAvailableBytes: undefined,
        warning: "Browser storage capacity could not be estimated.",
      };
    }
    return { knownAvailableBytes: Math.max(0, Math.floor(quota! - usage!)) };
  } catch {
    return {
      knownAvailableBytes: undefined,
      warning: "Browser storage capacity could not be estimated.",
    };
  }
}
