export const MEDIA_AVAILABILITY_STATUSES = [
  "available",
  "verifying",
  "temporarily_unavailable",
  "confirmed_missing",
  "decode_error",
  "unauthorized",
] as const;

export type MediaAvailabilityStatus = (typeof MEDIA_AVAILABILITY_STATUSES)[number];

export interface MediaAvailabilityEvidence {
  readonly authoritative: boolean;
  readonly mapping: "present" | "absent" | "unknown";
  readonly object: "present" | "absent" | "unknown";
  readonly filename?: string;
  readonly expectedBytes?: number;
  readonly actualBytes?: number;
  readonly contentType?: string;
  readonly reason?: string;
}

export interface MediaVerificationOutcome {
  readonly mediaId: string;
  readonly status: MediaAvailabilityStatus;
  readonly evidence: MediaAvailabilityEvidence;
}

export interface MediaVerificationBatchRequest {
  readonly mediaIds: readonly string[];
}

export interface MediaVerificationBatchResponse {
  readonly projectId: string;
  readonly outcomes: readonly MediaVerificationOutcome[];
}

export function isAuthoritativeMissing(evidence: MediaAvailabilityEvidence): boolean {
  return evidence.authoritative && evidence.mapping !== "unknown" && evidence.object === "absent";
}
