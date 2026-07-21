import type {
  GenerationJob,
  GenerationRouteIdentity,
  JsonValue,
} from "@openreel/music-video-domain/generation";
import { deriveWaveSpeedFieldMap } from "../../../../../packages/core/src/generation/wavespeed";
import type {
  GenerationProviderInputMaterializer,
  GenerationRouteManifestEntry,
} from "../generation/index.js";
import type { UploadLease, UploadRecord, UploadRepository } from "../generation/uploads.js";
import {
  assertWaveSpeedMediaUrl,
  assertWaveSpeedProviderInputSafety,
} from "./input-safety.js";

export interface WaveSpeedMediaUploadPort {
  uploadMedia(input: { bytes: Uint8Array; mimeType: string }): Promise<string>;
}

interface PreparedUpload {
  readonly bytes: Uint8Array;
  readonly record: UploadRecord;
}

const identityKeys: readonly (keyof GenerationRouteIdentity)[] = [
  "providerInstanceId",
  "providerModelId",
  "requestedMode",
  "providerSchemaId",
  "providerEndpointId",
  "providerSchemaVersion",
];

function sameRoute(left: GenerationRouteIdentity, right: GenerationRouteIdentity): boolean {
  return identityKeys.every((key) => left[key] === right[key]);
}

function declaredMediaValues(value: JsonValue, uploadIds: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("upl_")) uploadIds.add(value);
    else assertWaveSpeedMediaUrl(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) declaredMediaValues(item, uploadIds);
    return;
  }
  throw new Error("wavespeed-input-media-unreachable");
}

function replaceUploads(value: JsonValue, materialized: ReadonlyMap<string, string>): JsonValue {
  if (typeof value === "string") return materialized.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceUploads(item, materialized));
  return value;
}

export class WaveSpeedInputMaterializer implements GenerationProviderInputMaterializer {
  constructor(private readonly options: {
    uploads: UploadRepository;
    routes: readonly GenerationRouteManifestEntry[];
    mediaUpload: WaveSpeedMediaUploadPort;
  }) {}

  async materialize(input: {
    ownerId: string;
    job: GenerationJob;
    attemptNumber: number;
  }): Promise<Record<string, JsonValue>> {
    if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1) {
      throw new Error("generation-attempt-invalid");
    }
    const route = this.options.routes.find((candidate) => sameRoute(candidate.identity, input.job.routing));
    if (!route?.inputSchema) throw new Error("generation-route-unsupported");
    const fields = deriveWaveSpeedFieldMap(route.inputSchema);
    const declaredFields = [fields.sourceImage, fields.referenceImages, fields.audio]
      .filter((field): field is string => Boolean(field));
    const providerInputs = { ...input.job.providerInputs };
    const uploadIds = new Set<string>();
    for (const field of declaredFields) {
      const value = providerInputs[field];
      if (value !== undefined) declaredMediaValues(value, uploadIds);
    }

    const prepared = new Map<string, PreparedUpload>();
    for (const uploadId of uploadIds) {
      const record = await this.options.uploads.get(uploadId, input.ownerId, input.job.projectId);
      if (!record) throw new Error("generation-upload-not-found");
      const bytes = await this.options.uploads.bytes(uploadId, input.ownerId, input.job.projectId);
      if (!bytes) throw new Error("generation-upload-not-found");
      if (bytes.byteLength !== record.byteLength) throw new Error("generation-upload-byte-length-mismatch");
      prepared.set(uploadId, { bytes, record });
    }

    const leases: UploadLease[] = [];
    try {
      for (const uploadId of uploadIds) {
        leases.push(await this.options.uploads.lease(uploadId, input.ownerId, input.job.projectId));
      }
      const materialized = new Map<string, string>();
      for (const [uploadId, upload] of prepared) {
        const url = await this.options.mediaUpload.uploadMedia({
          bytes: upload.bytes,
          mimeType: upload.record.mimeType,
        });
        assertWaveSpeedMediaUrl(url);
        materialized.set(uploadId, url);
      }
      for (const field of declaredFields) {
        const value = providerInputs[field];
        if (value !== undefined) providerInputs[field] = replaceUploads(value, materialized);
      }
      assertWaveSpeedProviderInputSafety(providerInputs);
      return providerInputs;
    } catch (cause) {
      const releaseFailures: unknown[] = [];
      for (const lease of leases.reverse()) {
        try {
          await this.options.uploads.releaseLease(lease.id);
        } catch (releaseCause) {
          releaseFailures.push(releaseCause);
        }
      }
      if (releaseFailures.length > 0) {
        throw new AggregateError([cause, ...releaseFailures], "wavespeed-input-materialization-rollback-failed");
      }
      throw cause;
    }
  }
}
