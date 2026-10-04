import { createHash } from "node:crypto";

import type { SourceSnapshot, StatementCorpus } from "./types.ts";

export const STATEMENT_IDENTITY_FIRST_SEED_FROZEN_BASE_SHA = "fc67e8cd34c489590c403f7b4a0d6008fa755296";
export const STATEMENT_IDENTITY_FIRST_SEED_SOURCE_SHA256 = "cb3d81396a3979e25077b151ac4290d5332a9c6c19f75052dbcf1a1d45b73423";
export const STATEMENT_IDENTITY_FIRST_SEED_ROWS_SHA256 = "ed7cf856ae9dca0088e22a7aadf0599ef7c3d7a2d685f9fb1e1deb5ef864229d";

/**
 * The immutable, reviewed first-seed bridge used to move historical statement
 * snapshots off retired intermediary person ids. It is not a routine writer
 * or authority: production receives the resulting projection through the
 * one-time PDC import, while tests/development may construct the same first
 * seed when the canonical store explicitly has no promoted pointer.
 */
export interface StatementIdentityTransferBridge {
  readonly formatVersion: 1;
  readonly rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE";
  readonly rows: readonly {
    readonly holder: {
      readonly id: string;
      readonly name: string;
    };
    readonly status: "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED";
    readonly candidacy: {
      readonly candidacyId: string;
    } | null;
    readonly reason: string;
  }[];
}

/** Full frozen bridge shape retained for the one-time importer. */
export interface LegacyOfficialCandidaciesFile {
  readonly formatVersion: 1;
  readonly rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE";
  readonly sources: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly rows: readonly {
    readonly holder: {
      readonly id: string;
      readonly name: string;
      readonly officeTitle: string;
      readonly divisions: readonly string[];
      readonly sourcePath: string;
      readonly sourceUrl: string | null;
    };
    readonly status: "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED";
    readonly candidacy: {
      readonly candidacyId: string;
      readonly contestId: string;
      readonly contestTitle: string;
      readonly divisionId: string;
      readonly electionId: string;
      readonly candidateName: string;
      readonly sourceUrl: string;
      readonly sourcePath?: string;
    } | null;
    readonly reason: string;
    readonly unresolvedCandidacyIds: readonly string[];
  }[];
}

/**
 * A frozen migration fact, never a live identity authority. The full reviewed
 * bridge remains available to the one-time importer at the frozen Git base;
 * this minimized projection keeps only the twelve exact dispositions needed
 * to reproduce the statement first seed after the legacy bridge is deleted.
 */
export interface StatementIdentityFirstSeedEvidence extends StatementIdentityTransferBridge {
  readonly classification: "IMMUTABLE_STATEMENT_IDENTITY_TRANSFER_EVIDENCE";
  readonly productionAuthority: false;
  readonly use: string;
  readonly frozenSource: {
    readonly commitSha: string;
    readonly path: "lib/funding/official-candidacies.json";
    readonly sha256: string;
    readonly selectedRowsSha256: string;
  };
}

export interface TrustedLkgStatementIdentityRekey {
  readonly fromSnapshotId: string;
  readonly fromSubjectId: string;
  readonly toSnapshotId: string;
  readonly toSubjectId: string;
  readonly basis: "EXACT_FROZEN_OFFICIAL_CANDIDACY_BRIDGE";
}

export interface TrustedLkgStatementExcludedFact {
  readonly key: string;
  readonly code: "TRUSTED_LKG_STATEMENT_PERMANENT_IDENTITY_UNRESOLVED";
  readonly detail: string;
  readonly record: SourceSnapshot;
}

export interface TrustedLkgStatementIdentityTransfer {
  readonly corpus: StatementCorpus;
  readonly rekeyed: readonly TrustedLkgStatementIdentityRekey[];
  readonly excludedFacts: readonly TrustedLkgStatementExcludedFact[];
}

