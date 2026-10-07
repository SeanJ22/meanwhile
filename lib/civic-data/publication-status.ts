/**
 * Trusts the pointer and the readback event as recorded and re-hashes no payload. No pointer is NOT_PUBLISHED; a
 * published version with no readback event is PUBLISHED_NOT_READ_BACK. Neither becomes a zero or a pass.
 */
import { parseReaderProjectionReadback } from "./reader-readback.ts";

export interface PublicationContract {
  readonly id: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  /** Null when the contract has no Reader projection: publication is its last stage. */
  readonly readerProjection: unknown | null;
}

export interface PublicationStatusRows {
  readonly promotions: readonly {
    readonly key: string;
    readonly sourceId: string;
    readonly recordClass: string;
    readonly scope: string;
    readonly currentVersionId: string;
    readonly promotedAt: string;
  }[];
  readonly latestAttempts: readonly {
    readonly candidateId: string;
    readonly sourceId: string;
    readonly recordClass: string;
    readonly scope: string;
    readonly state: string;
    readonly attemptedAt: string;
    readonly failureCode: string | null;
  }[];
  readonly readbacks: readonly { readonly candidateId: string; readonly at: string; readonly detail: string }[];
}

export type PublicationVerdict =
  | "READER_VISIBLE"
  | "READBACK_FAILED"
  | "PUBLISHED_NOT_READ_BACK"
  | "PUBLISHED_NO_READER_SURFACE"
  | "NOT_PUBLISHED";

export const PUBLICATION_VERDICTS: readonly PublicationVerdict[] = [
  "READER_VISIBLE",
  "READBACK_FAILED",
  "PUBLISHED_NOT_READ_BACK",
  "PUBLISHED_NO_READER_SURFACE",
  "NOT_PUBLISHED",
];

export interface ContractPublication {
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly published: { readonly versionId: string; readonly promotedAt: string } | null;
  readonly readback: { readonly status: "PASS" | "FAIL"; readonly at: string; readonly versionId: string } | null;
  readonly latestAttempt: {
    readonly candidateId: string;
    readonly state: string;
    readonly attemptedAt: string;
    readonly failureCode: string | null;
  } | null;
  readonly verdict: PublicationVerdict;
  readonly says: string;
}

export type PublicationStatusRead =
  | { readonly kind: "HELD"; readonly asOf: string; readonly view: PublicationStatusView }
  | { readonly kind: "NOT_CONNECTED" | "STORE_UNREACHABLE"; readonly detail: string };

export interface PublicationStatusView {
  readonly contracts: readonly ContractPublication[];
  readonly counts: Readonly<Record<PublicationVerdict, number>>;
  readonly latestAttemptFailing: number;
}

function latestBy<T>(rows: readonly T[], at: (row: T) => string): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null || Date.parse(at(row)) > Date.parse(at(best))) best = row;
  }
  return best;
}

export function projectPublicationStatus(
  contracts: readonly PublicationContract[],
  rows: PublicationStatusRows,
): PublicationStatusView {
  const projected = contracts.map((contract): ContractPublication => {
    const pointer = rows.promotions.find((p) =>
      p.recordClass === contract.recordClass && p.scope === contract.scope && p.sourceId === contract.sourceId,
    ) ?? null;
    const attempt = rows.latestAttempts.find((a) =>
      a.sourceId === contract.sourceId && a.recordClass === contract.recordClass && a.scope === contract.scope,
    ) ?? null;
    const latestAttempt = attempt === null
      ? null
      : { candidateId: attempt.candidateId, state: attempt.state, attemptedAt: attempt.attemptedAt, failureCode: attempt.failureCode };
    const base = { contractId: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope, latestAttempt };
    if (pointer === null) {
      return {
        ...base,
        published: null,
        readback: null,
        verdict: "NOT_PUBLISHED",
        says: "No promotion pointer names this contract, so nothing from it is published.",
      };
    }
    const published = { versionId: pointer.currentVersionId, promotedAt: pointer.promotedAt };
    if (contract.readerProjection === null) {
      return {
        ...base,
        published,
        readback: null,
        verdict: "PUBLISHED_NO_READER_SURFACE",
        says: `Version ${published.versionId} is published; this contract has no Reader projection, so publication is its last stage.`,
      };
    }
    const receipts = rows.readbacks
      .filter((event) => event.candidateId === pointer.currentVersionId)
      .flatMap((event) => {
        const receipt = parseReaderProjectionReadback(event.detail);
        return receipt !== null && receipt.versionId === pointer.currentVersionId && receipt.contractId === contract.id
          ? [{ status: receipt.status, at: event.at, versionId: receipt.versionId }]
          : [];
      });
    const readback = latestBy(receipts, (r) => r.at);
    if (readback === null) {
      return {
        ...base,
        published,
        readback: null,
        verdict: "PUBLISHED_NOT_READ_BACK",
        says: `Version ${published.versionId} is published, but no typed Reader readback of that exact version is recorded.`,
      };
    }
    return readback.status === "PASS"
      ? {
          ...base,
          published,
          readback,
          verdict: "READER_VISIBLE",
          says: `Version ${published.versionId} is published and the typed Reader read it back at ${readback.at}.`,
        }
      : {
          ...base,
          published,
          readback,
          verdict: "READBACK_FAILED",
          says: `Version ${published.versionId} is published, but the typed Reader readback of it failed at ${readback.at}.`,
        };
  });
  const counts = Object.fromEntries(PUBLICATION_VERDICTS.map((verdict) => [verdict, 0])) as Record<PublicationVerdict, number>;
  for (const row of projected) counts[row.verdict] += 1;
  return {
    contracts: projected,
    counts,
    latestAttemptFailing: projected.filter((row) => row.latestAttempt?.failureCode != null).length,
  };
}
