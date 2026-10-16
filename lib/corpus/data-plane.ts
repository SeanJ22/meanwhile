import { currentReaderSelection } from "../db/reader-route.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import type { StatementCorpus } from "./types.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";

const CONTRACT = requiredManualProductionContract("officeholder-statements");
export const OFFICEHOLDER_STATEMENT_SCOPE = CONTRACT.scope;
const SHA256 = /^[a-f0-9]{64}$/;

function validate(value: StatementCorpus, version: string): void {
  if (!value || !Array.isArray(value.snapshots) || value.snapshots.length === 0 && !currentReaderSelection()) {
    throw new Error(`Officeholder statement projection ${version} has no snapshots.`);
  }
  const ids = new Set<string>();
  for (const snapshot of value.snapshots) {
    if (!snapshot.id || ids.has(snapshot.id)) throw new Error(`Officeholder statement projection ${version} has an empty or duplicate snapshot id.`);
    ids.add(snapshot.id);
    if (!snapshot.subjectId || !/^https:\/\//.test(snapshot.url) || !SHA256.test(snapshot.contentHash) || !Number.isFinite(Date.parse(snapshot.retrievedAt))) {
      throw new Error(`${snapshot.id} lacks exact subject, HTTPS source, hash, or retrieval time.`);
    }
    if (!Number.isInteger(snapshot.httpStatus) || !["ok", "failed"].includes(snapshot.extraction)) {
      throw new Error(`${snapshot.id} has no recorded HTTP/extraction outcome.`);
    }
    if (snapshot.extraction === "ok" && !snapshot.text?.trim()) {
      throw new Error(`${snapshot.id} claims successful extraction without readable text.`);
    }
  }
}

let readState: CivicDataReadResult<StatementCorpus> = civicDataReadNotInitialized(
  CONTRACT.recordClass,
  CONTRACT.scope,
  "The officeholder statement canonical pointer has not been read for this process.",
);

export async function readOfficeholderStatementsProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<StatementCorpus>> {
  readState = await readPromotedCivicData(CONTRACT.recordClass, CONTRACT.scope, options);
  if (readState.kind === "PROMOTED" || readState.kind === "BOOTSTRAP") {
    validate(readState.value, readState.metadata.versionId ?? readState.kind);
  }
  return readState;
}

export async function refreshOfficeholderStatementsFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const result = await readOfficeholderStatementsProjection(options);
  if (result.kind === "NOT_RECORDED") {
    throw new Error("The officeholder statement store answered without a canonical promoted projection.");
  }
  return promotedVersionOrThrow(result);
}

/** Reads the reader edge's copy first, else the database. */
export const settleOfficeholderStatementsRead = (): Promise<string | null> =>
  readPromotedEdgeFirst(CONTRACT.recordClass, CONTRACT.scope, refreshOfficeholderStatementsFromPromoted, "The officeholder statements");

export function officeholderStatementsReadState(): CivicDataReadResult<StatementCorpus> {
  return readState;
}

export function currentOfficeholderStatements(): StatementCorpus {
  if (readState.kind === "PROMOTED" || readState.kind === "BOOTSTRAP") return readState.value;
  throw new Error(`Officeholder statement projection is ${readState.kind}; initialize its canonical read first.`);
}
