import { PRL_DATA_BASE, type PrlDataset } from "./inventory.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "./types.ts";

/**
 * The per-dataset ingest receipt, written to the object store as
 * `<id>/state.json` beside its rows. Its high-water mark (capped at now) is
 * where the next run resumes. Profile datasets carry their precomputed
 * percentages; archives name their object keys. It does not go through the
 * civic-data promotion plane.
 */

export type PrlProfileKind = "federal" | "state" | "primary";

export interface PrlIngestReceipt {
  readonly formatVersion: 1;
  readonly datasetId: string;
  readonly scope: string;
  readonly title: string;
  readonly target: PrlDataset["target"];
  readonly sourceUrl: string;
  readonly sourceSha256: string;
  readonly member: string | null;
  readonly cursorField: "last_updated" | "date" | null;
  readonly fetchedAt: string;
  /** The high-water mark, capped at now. Never advanced by a future-dated row. */
  readonly highWaterMark: string | null;
  readonly previousMark: string | null;
  readonly rowsSeen: number;
  readonly rowsWritten: number;
  readonly rowsAfterNow: number;
  readonly rowsUnparseableCursor: number;
  readonly coverageFrom: string | null;
  readonly coverageThrough: string | null;
  readonly objectStore: "local-file" | "s3" | "none";
  /** All object keys for this dataset (cumulative across runs). */
  readonly objectKeys: readonly string[];
  /** Object keys written by this run only. */
  readonly newObjectKeys: readonly string[];
  /** Precomputed per-official percentages (profile datasets); null for archives. */
  readonly profileKind: PrlProfileKind | null;
  readonly profiles: readonly unknown[] | null;
  readonly attribution: typeof PRL_RHETORIC_ATTRIBUTION;
}

/** Deterministic receipt violations, checked before a receipt is written. */
export function prlReceiptViolations(receipt: PrlIngestReceipt): string[] {
  const problems: string[] = [];
  if (receipt.formatVersion !== 1) problems.push("PRL ingest receipt format version is invalid.");
  if (!receipt.sourceUrl.startsWith(PRL_DATA_BASE)) problems.push("PRL ingest receipt cites an unregistered dataset route.");
  if (receipt.attribution.citation !== PRL_RHETORIC_ATTRIBUTION.citation || receipt.attribution.licence !== PRL_RHETORIC_ATTRIBUTION.licence) {
    problems.push("PRL rhetoric attribution or CC BY licence condition is missing or altered.");
  }
  if (receipt.rowsWritten < 0 || receipt.rowsSeen < 0 || receipt.rowsAfterNow < 0) problems.push("PRL ingest receipt carries a negative row count.");
  if (receipt.rowsWritten > receipt.rowsSeen) problems.push("PRL ingest receipt wrote more rows than it saw.");
  if (receipt.profiles !== null && !Array.isArray(receipt.profiles)) problems.push("PRL ingest receipt carries a non-array precomputed profiles payload.");
  return [...new Set(problems)];
}
