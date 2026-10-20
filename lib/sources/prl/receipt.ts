import { PRL_DATA_BASE, prlDataset, type PrlDataset } from "./inventory.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "./types.ts";

/**
 * The per-dataset ingest receipt, written to the object store as
 * `<id>/state.json` beside its rows. Its high-water mark (capped at now) is
 * coverage metadata, never a row exclusion cursor. Completed source roots identify
 * immutable native-person objects through the existing civic-data promotion plane.
 */

export type PrlProfileKind = "federal" | "state" | "primary";

export interface PrlIngestReceipt {
  readonly formatVersion: 1;
  readonly parserVersion?: string;
  readonly sourceBytes?: number;
  readonly objectRoot?: string;
  readonly subjectCount?: number;
  readonly datasetId: string;
  readonly scope: string;
  readonly title: string;
  readonly target: PrlDataset["target"];
  readonly sourceUrl: string;
  readonly sourceFinalUrl?: string;
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
  /** Immutable object keys for this complete source release; older releases remain held as evidence. */
  readonly objectKeys: readonly string[];
  /** Object keys written by this run only. */
  readonly newObjectKeys: readonly string[];
  /** Retained source versions may carry profiles here; new releases store native-person objects. */
  readonly profileKind: PrlProfileKind | null;
  readonly profiles: readonly unknown[] | null;
  readonly attribution: typeof PRL_RHETORIC_ATTRIBUTION;
}

/** Deterministic receipt violations, checked before a receipt is written. */
export function prlReceiptViolations(receipt: PrlIngestReceipt): string[] {
  const problems: string[] = [];
  if (receipt.formatVersion !== 1) problems.push("PRL ingest receipt format version is invalid.");
  if (!receipt.sourceUrl.startsWith(PRL_DATA_BASE)) problems.push("PRL ingest receipt cites an unregistered dataset route.");
  const dataset = prlDataset(receipt.datasetId);
  if (!dataset || dataset.url !== receipt.sourceUrl || dataset.target !== receipt.target || dataset.scope !== receipt.scope) problems.push("PRL receipt does not match its native dataset identity.");
  if (!/^[a-f0-9]{64}$/.test(receipt.sourceSha256) || !Number.isFinite(Date.parse(receipt.fetchedAt))) problems.push("PRL receipt lacks exact source bytes or retrieval date.");
  if (receipt.attribution.citation !== PRL_RHETORIC_ATTRIBUTION.citation || receipt.attribution.licence !== PRL_RHETORIC_ATTRIBUTION.licence || receipt.attribution.licenceUrl !== PRL_RHETORIC_ATTRIBUTION.licenceUrl) {
    problems.push("PRL rhetoric attribution or CC BY licence condition is missing or altered.");
  }
  if ([receipt.rowsWritten, receipt.rowsSeen, receipt.rowsAfterNow].some(count => !Number.isSafeInteger(count) || count < 0)) problems.push("PRL ingest receipt carries an invalid row count.");
  if (receipt.rowsWritten > receipt.rowsSeen) problems.push("PRL ingest receipt wrote more rows than it saw.");
  if (receipt.profiles !== null && !Array.isArray(receipt.profiles)) problems.push("PRL ingest receipt carries a non-array precomputed profiles payload.");
  if (receipt.parserVersion === "prl-ingest/3" && (receipt.profiles !== null || receipt.objectKeys.length || receipt.newObjectKeys.length ||
    !receipt.objectRoot || !receipt.objectRoot.startsWith(`${receipt.datasetId}/${receipt.sourceSha256}/`) ||
    !Number.isSafeInteger(receipt.subjectCount) || (receipt.subjectCount ?? 0) <= 0)) problems.push("PRL release lacks its bounded native-person object roots.");
  return [...new Set(problems)];
}
