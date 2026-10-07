/**
 * PRL ingestion: acquire one dataset (or all), land its rows in object storage,
 * precompute the per-official percentages, and write the receipt beside them.
 *
 * The receipt's high-water mark is the restartable cursor: a run takes only
 * rows newer than its mark (capped at now, so a future-dated row never advances
 * it). Writes to object storage only: the Neon storage bucket when
 * `PRL_ARCHIVE_S3_*` is set, else the durable local store.
 *
 * @freshness-reads-here — the receipt's retrieval time is captured when the
 * archive body is decoded.
 */
import { prlIngestibleDatasets, requiredPrlDataset, type PrlDataset } from "../lib/sources/prl/inventory.ts";
import { openPrlSource } from "../lib/sources/prl/fetch-source.ts";
import { ingestDataset } from "../lib/sources/prl/ingest.ts";
import { resolvePrlArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import { readReceipt, writeReceipt } from "../lib/sources/prl/holding.ts";
import { prlReceiptViolations } from "../lib/sources/prl/receipt.ts";

const args = process.argv.slice(2);
const datasetArg = args.find((arg) => arg.startsWith("--dataset="))?.slice("--dataset=".length);
const all = args.includes("--all");
if (!datasetArg && !all) {
  throw new Error("PRL refresh requires --dataset=<id> or --all.");
}

const datasets: readonly PrlDataset[] = all
  ? prlIngestibleDatasets().filter((dataset) => dataset.target !== "reference")
  : [requiredPrlDataset(datasetArg!)];

async function refresh(dataset: PrlDataset): Promise<boolean> {
  if (dataset.target === "reference") {
    console.log(`PRL ${dataset.id}: committed reference dictionary; nothing to fetch.`);
    return true;
  }
  const archive = resolvePrlArchiveStore();
  const now = Date.now();
  const prior = await readReceipt(archive, dataset.id);
  const receipt = await ingestDataset({
    dataset,
    archive,
    now,
    priorReceipt: prior,
    open: () => openPrlSource(dataset),
  });
  const violations = prlReceiptViolations(receipt);
  if (violations[0]) {
    console.error(`PRL ${dataset.id} FAILED validation: ${violations.join("; ")}`);
    return false;
  }
  await writeReceipt(archive, receipt);
  console.log(
    `PRL ${dataset.id}: ${receipt.rowsSeen} rows seen; ${receipt.rowsWritten} written; ` +
    `${receipt.rowsAfterNow} future-dated; store ${archive.kind}; ` +
    `mark ${receipt.highWaterMark ?? "none"}; profiles ${receipt.profileKind ?? "none"}`,
  );
  return true;
}

let failed = 0;
for (const dataset of datasets) {
  try {
    if (!(await refresh(dataset))) failed += 1;
  } catch (error) {
    failed += 1;
    console.error(`PRL ${dataset.id} FAILED: ${error instanceof Error ? error.message : String(error)}`);
    // A failure at one dataset never blocks the others; each receipt is its own restart point.
  }
}
if (failed > 0) process.exitCode = 2;
