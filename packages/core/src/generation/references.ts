export type ReferenceRoleByKey = Readonly<Record<string, string>>;

export interface GeneratedImageDraft {
  readonly provider?: string;
  readonly modelId?: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly roleByReferenceKey: ReferenceRoleByKey;
  readonly inputs: Readonly<Record<string, unknown>>;
}

export interface GeneratedImageDefinition {
  readonly id: string;
  readonly projectId: string;
  readonly assetGroupId: string;
  readonly currentMediaVersionId?: string;
  readonly sourceMediaVersionId?: string;
  readonly title: string;
  readonly draft: GeneratedImageDraft;
  readonly attemptIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReferenceOrigin = "source" | "character" | "prompt-media" | "shot";

export type ReferenceStatus =
  | "active"
  | "unresolved"
  | "ambiguous"
  | "unavailable"
  | "unsupported"
  | "overflow"
  | "cyclic";

export interface ResolvedGenerationReference {
  readonly key: string;
  readonly mediaId: string;
  readonly mediaVersionId: string;
  readonly origins: readonly ReferenceOrigin[];
  readonly role: string;
  readonly canonicalTokens: readonly string[];
  readonly order: number;
  readonly status: ReferenceStatus;
  readonly reason?: string;
}

export interface PromptReferenceDiagnostic {
  readonly code: Exclude<ReferenceStatus, "active"> | "malformed-token";
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly blocking: boolean;
}

export type ReferenceTarget =
  | { kind: "character"; id: string }
  | { kind: "imported-image"; mediaId: string }
  | { kind: "generated-image"; definitionId: string }
  | { kind: "missing"; token: string };
