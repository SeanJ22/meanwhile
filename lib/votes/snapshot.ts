import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  mayUseTestFixture,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import type { BillSummariesFile } from "./bill-summaries.ts";
import {
  FEDERAL_ROLLCALL_SCOPE,
  FEDERAL_VOTES_SOURCE_ID,
  type FederalRollCallsReadModel,
} from "./data-plane.ts";
import type { VotesSnapshot } from "./types.ts";

let cache: FederalRollCallsReadModel | null = null;
let readState: CivicDataReadResult<FederalRollCallsReadModel> = civicDataReadNotInitialized(
  "FEDERAL_ROLL_CALL",
  FEDERAL_ROLLCALL_SCOPE,
  "The federal roll-call canonical pointer has not been read for this process.",
);

function validateProjection(value: FederalRollCallsReadModel, versionId: string): void {
  if (
    value.formatVersion !== 1 ||
    value.snapshot?.congress <= 0 ||
    value.snapshot?.session <= 0 ||
    !Array.isArray(value.snapshot?.votes) ||
    !Array.isArray(value.snapshot?.positions) ||
    !value.billSummaries ||
    typeof value.billSummaries.summaries !== "object" ||
    !Array.isArray(value.billSummaries.pending)
  ) {
    throw new Error(`Federal roll-call projection ${versionId} does not satisfy the Reader contract.`);
  }
}

/** Exact frozen-Git payload and provenance for one explicit durable first-seed import. */
export function federalRollCallsFirstSeed(): CivicDataBootstrap<FederalRollCallsReadModel> {
  const snapshot = JSON.parse(readFileSync(join(process.cwd(), "data", "votes", "votes-snapshot.json"), "utf8")) as VotesSnapshot;
  const billSummaries = JSON.parse(readFileSync(join(process.cwd(), "data", "votes", "bill-summaries.json"), "utf8")) as BillSummariesFile;
  const value: FederalRollCallsReadModel = { formatVersion: 1, snapshot, billSummaries };
  validateProjection(value, "bundled first seed");
  return {
    value,
    sourceId: FEDERAL_VOTES_SOURCE_ID,
    version: `${snapshot.congress}-${snapshot.session}`,
    versionId: `bootstrap:FEDERAL_ROLL_CALL:${snapshot.congress}-${snapshot.session}:${snapshot.generatedAt}`,
    sourceThrough: snapshot.votes.map((vote) => vote.retrievedAt || vote.date).sort().at(-1) ?? snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    detail: "The canonical federal roll-call store answered with no pointer; serving the bundled first-seed projection explicitly.",
  };
}

/**
 * Resolve the immutable bill-summary input used while acquiring a new roll
 * window. An answered absent pointer is the one lawful first-seed case: the
 * summaries are reviewed supporting input, not a claim that the tracked vote
 * snapshot is already live. A configured-store failure remains a failure and
 * must never be converted into a bundled fallback.
 */
export function billSummariesForRollCallAcquisition(
  current: CivicDataReadResult<FederalRollCallsReadModel>,
): BillSummariesFile {
  if (current.kind === "PROMOTED" || current.kind === "BOOTSTRAP") {
    return current.value.billSummaries;
  }
  if (current.kind === "NOT_RECORDED") {
    return federalRollCallsFirstSeed().value.billSummaries;
  }
  throw new CivicDataStoreUnavailableError(current);
}

/** A store error is returned verbatim and never opens the bundled seed. */
export async function readFederalRollCallsProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalRollCallsReadModel>> {
  const result = await readPromotedOrBootstrap({
    ...options,
    recordClass: "FEDERAL_ROLL_CALL",
    scope: FEDERAL_ROLLCALL_SCOPE,
    bootstrap: federalRollCallsFirstSeed,
    allowUnconfiguredBootstrap: process.env.NODE_ENV === "development" || mayUseTestFixture(),
  });
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateProjection(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

export async function refreshFederalVotesFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const result = await readFederalRollCallsProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

export function federalRollCallsReadState(): CivicDataReadResult<FederalRollCallsReadModel> {
  return readState;
}

export function getFederalVotesReadModel(): FederalRollCallsReadModel {
  if (!cache) throw new Error(`Federal roll calls are ${readState.kind}; call readFederalRollCallsProjection before using the synchronous projection.`);
  return cache;
}

export function getVotesSnapshot(): VotesSnapshot {
  return getFederalVotesReadModel().snapshot;
}

export function getVoteIds(): Set<string> {
  const ids = new Set(getVotesSnapshot().votes.map((vote) => vote.id));
  if (ids.size === 0) throw new Error("Federal vote target set is empty — refusing to validate against nothing.");
  return ids;
}
