import { FEC_CONTRACT, FEC_SCOPE, holdFundingRead, validateFundingSnapshot } from "./snapshot.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FundingSnapshot } from "./types.ts";
import { promotedVersionOrThrow, readPromotedOrBootstrap, type CivicDataBootstrap, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { routineFreshnessMs } from "../civic-data/contracts.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";

function fundingBootstrap(): CivicDataBootstrap<FundingSnapshot> {
  const tracked = JSON.parse(
    readFileSync(join(process.cwd(), "data", "fec", "fec-2026.json"), "utf8"),
  ) as FundingSnapshot;
  validateFundingSnapshot(tracked, "bundled bootstrap");
  const heldAbsenceCount = tracked.absences.length;
  const value: FundingSnapshot = {
    ...tracked,
    // The frozen rows cannot prove an absence; never revive them as Reader authority.
    absences: [],
  };
  const sourceThrough = value.candidates
    .map((candidate) => candidate.totals.coverageEndDate ?? "")
    .sort()
    .at(-1) || String(value.cycle);
  return {
    value,
    sourceId: FEC_CONTRACT.sourceId,
    version: String(value.cycle),
    versionId: `bootstrap:fec:${value.fetchedAt}`,
    sourceThrough,
    retrievedAt: value.fetchedAt,
    staleAtRetrieval: false,
    detail:
      `Bundled FEC bootstrap selected only because the canonical store answered with no promoted pointer; ` +
      `${heldAbsenceCount} frozen absence rows are withheld because this projection does not claim their authority.`,
  };
}

/** Typed FEC read outcome; a store failure never opens the bootstrap file. */
export async function readFundingSnapshot(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FundingSnapshot>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedOrBootstrap({
    ...options,
    now,
    recordClass: "FEC_FUNDING",
    scope: FEC_SCOPE,
    maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(FEC_CONTRACT.id, now),
    bootstrap: fundingBootstrap,
    allowUnconfiguredBootstrap: process.env.NODE_ENV !== "production",
  });
  holdFundingRead(result);
  return result;
}

/** Compatibility return for existing request preloads and live acceptance. */
export async function refreshFundingFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readFundingSnapshot(options));
}

/** The FEC read, edge first: the reader edge's proven copy through this Reader, else the database. */
export const settleFundingSnapshotRead = (): Promise<CivicDataReadResult<FundingSnapshot>> =>
  readPromotedEdgeFirst("FEC_FUNDING", FEC_SCOPE, readFundingSnapshot, "The FEC funding");

/** The FEC preload, edge first. */
export const settleFundingRead = async (): Promise<string | null> => promotedVersionOrThrow(await settleFundingSnapshotRead());
