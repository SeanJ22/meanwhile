import { readFileSync } from "node:fs";
import { join } from "node:path";

import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  transferFrozenStatementIdentities,
  validateStatementIdentityFirstSeedEvidence,
  type StatementIdentityFirstSeedEvidence,
  type TrustedLkgStatementIdentityTransfer,
} from "./statement-identity-transfer.ts";
import type { SourceSnapshot, StatementCorpus } from "./types.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";

const CONTRACT = requiredManualProductionContract("officeholder-statements");
export const OFFICEHOLDER_STATEMENT_SCOPE = CONTRACT.scope;
const SHA256 = /^[a-f0-9]{64}$/;

function validate(value: StatementCorpus, version: string): void {
  if (!value || !Array.isArray(value.snapshots) || value.snapshots.length === 0) {
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

/**
 * Reproduce the exact reviewed first-seed identity transfer. Documentary
 * census uses the same immutable bridge to relate the frozen source rows to
 * their permanent promoted ids; it must never infer that relation by name.
 */
export function frozenStatementIdentityTransfer(
  root: string = process.cwd(),
): TrustedLkgStatementIdentityTransfer {
  const recorded = JSON.parse(
    readFileSync(join(root, "data", "corpus", "statements.json"), "utf8"),
  ) as StatementCorpus;
  const bridge = JSON.parse(
    readFileSync(join(root, "lib", "corpus", "fixtures", "statement-identity-first-seed-v1.json"), "utf8"),
  ) as StatementIdentityFirstSeedEvidence;
  validateStatementIdentityFirstSeedEvidence(bridge);
  return transferFrozenStatementIdentities(recorded, bridge);
}

function bundledBootstrap(): CivicDataBootstrap<StatementCorpus> {
  const transfer = frozenStatementIdentityTransfer();
  const value = transfer.corpus;
  const sourceThrough = value.snapshots.map((snapshot) => snapshot.retrievedAt).sort().at(-1) ?? "";
  validate(value, "bundled bootstrap");
  return {
    value,
    sourceId: CONTRACT.sourceId,
    version: sourceThrough,
    versionId: `bootstrap:officeholder-statements:${sourceThrough}`,
    sourceThrough,
    retrievedAt: sourceThrough,
    detail:
      "Bundled immutable statement history selected only because the canonical store answered with no promoted pointer; " +
      `${transfer.rekeyed.length} snapshots use the exact reviewed permanent candidacy bridge and ${transfer.excludedFacts.length} unresolved snapshots remain held.`,
  };
}

let readState: CivicDataReadResult<StatementCorpus> = civicDataReadNotInitialized(
  CONTRACT.recordClass,
  CONTRACT.scope,
  "The officeholder statement canonical pointer has not been read for this process.",
);

/** A store failure never opens the tracked immutable first seed. */
export async function readOfficeholderStatementsProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<StatementCorpus>> {
  // Production must establish the canonical pointer. In particular, an
  // answered NOT_RECORDED result is not permission to reopen the tracked
  // history as live truth. The bundle exists only for deterministic bootstrap
  // and test work outside production.
  readState = process.env.NODE_ENV === "production"
    ? await readPromotedCivicData(CONTRACT.recordClass, CONTRACT.scope, options)
    : await readPromotedOrBootstrap({
        ...options,
        recordClass: CONTRACT.recordClass,
        scope: CONTRACT.scope,
        bootstrap: bundledBootstrap,
        allowUnconfiguredBootstrap: process.env.NODE_ENV === "development" || mayUseTestFixture(),
      });
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

/** The statement preload, edge first (2026-09-25): the reader edge's proven copy through this Reader, else the database. */
export const settleOfficeholderStatementsRead = (): Promise<string | null> =>
  readPromotedEdgeFirst(CONTRACT.recordClass, CONTRACT.scope, refreshOfficeholderStatementsFromPromoted, "The officeholder statements");

export function officeholderStatementsReadState(): CivicDataReadResult<StatementCorpus> {
  return readState;
}

export function currentOfficeholderStatements(): StatementCorpus {
  if (readState.kind === "PROMOTED" || readState.kind === "BOOTSTRAP") return readState.value;
  if (mayUseTestFixture()) {
    return bundledBootstrap().value;
  }
  throw new Error(`Officeholder statement projection is ${readState.kind}; initialize its canonical read first.`);
}