function permanentReaderIdentity(id: string): boolean {
  // A Plural id is a state legislator's Open States identity; a statement
  // keyed only to one is not yet keyed to a permanent registry person.
  return !id.startsWith("plural:");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

export function validateStatementIdentityFirstSeedEvidence(
  evidence: StatementIdentityFirstSeedEvidence,
): void {
  if (
    evidence.formatVersion !== 1 ||
    evidence.rule !== "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE" ||
    evidence.classification !== "IMMUTABLE_STATEMENT_IDENTITY_TRANSFER_EVIDENCE" ||
    evidence.productionAuthority !== false ||
    evidence.frozenSource.commitSha !== STATEMENT_IDENTITY_FIRST_SEED_FROZEN_BASE_SHA ||
    evidence.frozenSource.path !== "lib/funding/official-candidacies.json" ||
    evidence.frozenSource.sha256 !== STATEMENT_IDENTITY_FIRST_SEED_SOURCE_SHA256 ||
    evidence.frozenSource.selectedRowsSha256 !== STATEMENT_IDENTITY_FIRST_SEED_ROWS_SHA256
  ) {
    throw new Error("STATEMENT_IDENTITY_FIRST_SEED_PROVENANCE_INVALID");
  }
  const actualRowsSha256 = createHash("sha256").update(canonical(evidence.rows)).digest("hex");
  if (actualRowsSha256 !== STATEMENT_IDENTITY_FIRST_SEED_ROWS_SHA256) {
    throw new Error("STATEMENT_IDENTITY_FIRST_SEED_ROWS_INVALID");
  }
  if (
    evidence.rows.length !== 12 ||
    new Set(evidence.rows.map(({ holder }) => holder.id)).size !== evidence.rows.length ||
    evidence.rows.filter(({ status, candidacy }) => status === "RESOLVED" && candidacy !== null).length !== 9 ||
    evidence.rows.filter(({ status, candidacy }) => status === "NO_APPLICABLE_CANDIDACY" && candidacy === null).length !== 3
  ) {
    throw new Error("STATEMENT_IDENTITY_FIRST_SEED_DENOMINATOR_INVALID");
  }
}

/**
 * Move only identities established by the frozen, reviewed person/candidacy
 * bridge. The retired Plural id never survives into the Reader, while a fact
 * without one exact permanent identity remains exact held evidence instead of
 * disappearing or being attached by name.
 */
export function transferFrozenStatementIdentities(
  frozen: StatementCorpus,
  legacy: StatementIdentityTransferBridge,
): TrustedLkgStatementIdentityTransfer {
  const originalIds = frozen.snapshots.map(({ id }) => id);
  if (originalIds.some((id) => !id) || new Set(originalIds).size !== originalIds.length) {
    throw new Error("TRUSTED_LKG_STATEMENT_SOURCE_IDS_INVALID");
  }

  const snapshots: SourceSnapshot[] = [];
  const rekeyed: TrustedLkgStatementIdentityRekey[] = [];
  const excludedFacts: TrustedLkgStatementExcludedFact[] = [];
  for (const snapshot of frozen.snapshots) {
    if (snapshot.id !== `${snapshot.subjectId}|${snapshot.url}|${snapshot.contentHash}`) {
      throw new Error(`TRUSTED_LKG_STATEMENT_SOURCE_ID_INVALID:${snapshot.id}`);
    }
    if (permanentReaderIdentity(snapshot.subjectId)) {
      snapshots.push(structuredClone(snapshot));
      continue;
    }

    const bridgeRows = legacy.rows.filter((row) => row.holder.id === snapshot.subjectId);
    const bridge = bridgeRows.length === 1 ? bridgeRows[0] : undefined;
    if (bridge === undefined) {
      excludedFacts.push({
        key: `statement:${snapshot.id}`,
        code: "TRUSTED_LKG_STATEMENT_PERMANENT_IDENTITY_UNRESOLVED",
        detail:
          `Frozen statement ${snapshot.id} remains held because expected one exact frozen bridge row, found ${bridgeRows.length}. ` +
          "No current Reader identity was invented from a name or retired intermediary id.",
        record: structuredClone(snapshot),
      });
      continue;
    }

    const identityIssue = bridge.holder.name !== snapshot.subjectName
      ? `bridge holder name ${JSON.stringify(bridge.holder.name)} does not equal snapshot name ${JSON.stringify(snapshot.subjectName)}`
      : bridge.status !== "RESOLVED" || bridge.candidacy === null
        ? `frozen bridge disposition is ${bridge.status}: ${bridge.reason}`
        : null;
    if (identityIssue !== null || bridge.candidacy === null) {
      excludedFacts.push({
        key: `statement:${snapshot.id}`,
        code: "TRUSTED_LKG_STATEMENT_PERMANENT_IDENTITY_UNRESOLVED",
        detail:
          `Frozen statement ${snapshot.id} remains held because ${identityIssue ?? "the frozen bridge has no candidacy"}. ` +
          "No current Reader identity was invented from a name or retired intermediary id.",
        record: structuredClone(snapshot),
      });
      continue;
    }

    const toSubjectId = bridge.candidacy.candidacyId;
    if (!permanentReaderIdentity(toSubjectId)) {
      throw new Error(`TRUSTED_LKG_STATEMENT_TARGET_IDENTITY_RETIRED:${snapshot.id}:${toSubjectId}`);
    }
    const toSnapshotId = `${toSubjectId}|${snapshot.url}|${snapshot.contentHash}`;
    snapshots.push({ ...structuredClone(snapshot), id: toSnapshotId, subjectId: toSubjectId });
    rekeyed.push({
      fromSnapshotId: snapshot.id,
      fromSubjectId: snapshot.subjectId,
      toSnapshotId,
      toSubjectId,
      basis: "EXACT_FROZEN_OFFICIAL_CANDIDACY_BRIDGE",
    });
  }

  const servingIds = snapshots.map(({ id }) => id);
  if (new Set(servingIds).size !== servingIds.length) {
    throw new Error("TRUSTED_LKG_STATEMENT_REKEY_COLLISION");
  }
  if (snapshots.length + excludedFacts.length !== frozen.snapshots.length) {
    throw new Error("TRUSTED_LKG_STATEMENT_DISPOSITION_MISMATCH");
  }
  return { corpus: { snapshots }, rekeyed, excludedFacts };
}
