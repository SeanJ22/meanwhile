/** Source-native federal records. Geography describes where money reaches;
 * recipient links describe who received it. Those claims stay separate. */
export const FEDERAL_MONEY_SOURCES = ["usaspending", "federal-audit-clearinghouse", "sam-gov-entities", "openfema"] as const;
export type FederalMoneySource = typeof FEDERAL_MONEY_SOURCES[number];
export const FEDERAL_MONEY_RECORD_CLASS = "FEDERAL_MONEY" as const;
export const FEDERAL_MONEY_PARSER = "federal-money/1";
export function federalMoneyScope(source: FederalMoneySource, state: string) { return `${source}:${state.toUpperCase()}`; }

export interface FederalMoneyFact {
  readonly id: string;
  readonly source: FederalMoneySource;
  readonly sourceId: string;
  readonly state: string;
  readonly kind: "GRANT" | "CONTRACT" | "LOAN" | "AUDIT" | "ENTITY" | "DISASTER";
  readonly title: string;
  readonly amount: number | null;
  readonly amountLabel: string | null;
  readonly period: string | null;
  readonly recipient: string | null;
  readonly uei: string | null;
  readonly identifiers: Readonly<Record<string, string>>;
  readonly geography: readonly { readonly type: "county" | "place" | "school" | "congressional"; readonly geoid: string }[];
  readonly bodyIds: readonly string[];
  readonly divisionIds: readonly string[];
  readonly joinStatus: "JOINED" | "UNJOINED";
  readonly joinReason: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly provenance: { readonly sourceUrl: string; readonly sourceOrg: string; readonly publicationDate: string | null; readonly retrievedAt: string; readonly official: true; readonly rawHash: string };
}
export interface FederalMoneyCapture {
  readonly url: string;
  readonly body: string;
  readonly retrievedAt: string;
  readonly publicationDate: string | null;
}
export interface FederalMoneyPage {
  readonly facts: readonly FederalMoneyFact[];
  readonly captures: readonly FederalMoneyCapture[];
  readonly complete: boolean;
  readonly declaredTotal: number | null;
  /** A provider-native continuation; partial pages are published and merged by id. */
  readonly continuation?: FederalMoneyCursor | null;
}
export interface FederalMoneyCursor {
  readonly source: FederalMoneySource;
  readonly phase: string;
  readonly offset?: number;
  readonly category?: number;
  readonly location?: "performance" | "recipient";
  readonly statusUrl?: string;
  readonly fileUrl?: string;
  readonly reportIds?: readonly string[];
  readonly nextOffset?: number;
  readonly generalComplete?: boolean;
  readonly since?: string;
  readonly registered?: boolean;
  readonly year?: number;
}
export interface FederalMoneyProjection {
  readonly formatVersion: 1;
  readonly source: FederalMoneySource;
  readonly state: string;
  readonly records: readonly FederalMoneyFact[];
  readonly counts: { readonly loaded: number; readonly joined: number; readonly unjoined: number };
  readonly checkpoint?: {
    readonly cursor: FederalMoneyCursor | null;
    readonly complete: boolean;
    readonly lastCompleteAt: string | null;
    /** Inclusive update watermark: refresh from the previous pass's start,
     * so writes arriving during a paged pass are reread on the next one. */
    readonly refreshStartedAt?: string | null;
  };
}
