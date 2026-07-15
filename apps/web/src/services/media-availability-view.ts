import { useCallback, useSyncExternalStore } from "react";
import type { MediaAvailabilityStatus, MediaItem } from "@openreel/core";
import { getMediaStatus, MediaStatus } from "@openreel/core";
import { mediaAvailabilityRuntime } from "./media-verification";

export type MediaAvailabilityViewStatus =
  | MediaAvailabilityStatus
  | "unrealized"
  | "pending"
  | "error";

export type MediaAvailabilityAction = "relink" | "verify";

export interface MediaAvailabilityView {
  readonly status: MediaAvailabilityViewStatus;
  readonly label: string;
  readonly description: string;
  readonly action: MediaAvailabilityAction | null;
  readonly actionLabel: string | null;
  readonly className: string;
  readonly isMissing: boolean;
  readonly canRender: boolean;
}

function fallbackStatus(item: MediaItem): MediaAvailabilityViewStatus {
  switch (getMediaStatus(item)) {
    case MediaStatus.UNREALIZED:
      return "unrealized";
    case MediaStatus.PENDING:
      return "pending";
    case MediaStatus.ERROR:
      return "error";
    case MediaStatus.MISSING:
      // A legacy placeholder is not authoritative absence. Verification decides.
      return "verifying";
    default:
      return "available";
  }
}

export function selectMediaAvailabilityStatus(
  item: MediaItem | undefined,
  runtimeStatus: MediaAvailabilityStatus | undefined,
): MediaAvailabilityViewStatus {
  if (!item) return "confirmed_missing";
  return runtimeStatus ?? fallbackStatus(item);
}

export function selectMediaAvailabilityView(
  item: MediaItem | undefined,
  runtimeStatus: MediaAvailabilityStatus | undefined,
  semanticName = item?.sourceFile?.name ?? item?.name ?? "Media",
): MediaAvailabilityView {
  const status = selectMediaAvailabilityStatus(item, runtimeStatus);
  switch (status) {
    case "available":
      return { status, label: "Available", description: `${semanticName} is available.`, action: null, actionLabel: null, className: "", isMissing: false, canRender: true };
    case "confirmed_missing":
      return { status, label: "Missing", description: `${semanticName} is confirmed missing. Relink the original file; the warning remains until backend persistence is confirmed.`, action: "relink", actionLabel: "Relink file", className: "border-yellow-400/70 bg-yellow-500 text-black", isMissing: true, canRender: false };
    case "temporarily_unavailable":
      return { status, label: "Unavailable", description: `${semanticName} is temporarily unavailable. Retry the backend connection without changing the project.`, action: "verify", actionLabel: "Retry connection", className: "border-amber-300/60 bg-amber-950/90 text-amber-100", isMissing: false, canRender: false };
    case "unauthorized":
      return { status, label: "Access required", description: `${semanticName} could not be verified because media access was denied. Restore access, then retry.`, action: "verify", actionLabel: "Retry access", className: "border-orange-300/60 bg-orange-950/90 text-orange-100", isMissing: false, canRender: false };
    case "decode_error":
      return { status, label: "Decode error", description: `${semanticName} could not be decoded. Verify the stored original again before replacing it.`, action: "verify", actionLabel: "Verify again", className: "border-red-300/60 bg-red-950/90 text-red-100", isMissing: false, canRender: false };
    case "verifying":
      return { status, label: "Verifying", description: `${semanticName} is being verified. It has not been classified as missing.`, action: "verify", actionLabel: "Verify now", className: "border-blue-300/60 bg-blue-950/90 text-blue-100", isMissing: false, canRender: false };
    case "unrealized":
      return { status, label: "Unrealized", description: `${semanticName} has not been rendered yet. Check its generation status without changing the project.`, action: "verify", actionLabel: "Check status", className: "border-zinc-400/60 bg-zinc-800/95 text-zinc-100", isMissing: false, canRender: false };
    case "pending":
      return { status, label: "Pending", description: `${semanticName} is still being prepared. Check its status without changing the project.`, action: "verify", actionLabel: "Check status", className: "border-blue-300/60 bg-blue-950/90 text-blue-100", isMissing: false, canRender: false };
    case "error":
      return { status, label: "Error", description: `${semanticName} reported an error. Verify its stored state before replacing the original.`, action: "verify", actionLabel: "Verify again", className: "border-red-300/60 bg-red-950/90 text-red-100", isMissing: false, canRender: false };
  }
}

export function useMediaAvailabilityView(
  projectId: string,
  item: MediaItem | undefined,
  mediaId = item?.id ?? "",
): MediaAvailabilityView {
  const subscribe = useCallback(
    (notify: () => void) => mediaAvailabilityRuntime.subscribe((snapshot) => {
      if (snapshot.projectId === projectId) notify();
    }),
    [projectId],
  );
  const getSnapshot = useCallback(
    () => mediaAvailabilityRuntime.get(projectId, mediaId)?.status,
    [projectId, mediaId],
  );
  const runtimeStatus = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selectMediaAvailabilityView(item, runtimeStatus);
}

export function useMediaAvailabilityVersion(projectId: string): number {
  const subscribe = useCallback(
    (notify: () => void) => mediaAvailabilityRuntime.subscribe((snapshot) => {
      if (snapshot.projectId === projectId) notify();
    }),
    [projectId],
  );
  const getSnapshot = useCallback(
    () => mediaAvailabilityRuntime.getGeneration(projectId),
    [projectId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
