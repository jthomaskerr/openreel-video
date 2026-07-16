export interface ProviderReferenceFieldRole {
  readonly field: string;
  readonly cardinality: "one" | "many";
}

export interface ProviderReferenceFixture {
  readonly provider: string;
  readonly modelId: string;
  readonly evidenceUrl: string;
  readonly evidenceCapturedAt: string;
  readonly acceptedFields: readonly string[];
  readonly roles: Readonly<Record<string, ProviderReferenceFieldRole>>;
  readonly minReferences: number;
  readonly maxReferences: number;
  readonly promptTokenRule: "remove" | "preserve" | { template: string };
  readonly exampleRequest: Readonly<Record<string, unknown>>;
}

export interface UnsupportedProviderReferenceFixture {
  readonly provider: string;
  readonly modelId: string;
  readonly evidenceUrl: string;
  readonly evidenceCapturedAt: string;
  readonly supported: false;
  readonly reason: string;
}

export interface ProviderReferenceFixtureIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ProviderReferenceFixtureValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ProviderReferenceFixtureIssue[] };
