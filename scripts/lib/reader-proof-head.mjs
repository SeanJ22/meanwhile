const EXACT_HEAD = /^[0-9a-f]{40}$/;

function parsedEvidence(readEvidence, path) {
  return JSON.parse(readEvidence(path).toString("utf8"));
}

/**
 * Resolve the exact code head proved by a Reader closure receipt.
 *
 * Documentary/inherited receipts retain their established invalidation-report
 * authority. A fresh receipt has no inheritance report, so every applicable
 * census row must independently name the same exact executed head.
 */
export function readerProofHead(receipt, readEvidence) {
  if (receipt?.inheritance) {
    const reportPath = receipt.inheritance.reportPath;
    if (typeof reportPath !== "string" || !reportPath) {
      throw new Error("The reader closure receipt does not name an inheritance report.");
    }
    const readerHead = parsedEvidence(readEvidence, reportPath).currentReaderHead;
    if (!EXACT_HEAD.test(readerHead ?? "")) {
      throw new Error("The reader closure receipt does not name an exact executed head.");
    }
    return readerHead;
  }

  if (typeof receipt?.censusPath !== "string" || !receipt.censusPath) {
    throw new Error("The fresh reader closure receipt does not name its census.");
  }
  const census = parsedEvidence(readEvidence, receipt.censusPath);
  if (!Array.isArray(census.rows)) {
    throw new Error("The fresh reader closure census does not contain rows.");
  }

  const applicableRows = census.rows.filter((row) => {
    const ids = row?.applicableEligibleRecordIds ?? row?.eligibleRecordIds;
    return Array.isArray(ids) && ids.length > 0;
  });
  if (!applicableRows.length) {
    throw new Error("The fresh reader closure census has no applicable rows.");
  }

  const heads = new Set();
  for (const row of applicableRows) {
    if (!EXACT_HEAD.test(row?.provedHead ?? "")) {
      throw new Error(`Applicable reader census row ${row?.id ?? "<unknown>"} does not name an exact executed head.`);
    }
    heads.add(row.provedHead);
  }
  if (heads.size !== 1) {
    throw new Error("The fresh reader closure census combines multiple executed heads.");
  }
  return [...heads][0];
}
