import { createHash } from "node:crypto";

import { authorityFor, authorityForManualReceipt, sourceAuthority } from "./source-authority.ts";
import { derivedAuthorityFor } from "./derived-door.ts";
import { MEETING_HISTORY_SCOPE_SUFFIX } from "./meeting-history-scope.ts";
import {
  MEETING_READER_SERVING_WINDOW_CONTRACT,
  MEETING_READER_SERVING_WINDOW_CONTRACT_V1,
  meetingLegacyServingWindowAt,
  meetingReaderServingWindowAt,
} from "../meetings/constants.ts";
import { trustedLkgImportEvidenceIssue } from "./trusted-lkg-import.ts";
import { manualPriorAuthorityIssue, manualPriorAuthorityOf } from "./manual-prior-authority.ts";
import { canonicalCivicDataJson, civicRecordsFor } from "./changes.ts";
import {
  occurrenceStampFromInstant,
  reissuesSitting,
  supersedesSeriesRecord,
  type ListedSittingFacts,
} from "../sources/event-identity.ts";
import { isCensusPlaceholderDivision } from "../registry/census-placeholders.ts";
import { REGISTRATION_SOURCE_LAST_MODIFIED, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL } from "../registration/publication.ts";
import type {
  CandidateDecision,
  CandidateState,
  CandidateVersionRecord,
  CensusPlaceholderBodyRemovalEvidence,
  DependentCheck,
  RoutineCandidate,
  RoutineChangeSet,
  RoutineRemovalEvidence,
  ValidationCheck,
  ValidationCheckName,
  ValidationReceipt,
} from "./types.ts";

const SHA256 = /^[a-f0-9]{64}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A 304 Not Modified carries no bytes. It is authentic only where a contract
 * pins exact bytes to the Last-Modified they were served with, and only for a
 * candidate built from exactly those bytes. Today that is registration's Census
 * of Governments file (`lib/registration/publication.ts`, bound by one full
 * read); a 304 anywhere else acquired nothing. The raw hash must be the one
 * registration builds from the pinned sha, its reference and the reviewed
 * registry version, so a 304 cannot carry another file's provenance.
 */
export function notModifiedIssue(candidate: RoutineCandidate): string | null {
  if (candidate.recordClass !== "REGISTRATION") {
    return `HTTP 304 carries no bytes, and ${candidate.recordClass} pins no bytes to a Last-Modified, so nothing was acquired.`;
  }
  if (candidate.retrieval.requestedUrl !== REGISTRATION_SOURCE_URL) {
    return `A registration 304 is bound only to ${REGISTRATION_SOURCE_URL}, not ${candidate.retrieval.requestedUrl}.`;
  }
  const payload = (candidate.normalizedPayload ?? {}) as {
    readonly sourceSha256?: unknown;
    readonly referenceSha256?: unknown;
    readonly reviewedRegistryVersionId?: unknown;
  };
  if (payload.sourceSha256 !== REGISTRATION_SOURCE_SHA256) {
    return `The 304 names source bytes ${String(payload.sourceSha256)}, not the pinned ${REGISTRATION_SOURCE_SHA256} bound to Last-Modified ${REGISTRATION_SOURCE_LAST_MODIFIED}.`;
  }
  if (candidate.retrieval.rawHash !== sha256(`${REGISTRATION_SOURCE_SHA256}\n${String(payload.referenceSha256)}\n${String(payload.reviewedRegistryVersionId)}`)) {
    return "The 304's raw hash is not the one registration builds from the pinned bytes, its reference and the reviewed registry version.";
  }
  return null;
}

function durableCanonicalJson(value: unknown): { readonly canonical: string | null; readonly issue: string | null } {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return { canonical: null, issue: "The value is not representable as durable JSON." };
    const roundTrip = JSON.parse(encoded) as unknown;
    const before = canonicalCivicDataJson(value);
    const after = canonicalCivicDataJson(roundTrip);
    if (before !== after) {
      return { canonical: null, issue: "The value changes when persisted through the canonical JSONB representation." };
    }
    return { canonical: before, issue: null };
  } catch (error) {
    return {
      canonical: null,
      issue: `The value is not durable JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function canonicalMembers(value: readonly { readonly key: string; readonly record: unknown }[]): string | null {
  const durable = durableCanonicalJson([...value].sort((left, right) => left.key.localeCompare(right.key)));
  return durable.canonical;
}

function result(check: ValidationCheckName, verdict: ValidationCheck["verdict"], code: string, detail: string): ValidationCheck {
  return { check, verdict, code, detail };
}

function jurisdictionAllowed(candidate: RoutineCandidate, allowed: readonly string[]): boolean {
  return candidate.identities.every((identity) => allowed.includes(identity.jurisdiction));
}

/**
 * **A VERSION THAT NAMES A PUBLICATION IS NOT AN ORDER.** (2026-09-24.)
 * CISA's registry is versioned by the git commit of `current-full.csv`, and two
 * commit hashes compared as strings say nothing about which came first: every
 * daily revision from 2026-09-15 to 09-24 was refused as "11fe34b4… precedes
 * promoted e68adb11…", eight upstream updates in a row, while the pointer sat on
 * the 09-15 registry. For these classes the version still has to equal the
 * expected one; which publication is newer is decided by the acquisition and
 * source-through order checked beside it, never by the hash.
 */
const UNORDERED_VERSION_CLASSES: ReadonlySet<RoutineCandidate["recordClass"]> = new Set(["DOTGOV_REFERENCE"]);

/** Worker publication editions identify audited attempts, not sortable source
 * vintages. Exact expected-version agreement and both real time-order checks
 * below still apply; random hash spelling cannot establish chronology. */
function hasOpaqueWorkerEdition(candidate: RoutineCandidate): boolean {
  return (candidate.sourceId === "registry-reviewed-bindings" && candidate.recordClass === "REGISTRY_RUNTIME_BINDING" &&
    /^worker-roster:wr-[a-f0-9]{24}$/.test(candidate.temporal.version)) ||
    (candidate.sourceId === "curated-reader-primary-sources" && candidate.recordClass === "CURATED_READER_RECORD" &&
      /^worker:wr-[a-f0-9]{24}$/.test(candidate.temporal.version));
}

function temporalOrder(value: string): number | null {
  if (/^\d{4}$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}

function firstBlocking(checks: readonly ValidationCheck[]): ValidationCheck | null {
  return checks.find((check) => check.verdict !== "PASS") ?? null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** A gap becoming an official filing is a reclassification of the same
 * candidacy, although the legacy finance member key changes from its target
 * key to the newly known committee ID. Prove that pair; an unmatched loss
 * remains an incomplete-horizon removal and must still be held. */
function stateFinanceGapResolution(candidate: RoutineCandidate): ValidationCheck | null {
  if (candidate.recordClass !== "STATE_CAMPAIGN_FINANCE" || (candidate.removalEvidence?.length ?? 0) > 0) return null;
  const removed = candidate.changeSet?.removed ?? [];
  const added = candidate.changeSet?.added ?? [];
  if (removed.length === 0) return null;
  const used = new Set<number>();
  for (const delta of removed) {
    const before = object(delta.before);
    const targets = before?.targetKeys;
    if (before?.filingState !== "OURS_GAP" || !Array.isArray(targets) || targets.length === 0 ||
      !targets.every(value => typeof value === "string" && value.length > 0)) return null;
    const exactTargets = [...targets].sort();
    const matches = added.flatMap((addition, index) => {
      const after = object(addition.after);
      const nextTargets = after?.targetKeys;
      const provenance = object(after?.provenance);
      return after?.filingState === "FILED" &&
        after.jurisdiction === before.jurisdiction && after.electionYear === before.electionYear &&
        typeof after.committeeId === "string" && after.committeeId.length > 0 &&
        (before.committeeId === null || before.committeeId === undefined || before.committeeId === after.committeeId) &&
        Array.isArray(nextTargets) && nextTargets.every(value => typeof value === "string") &&
        JSON.stringify([...nextTargets].sort()) === JSON.stringify(exactTargets) &&
        provenance?.sourceUrl === candidate.retrieval.finalUrl &&
        typeof provenance.sourceOrg === "string" && provenance.sourceOrg.length > 0
        ? [index] : [];
    });
    if (matches.length !== 1 || used.has(matches[0])) return null;
    used.add(matches[0]);
  }
  return result(
    "COMPLETENESS_HORIZON_VALIDITY", "PASS", "STATE_FINANCE_GAPS_RESOLVED_BY_OFFICIAL_FILINGS",
    `${removed.length} prior gap record(s) have exact candidacy-matched official filings in this read; no candidacy disappeared.`,
  );
}

function incompleteHorizonRemovalCheck(candidate: RoutineCandidate): ValidationCheck | null {
  const removed = candidate.changeSet?.removed ?? [];
  const evidence = candidate.removalEvidence ?? [];
  const reconciledCompleteHorizon = candidate.horizon.kind === "BOUNDED" &&
    candidate.horizon.claimsComplete &&
    candidate.horizon.paginationComplete &&
    candidate.horizon.declaredTotal === candidate.horizon.returnedRecords;

  if (removed.length === 0) {
    return evidence.length === 0
      ? null
      : result(
          "COMPLETENESS_HORIZON_VALIDITY",
          "FAIL",
          "REMOVAL_EVIDENCE_EXTRA",
          `${evidence.length} removal-evidence row(s) name no removed record.`,
        );
  }
  if (reconciledCompleteHorizon) {
    return evidence.length === 0
      ? null
      : result(
          "COMPLETENESS_HORIZON_VALIDITY",
          "FAIL",
          "REMOVAL_EVIDENCE_UNEXPECTED_FOR_COMPLETE_HORIZON",
          "A complete, reconciled bounded universe authorizes its own removals; supplemental removal evidence is not accepted.",
        );
  }

  const financeResolution = stateFinanceGapResolution(candidate);
  if (financeResolution !== null) return financeResolution;

  if (candidate.recordClass !== "MEETING" && candidate.recordClass !== "REGISTRY_RUNTIME_BINDING") {
    return result(
      "COMPLETENESS_HORIZON_VALIDITY",
      evidence.length === 0 ? "CANNOT_TELL" : "FAIL",
      evidence.length === 0 ? "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED" : "REMOVAL_EVIDENCE_UNSUPPORTED",
      `The incomplete ${candidate.horizon.kind} horizon removed ${removed.length} record(s) without a record-class removal contract.`,
    );
  }

  const removedKeys = new Set(removed.map((delta) => delta.key));
  const evidenceByKey = new Map<string, (typeof evidence)[number]>();
  for (const row of evidence) {
    if (!row || typeof row.key !== "string" || evidenceByKey.has(row.key)) {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_DUPLICATE_OR_INVALID", "Removal evidence must name each removed key exactly once.");
    }
    if (!removedKeys.has(row.key)) {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_EXTRA", `${row.key} is not an exact removed record key.`);
    }
    evidenceByKey.set(row.key, row);
  }
  const missing = removed.filter((delta) => !evidenceByKey.has(delta.key));
  if (missing.length > 0) {
    return result(
      "COMPLETENESS_HORIZON_VALIDITY",
      "CANNOT_TELL",
      "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED",
      `${missing.length}/${removed.length} removal(s) lack exact competent evidence: ${missing.slice(0, 3).map(({ key }) => key).join(", ")}.`,
    );
  }

  if (candidate.recordClass === "REGISTRY_RUNTIME_BINDING") return registryPlaceholderRemovalCheck(candidate, removed, evidenceByKey);

  // A meeting removal is proven only by a meeting's authority; the registry's placeholder code never proves one.
  const validMeetingEvidence = new Map<string, Exclude<RoutineRemovalEvidence, CensusPlaceholderBodyRemovalEvidence>>();
  const registeredWindow = meetingReaderServingWindowAt(candidate.retrieval.retrievedAt);
  // One pass after DB-01: a `V1` row (the old shown window) is still accepted.
  const legacyWindow = meetingLegacyServingWindowAt(candidate.retrieval.retrievedAt);
  let currentMembers: ReadonlyMap<string, unknown> | null = null;
  const currentMember = (key: string): unknown => {
    currentMembers ??= new Map(
      civicRecordsFor(candidate.recordClass, candidate.readModel).map((member) => [member.key, member.record]),
    );
    return currentMembers.get(key);
  };
  for (const delta of removed.filter(({ key }) => key.startsWith("meeting:"))) {
    const row = evidenceByKey.get(delta.key)!;
    if (row.code === "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT") {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} is a meeting; a registry placeholder removal cannot prove it.`);
    }
    const before = object(delta.before);
    const meetingId = typeof before?.id === "string" ? before.id : null;
    const startsAt = typeof before?.startsAt === "string" ? before.startsAt : null;
    if (row.code === "SUPERSEDED_BY_OCCURRENCE_IDENTITY") {
      /*
       * A prior record replaced by the fresh record that now holds its
       * sitting: an occurrence of its recurring series (2026-09-23,
       * `supersedesSeriesRecord`), or the same sitting its publisher re-issued
       * under a new id (2026-09-24, `reissuesSitting`). Nothing in the evidence
       * row is taken on trust: the successor is looked up among THIS
       * candidate's own members, must be a fresh row rather than a carried
       * one, and must pass the same tests the reconciliation applied, re-run
       * here on the stored records.
       */
      const successor = typeof row.successorKey === "string" ? object(currentMember(row.successorKey)) : null;
      const successorId = typeof successor?.id === "string" ? successor.id : null;
      const successorStartsAt = typeof successor?.startsAt === "string" ? successor.startsAt : null;
      const textOf = (record: Record<string, unknown> | null, field: string): string | null => {
        const value = record?.[field];
        return typeof value === "string" ? value : null;
      };
      const sittingOf = (record: Record<string, unknown> | null, id: string, at: string): ListedSittingFacts => ({
        id,
        bodyId: textOf(record, "bodyId"),
        bodyName: textOf(record, "bodyName"),
        title: textOf(record, "title"),
        startsAt: at,
        startPrecision: textOf(record, "startPrecision"),
        timeZone: textOf(record, "timeZone"),
      });
      if (
        row.parentMeetingKey !== undefined ||
        !meetingId || delta.key !== `meeting:${meetingId}` ||
        !startsAt || startsAt !== row.priorStartsAt ||
        !successorId || !successorStartsAt || row.successorKey !== `meeting:${successorId}` ||
        (successor?.carried !== undefined && successor?.carried !== null) ||
        !(
          supersedesSeriesRecord(sittingOf(before, meetingId, startsAt), sittingOf(successor, successorId, successorStartsAt)) ||
          reissuesSitting(sittingOf(before, meetingId, startsAt), sittingOf(successor, successorId, successorStartsAt))
        )
      ) {
        return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} is not proven replaced by a fresh record of the same sitting.`);
      }
      validMeetingEvidence.set(delta.key, row);
      continue;
    }
    if (row.code === "EXCLUDED_BY_PUBLISHER") {
      /*
       * A sitting the publisher struck out of its series (2026-09-23). The
       * statement must be one THIS read recorded, as a held fact of this
       * candidate, for this record's own body; the removed record must be
       * that very sitting; and the candidate must not publish it anyway.
       */
      const stated = (candidate.excludedFacts ?? [])
        .filter((fact) => fact.code === "MEETING_EXCLUDED_BY_PUBLISHER")
        .map((fact) => object(fact.record))
        .find((record) => record?.seriesId === row.seriesId && record?.slot === row.slot);
      const statedMeetingId = typeof stated?.meetingId === "string" ? stated.meetingId : null;
      const thatSitting =
        meetingId !== null && startsAt !== null && (
          meetingId === statedMeetingId ||
          (meetingId === row.seriesId && occurrenceStampFromInstant(startsAt) === row.slot)
        );
      if (
        row.parentMeetingKey !== undefined ||
        !meetingId || delta.key !== `meeting:${meetingId}` ||
        !startsAt || startsAt !== row.priorStartsAt ||
        !stated || !statedMeetingId || stated.bodyId !== (typeof before?.bodyId === "string" ? before.bodyId : null) ||
        !thatSitting ||
        currentMember(`meeting:${statedMeetingId}`) !== undefined
      ) {
        return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} is not proven struck out by its publisher in this read.`);
      }
      validMeetingEvidence.set(delta.key, row);
      continue;
    }
    if (row.code === "MOVED_TO_HISTORY") {
      /*
       * A concluded sitting leaves its live partition only into the partition's durable history (DB-06). The record
       * must have been concluded, started before this clock's held window, and be named here under exactly its own
       * partition's history scope. That the named history version really holds the record is the door's check against
       * the store (`movedToHistoryAuthorityIssue`), which runs before this validator.
       */
      const heldWindow = registeredWindow;
      const prior = Date.parse(row.priorStartsAt);
      const lower = Date.parse(row.lowerBound);
      if (
        heldWindow === null ||
        row.lowerBound !== heldWindow.lowerBound ||
        row.historyScope !== `${candidate.scope}${MEETING_HISTORY_SCOPE_SUFFIX}` ||
        typeof row.historyVersionId !== "string" || row.historyVersionId === "" ||
        row.parentMeetingKey !== undefined ||
        before?.status !== "CONCLUDED" ||
        !meetingId || delta.key !== `meeting:${meetingId}` ||
        !startsAt || startsAt !== row.priorStartsAt ||
        !Number.isFinite(prior) || !Number.isFinite(lower) || !(prior < lower)
      ) {
        return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} is not proven a concluded sitting older than the held window, moved to its own history.`);
      }
      validMeetingEvidence.set(delta.key, row);
      continue;
    }
    if (row.code !== "OUTSIDE_REGISTERED_SERVING_WINDOW") {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} names no removal authority this validator recognizes.`);
    }
    const lower = Date.parse(row.lowerBound);
    const upper = Date.parse(row.upperBound);
    const prior = Date.parse(row.priorStartsAt);
    const expectedWindow = row.windowContract === MEETING_READER_SERVING_WINDOW_CONTRACT
      ? registeredWindow
      : row.windowContract === MEETING_READER_SERVING_WINDOW_CONTRACT_V1 ? legacyWindow : null;
    const keptForRecords = row.windowContract === MEETING_READER_SERVING_WINDOW_CONTRACT &&
      before?.status === "CONCLUDED" && meetingRowCarriesRecords(before);
    if (
      expectedWindow === null ||
      keptForRecords ||
      row.lowerBound !== expectedWindow.lowerBound ||
      row.upperBound !== expectedWindow.upperBound ||
      row.parentMeetingKey !== undefined ||
      !meetingId || delta.key !== `meeting:${meetingId}` ||
      !startsAt || startsAt !== row.priorStartsAt ||
      !Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper ||
      !Number.isFinite(prior) || !(prior < lower || prior > upper)
    ) {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} is not proven outside its explicit registered serving window.`);
    }
    validMeetingEvidence.set(delta.key, row);
  }

  for (const delta of removed.filter(({ key }) => key.startsWith("agenda-document:"))) {
    const row = evidenceByKey.get(delta.key)!;
    if (row.code === "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT" || row.code === "OFFICIAL_ROSTER_NO_LONGER_LISTS") {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} does not inherit authority from its exact removed meeting.`);
    }
    const before = object(delta.before);
    const documentId = typeof before?.id === "string" ? before.id : null;
    const meetingId = typeof before?.meetingId === "string" ? before.meetingId : null;
    const parentKey = meetingId ? `meeting:${meetingId}` : null;
    const parent = parentKey ? validMeetingEvidence.get(parentKey) : null;
    const inherits =
      !!documentId && delta.key === `agenda-document:${documentId}` &&
      !!parentKey && row.parentMeetingKey === parentKey && removedKeys.has(parentKey) && !!parent &&
      row.code === parent.code && row.priorStartsAt === parent.priorStartsAt &&
      (row.code === "OUTSIDE_REGISTERED_SERVING_WINDOW" && parent.code === "OUTSIDE_REGISTERED_SERVING_WINDOW"
        ? row.windowContract === parent.windowContract &&
          row.lowerBound === parent.lowerBound && row.upperBound === parent.upperBound
        : row.code === "MOVED_TO_HISTORY" && parent.code === "MOVED_TO_HISTORY"
          ? row.historyScope === parent.historyScope && row.historyVersionId === parent.historyVersionId &&
            row.lowerBound === parent.lowerBound
        : row.code === "SUPERSEDED_BY_OCCURRENCE_IDENTITY" && parent.code === "SUPERSEDED_BY_OCCURRENCE_IDENTITY"
          ? row.successorKey === parent.successorKey
          : row.code === "EXCLUDED_BY_PUBLISHER" && parent.code === "EXCLUDED_BY_PUBLISHER" &&
            row.seriesId === parent.seriesId && row.slot === parent.slot);
    if (!inherits) {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} does not inherit authority from its exact removed meeting.`);
    }
  }

  const unsupported = removed.find(({ key }) => !key.startsWith("meeting:") && !key.startsWith("agenda-document:"));
  if (unsupported) {
    return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_UNSUPPORTED", `${unsupported.key} is not a meeting or attached agenda-document key.`);
  }
  return null;
}

/**
 * A registry member may leave an open fact set only as a body minted on a
 * Census "no district here" placeholder (Sean, 2026-09-23). Nothing in the
 * evidence row is taken on trust; every clause is re-derived from this
 * candidate: the removed record is exactly `body:<its id>`, it sat on exactly
 * the named division, and the candidate still holds that division, a
 * placeholder by its own Census code (lib/registry/census-placeholders.ts).
 * Every other registry removal stays refused.
 */
function registryPlaceholderRemovalCheck(
  candidate: RoutineCandidate,
  removed: RoutineChangeSet["removed"],
  evidenceByKey: ReadonlyMap<string, RoutineRemovalEvidence>,
): ValidationCheck | null {
  const registry = object(object(candidate.readModel)?.registry);
  const divisions = new Map<string, Record<string, unknown>>();
  for (const value of Array.isArray(registry?.divisions) ? registry.divisions : []) {
    const division = object(value);
    if (division && typeof division.ocdId === "string") divisions.set(division.ocdId, division);
  }
  const rosters = Array.isArray(object(candidate.readModel)?.bodyRosters) ? (object(candidate.readModel)!.bodyRosters as unknown[]).map(object) : [];
  for (const delta of removed) {
    const row = evidenceByKey.get(delta.key)!;
    const before = object(delta.before);
    if (row.code === "OFFICIAL_ROSTER_NO_LONGER_LISTS") {
      // A departure: this candidate's complete official roster for the body, from that page, no longer lists the holder.
      const roster = rosters.find(r => r?.bodyId === row.bodyId);
      const listed = Array.isArray(roster?.members) && roster.members.some(member => object(member)?.id === row.holderId);
      if (!roster || roster.sourceUrl !== row.sourceUrl || listed ||
          !["roster-disposition", "official-candidacy", "official-photo", "roster-photo"].some(kind => delta.key === `${kind}:${row.holderId}`)) {
        return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} is not proven gone from its body's complete official roster.`);
      }
      continue;
    }
    const division = row.code === "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT" ? divisions.get(row.divisionOcdId) : undefined;
    if (
      row.code !== "CENSUS_PLACEHOLDER_NOT_A_GOVERNMENT" ||
      typeof before?.id !== "string" || delta.key !== `body:${before.id}` ||
      before.ocdId !== row.divisionOcdId || !division ||
      !isCensusPlaceholderDivision({
        ocdId: row.divisionOcdId,
        divisionType: typeof division.divisionType === "string" ? division.divisionType : null,
        geoid: typeof division.geoid === "string" ? division.geoid : null,
      })
    ) {
      return result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "REMOVAL_EVIDENCE_MISMATCH", `${delta.key} is not proven to be a body on a Census placeholder division this candidate keeps.`);
    }
  }
  return null;
}

export function failureStateFor(check: ValidationCheck): CandidateState {
  switch (check.check) {
    case "SOURCE_AUTHENTICITY": return "SOURCE_BLOCKED";
    case "SCHEMA_PARSE_VALIDITY": return "PARSE_INVALID";
    case "IDENTITY_JURISDICTION_VALIDITY": return "IDENTITY_UNRESOLVED";
    case "TEMPORAL_VALIDITY": return "TEMPORAL_INVALID";
    case "SEMANTIC_VALIDITY": return "SEMANTIC_INVALID";
    case "COMPLETENESS_HORIZON_VALIDITY": return "HORIZON_UNRESOLVED";
    case "ABSENCE_VALIDITY": return check.verdict === "CANNOT_TELL" ? "CANNOT_TELL" : "SEMANTIC_INVALID";
    case "DEPENDENT_READ_MODEL_VALIDITY": return "DEPENDENT_CONSUMER_INVALID";
  }
}

/** Every decision below is deterministic and tied to one named GOOD check. */
export function validateRoutineCandidate(
  candidate: RoutineCandidate,
  lastKnownGood: CandidateVersionRecord | null,
  validatedAt: string = new Date().toISOString(),
  sourceScopedChecks: readonly DependentCheck[] = [],
): { readonly receipt: ValidationReceipt; readonly state: "VALIDATED" | CandidateState } {
  const checks: ValidationCheck[] = [];
  const derivedCivicRecords = civicRecordsFor(candidate.recordClass, candidate.readModel);
  const civicRecords = candidate.civicRecords ?? derivedCivicRecords;
  const civicRecordKeys = civicRecords.map((member) => member.key);
  const invalidCivicRecordKey = civicRecordKeys.find((key) => typeof key !== "string" || key.trim().length === 0);
  const duplicateCivicRecordKeys = civicRecordKeys.length - new Set(civicRecordKeys).size;
  const derivedCivicRecordKeys = derivedCivicRecords.map((member) => member.key);
  const invalidDerivedCivicRecordKey = derivedCivicRecordKeys.find((key) => typeof key !== "string" || key.trim().length === 0);
  const duplicateDerivedCivicRecordKeys = derivedCivicRecordKeys.length - new Set(derivedCivicRecordKeys).size;
  const normalizedPayload = durableCanonicalJson(candidate.normalizedPayload);
  const readModel = durableCanonicalJson(candidate.readModel);
  const suppliedCivicRecords = candidate.civicRecords === undefined ? null : canonicalMembers(candidate.civicRecords);
  const canonicalDerivedCivicRecords = canonicalMembers(derivedCivicRecords);
  /* A DERIVED authority has no route: its candidate is authentic only as the exact inputs it names (derived-door.ts). */
  const authority = candidate.retrieval.derived
    ? derivedAuthorityFor(candidate)
    : candidate.retrieval.manualSourceReceipt
    ? authorityForManualReceipt(
        candidate.sourceId,
        candidate.recordClass,
        candidate.retrieval.manualSourceReceipt,
        candidate.retrieval.finalUrl,
      )
    : candidate.retrieval.finalUrl
      ? authorityFor(candidate.sourceId, candidate.recordClass, candidate.retrieval.finalUrl)
      : { ok: false as const, code: "FINAL_URL_MISSING", detail: "Successful retrieval has no final URL." };
  const registered = candidate.bootstrapImport
    ? sourceAuthority(candidate.sourceId)
    : authority.ok
      ? authority.contract
      : null;
  const inheritedAuthorityIssue = manualPriorAuthorityIssue(candidate, lastKnownGood);
  const inheritedAuthority = manualPriorAuthorityOf(candidate);

  if (candidate.bootstrapImport) {
    const reattestation = candidate.bootstrapImport.kind === "TRUSTED_LKG_REATTESTATION";
    const outcomeUnionPredecessorId = candidate.bootstrapImport.kind === "TRUSTED_LKG_IMPORT"
      ? candidate.bootstrapImport.pimaOutcomeUnion?.predecessorVersionId ?? null
      : null;
    const exactPredecessorId = reattestation
      ? candidate.bootstrapImport.predecessorVersionId
      : outcomeUnionPredecessorId;
    const issue = trustedLkgImportEvidenceIssue(candidate, lastKnownGood);
    if (exactPredecessorId !== null && lastKnownGood?.candidate.id !== exactPredecessorId) {
      checks.push(result(
        "SOURCE_AUTHENTICITY",
        "FAIL",
        reattestation
          ? "TRUSTED_LKG_REATTESTATION_REQUIRES_EXACT_LKG"
          : "TRUSTED_LKG_PIMA_OUTCOME_UNION_REQUIRES_EXACT_LKG",
        `${reattestation ? "Re-attestation" : "Pima outcome union"} names ${exactPredecessorId}, but the exact durable LKG is ${lastKnownGood?.candidate.id ?? "absent"}.`,
      ));
    } else if (!reattestation && outcomeUnionPredecessorId === null && lastKnownGood !== null) {
      checks.push(result(
        "SOURCE_AUTHENTICITY",
        "FAIL",
        "TRUSTED_LKG_IMPORT_REQUIRES_EMPTY_POINTER",
        `Trusted LKG import is a one-time first-pointer transfer; existing LKG ${lastKnownGood.candidate.id} must not be replaced by bootstrap evidence.`,
      ));
    } else if (!registered || !registered.recordClasses.includes(candidate.recordClass)) {
      checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "TRUSTED_LKG_IMPORT_SOURCE_UNREGISTERED", "The import does not bind a registered source authority and record class."));
    } else if (issue !== null) {
      checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "TRUSTED_LKG_IMPORT_INVALID", issue));
    } else {
      checks.push(result(
        "SOURCE_AUTHENTICITY",
        "PASS",
        reattestation ? "TRUSTED_LKG_REATTESTATION_PROVENANCE_VALID" : "TRUSTED_LKG_IMPORT_PROVENANCE_VALID",
        reattestation
          ? `Explicitly non-source-authenticated PDC-v2 integrity successor for exact predecessor ${candidate.bootstrapImport.predecessorVersionId}, pointer ${candidate.bootstrapImport.predecessorPointerSha256}, at code ${candidate.bootstrapImport.importerCodeSha}.`
          : `Explicitly non-source-authenticated PDC-v2 LKG import from ${candidate.bootstrapImport.fixtures.length} immutable file(s), manifest ${candidate.bootstrapImport.fixtureSetSha256}, at code ${candidate.bootstrapImport.importerCodeSha}.`,
      ));
    }
  } else if (!candidate.retrieval.succeeded) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "SOURCE_RETRIEVAL_FAILED", candidate.retrieval.failureDetail ?? `HTTP ${candidate.retrieval.httpStatus ?? "unknown"}; no authoritative bytes acquired.`));
  } else if (!authority.ok) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", authority.code, authority.detail));
  } else if (!candidate.retrieval.rawHash || !SHA256.test(candidate.retrieval.rawHash)) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "RAW_HASH_INVALID", "Acquired bytes do not carry a lowercase SHA-256 hash."));
  } else if (candidate.retrieval.httpStatus === 304 && notModifiedIssue(candidate) !== null) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "NOT_MODIFIED_WITHOUT_BOUND_PIN", notModifiedIssue(candidate) ?? ""));
  } else if (inheritedAuthorityIssue !== null) {
    checks.push(result("SOURCE_AUTHENTICITY", "FAIL", "MANUAL_PRIOR_AUTHORITY_INVALID", inheritedAuthorityIssue));
  } else if (inheritedAuthority) {
    checks.push(result("SOURCE_AUTHENTICITY", "PASS", "CURRENT_SOURCES_AND_EXACT_PRIOR_AUTHORITY_VALID",
      `${authority.contract.publisher}; current acquired sources plus ${inheritedAuthority.retainedMembers.length} unchanged members inherited from GOOD version ${inheritedAuthority.versionId}. Inherited members retain their prior provenance; no fresh HTTP retrieval is asserted for them.`));
  } else {
    const confirmed = candidate.retrieval.httpStatus === 304
      ? `; 304 Not Modified against the pinned Last-Modified ${REGISTRATION_SOURCE_LAST_MODIFIED}, confirming the pinned bytes ${REGISTRATION_SOURCE_SHA256} without a download`
      : "";
    checks.push(candidate.retrieval.derived
      ? result("SOURCE_AUTHENTICITY", "PASS", "DERIVED_INPUTS_AND_RAW_PROVENANCE_VALID", `${authority.contract.publisher}; derived from ${candidate.retrieval.derived.inputs.length} named input(s); raw ${candidate.retrieval.rawHash}.`)
      : result("SOURCE_AUTHENTICITY", "PASS", "AUTHORITY_AND_RAW_PROVENANCE_VALID", `${authority.contract.publisher}; ${candidate.retrieval.finalUrl}${confirmed}; raw ${candidate.retrieval.rawHash}.`));
  }

  if (!candidate.normalization.succeeded) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "PARSER_FAILED", candidate.normalization.failureDetail ?? "Normalizer did not produce a candidate."));
  } else if (!candidate.normalization.normalizedHash || !SHA256.test(candidate.normalization.normalizedHash)) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "NORMALIZED_HASH_INVALID", "Normalized payload does not carry a lowercase SHA-256 hash."));
  } else if (readModel.issue !== null || readModel.canonical === null) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "READ_MODEL_NOT_DURABLE_JSON", readModel.issue ?? "Reader projection is not durable JSON."));
  } else if (sha256(readModel.canonical) !== candidate.normalization.normalizedHash) {
    checks.push(result(
      "SCHEMA_PARSE_VALIDITY",
      "FAIL",
      "NORMALIZED_READ_MODEL_HASH_MISMATCH",
      "The supplied normalized hash does not bind the exact bounded Reader projection presented for promotion.",
    ));
  } else if (candidate.normalization.normalizedPayloadHash === undefined && sourceScopedChecks.length > 0) {
    checks.push(result(
      "SCHEMA_PARSE_VALIDITY",
      "FAIL",
      "NORMALIZED_PAYLOAD_HASH_MISSING",
      "A candidate entering a registered production contract does not bind its normalized/provenance evidence envelope.",
    ));
  } else if (candidate.normalization.normalizedPayloadHash !== undefined && (
    candidate.normalization.normalizedPayloadHash === null ||
    !SHA256.test(candidate.normalization.normalizedPayloadHash)
  )) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "NORMALIZED_PAYLOAD_HASH_INVALID", "Normalized evidence does not carry a lowercase SHA-256 hash."));
  } else if (candidate.normalization.normalizedPayloadHash !== undefined && (
    normalizedPayload.issue !== null || normalizedPayload.canonical === null
  )) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "NORMALIZED_PAYLOAD_NOT_DURABLE_JSON", normalizedPayload.issue ?? "Normalized payload is not durable JSON."));
  } else if (
    candidate.normalization.normalizedPayloadHash !== undefined &&
    normalizedPayload.canonical !== null &&
    sha256(normalizedPayload.canonical) !== candidate.normalization.normalizedPayloadHash
  ) {
    checks.push(result(
      "SCHEMA_PARSE_VALIDITY",
      "FAIL",
      "NORMALIZED_PAYLOAD_HASH_MISMATCH",
      "The supplied normalized-evidence hash does not bind the exact normalized payload presented for promotion.",
    ));
  } else if (invalidCivicRecordKey !== undefined) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "CIVIC_RECORD_KEY_INVALID", "A normalized civic record has no stable non-empty member key."));
  } else if (duplicateCivicRecordKeys > 0) {
    checks.push(result(
      "SCHEMA_PARSE_VALIDITY",
      "FAIL",
      "CIVIC_RECORD_KEYS_DUPLICATED",
      `${duplicateCivicRecordKeys} normalized civic record member key(s) are duplicated; no Map or delta projection may silently collapse them.`,
    ));
  } else if (invalidDerivedCivicRecordKey !== undefined) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "DERIVED_CIVIC_RECORD_KEY_INVALID", "The exact Reader projection derives a civic record with no stable non-empty member key."));
  } else if (duplicateDerivedCivicRecordKeys > 0) {
    checks.push(result(
      "SCHEMA_PARSE_VALIDITY",
      "FAIL",
      "DERIVED_CIVIC_RECORD_KEYS_DUPLICATED",
      `${duplicateDerivedCivicRecordKeys} exact Reader-projection member key(s) are duplicated; no supplied member list may conceal them.`,
    ));
  } else if (candidate.civicRecords !== undefined && (
    suppliedCivicRecords === null ||
    canonicalDerivedCivicRecords === null ||
    suppliedCivicRecords !== canonicalDerivedCivicRecords
  )) {
    checks.push(result(
      "SCHEMA_PARSE_VALIDITY",
      "FAIL",
      "CIVIC_RECORD_PROJECTION_MISMATCH",
      "The supplied civic-record members do not equal the members derived from the exact Reader projection.",
    ));
  } else if (registered && candidate.normalization.parserVersion !== registered.parserVersion) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "PARSER_VERSION_UNREGISTERED", `${candidate.normalization.parserVersion} does not equal ${registered.parserVersion}.`));
  } else if (candidate.normalization.missingRequiredFields.length > 0) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "REQUIRED_FIELDS_MISSING", candidate.normalization.missingRequiredFields.join(", ")));
  } else if (candidate.normalization.inputRecords < 0 || candidate.normalization.outputRecords < 0 || candidate.normalization.droppedRecords < 0 || candidate.normalization.outputRecords + candidate.normalization.droppedRecords !== candidate.normalization.inputRecords) {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "FAIL", "RECORD_DISPOSITION_MISMATCH", `${candidate.normalization.outputRecords} output + ${candidate.normalization.droppedRecords} dropped != ${candidate.normalization.inputRecords} input.`));
  } else {
    checks.push(result("SCHEMA_PARSE_VALIDITY", "PASS", "SCHEMA_AND_DISPOSITION_VALID", `${candidate.normalization.outputRecords}/${candidate.normalization.inputRecords} records normalized; ${candidate.normalization.droppedRecords} explicitly dropped.`));
  }

  const identityFailure = candidate.identities.find((identity) =>
    identity.ambiguous || identity.matchBasis === "NAME_ONLY" || Object.keys(identity.identifiers).length === 0,
  );
  const identifierContractFailure = registered ? candidate.identities.find((identity) =>
    !registered.expectedIdentifierKeys.some((key) => Object.hasOwn(identity.identifiers, key)),
  ) : undefined;
  if (candidate.normalization.outputRecords > 0 && candidate.identities.length === 0) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "IDENTITY_EVIDENCE_MISSING", "Normalized records have no identity receipt."));
  } else if (identityFailure) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", identityFailure.ambiguous ? "IDENTITY_AMBIGUOUS" : identityFailure.matchBasis === "NAME_ONLY" ? "NAME_ONLY_IDENTITY_REFUSED" : "IDENTIFIER_MISSING", `${identityFailure.subjectId} cannot be mapped by an exact registered identifier.`));
  } else if (registered && !jurisdictionAllowed(candidate, registered.jurisdictions)) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "JURISDICTION_OUTSIDE_AUTHORITY", `One or more identities fall outside ${registered.jurisdictions.join(", ")}.`));
  } else if (identifierContractFailure) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "REGISTERED_IDENTIFIER_MISSING", `${identifierContractFailure.subjectId} carries none of the registered keys: ${registered!.expectedIdentifierKeys.join(", ")}.`));
  } else if (candidate.recordClass === "STATE_LEGISLATOR" && candidate.identities.some((identity) => !identity.chamber || !identity.term || !identity.office)) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE", "Every state member requires exact office, chamber, and term."));
  } else if (candidate.recordClass === "STATE_LEGISLATOR" && candidate.identities.some((identity) =>
    identity.term !== candidate.temporal.version ||
    (candidate.sourceId === "nh-general-court" && identity.identifiers.chamber !== identity.chamber)
  )) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "STATE_MEMBER_CHAMBER_TERM_MISMATCH", "Every state member's chamber identifier and term must agree with the normalized seat and candidate period."));
  } else if (candidate.recordClass === "STATE_ROLL_CALL" && candidate.identities.some((identity) => !identity.chamber || !identity.term || !identity.session || !identity.identifiers.rollCallId || !identity.identifiers.eventId)) {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "FAIL", "STATE_ROLL_IDENTITY_INCOMPLETE", "Every state roll call requires exact roll, event, chamber, term, and session identifiers."));
  } else {
    checks.push(result("IDENTITY_JURISDICTION_VALIDITY", "PASS", "IDENTITY_AND_JURISDICTION_EXACT", `${candidate.identities.length} exact identity binding(s); no name-only inheritance.`));
  }

  const current = lastKnownGood?.candidate.temporal;
  const retrievedAt = Date.parse(candidate.retrieval.retrievedAt);
  const currentRetrievedAt = lastKnownGood === null
    ? null
    : Date.parse(lastKnownGood.candidate.retrieval.retrievedAt);
  const validationAt = Date.parse(validatedAt);
  const candidateOrder = temporalOrder(candidate.temporal.sourceThrough);
  const currentOrder = current ? temporalOrder(current.sourceThrough) : null;
  if (!Number.isFinite(retrievedAt) || !Number.isFinite(validationAt)) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "ACQUISITION_TIME_INVALID", "The acquisition or validation instant is not a valid timestamp."));
  } else if (retrievedAt > validationAt) {
    checks.push(result(
      "TEMPORAL_VALIDITY",
      "FAIL",
      "ACQUISITION_TIME_AFTER_VALIDATION",
      `The acquisition instant ${candidate.retrieval.retrievedAt} is later than validation ${validatedAt}.`,
    ));
  } else if (currentRetrievedAt !== null && Number.isFinite(currentRetrievedAt) && retrievedAt < currentRetrievedAt) {
    checks.push(result(
      "TEMPORAL_VALIDITY",
      "FAIL",
      "ACQUISITION_TIME_REGRESSION",
      `The candidate acquisition ${candidate.retrieval.retrievedAt} predates serving LKG acquisition ${lastKnownGood!.candidate.retrieval.retrievedAt}.`,
    ));
  } else if (!candidate.temporal.version || !candidate.temporal.sourceThrough) {
    checks.push(result("TEMPORAL_VALIDITY", "CANNOT_TELL", "SOURCE_THROUGH_UNKNOWN", "Candidate has no product/session/report source-through value."));
  } else if (candidate.temporal.version !== candidate.temporal.expectedVersion) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "WRONG_PERIOD_OR_VINTAGE", `${candidate.temporal.version} does not equal expected ${candidate.temporal.expectedVersion}.`));
  } else if (candidate.temporal.staleAtRetrieval && candidate.bootstrapImport) {
    checks.push(result(
      "TEMPORAL_VALIDITY",
      "PASS",
      "TRUSTED_LKG_IMPORT_STALENESS_RECORDED",
      `The frozen LKG is explicitly stale at import (source through ${candidate.temporal.sourceThrough}); it may preserve service but cannot prove current publisher freshness.`,
    ));
  } else if (candidate.temporal.staleAtRetrieval) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "FRESH_FETCH_STALE_FACTS", "The route was freshly read but the source facts belong to an expired term/session/period."));
  } else if ((hasOpaqueWorkerEdition(candidate) || (lastKnownGood && hasOpaqueWorkerEdition(lastKnownGood.candidate))) &&
    (candidateOrder === null || (current && currentOrder === null))) {
    checks.push(result("TEMPORAL_VALIDITY", "CANNOT_TELL", "WORKER_SOURCE_CHRONOLOGY_UNKNOWN", "An opaque worker edition requires ordered source-through evidence; its hash is not a clock."));
  } else if (current && !UNORDERED_VERSION_CLASSES.has(candidate.recordClass) &&
    !hasOpaqueWorkerEdition(candidate) && !(lastKnownGood && hasOpaqueWorkerEdition(lastKnownGood.candidate)) &&
    candidate.temporal.version < current.version) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "VERSION_REGRESSION", `${candidate.temporal.version} precedes promoted ${current.version}.`));
  } else if (candidateOrder !== null && currentOrder !== null && candidateOrder < currentOrder) {
    checks.push(result("TEMPORAL_VALIDITY", "FAIL", "SOURCE_THROUGH_REGRESSION", `${candidate.temporal.sourceThrough} precedes promoted ${current!.sourceThrough}.`));
  } else {
    checks.push(result("TEMPORAL_VALIDITY", "PASS", "TEMPORAL_VERSION_VALID", `${candidate.temporal.version}; source through ${candidate.temporal.sourceThrough}.`));
  }

  if (candidate.semantics.violations.length > 0) {
    checks.push(result("SEMANTIC_VALIDITY", "FAIL", "SEMANTIC_CONTRACT_VIOLATION", candidate.semantics.violations.join("; ")));
  } else if (candidate.semantics.expectedActionStage && candidate.semantics.actionStage !== candidate.semantics.expectedActionStage) {
    checks.push(result("SEMANTIC_VALIDITY", "FAIL", "WRONG_ACTION_STAGE", `${candidate.semantics.actionStage ?? "unstated"} is not ${candidate.semantics.expectedActionStage}.`));
  } else {
    checks.push(result("SEMANTIC_VALIDITY", "PASS", "FACT_INTERPRETATION_VALID", `${candidate.semantics.factKind}${candidate.semantics.actionStage ? ` at ${candidate.semantics.actionStage}` : ""}.`));
  }

  const removalCheck = incompleteHorizonRemovalCheck(candidate);
  if (candidate.horizon.returnedRecords !== candidate.normalization.outputRecords) {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "FAIL", "HORIZON_RECORD_COUNT_MISMATCH", `${candidate.horizon.returnedRecords} horizon rows != ${candidate.normalization.outputRecords} normalized rows.`));
  } else if (candidate.horizon.claimsComplete && candidate.horizon.kind !== "BOUNDED") {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "CANNOT_TELL", "COMPLETE_UNIVERSE_UNBOUNDED", "An open fact set cannot claim a complete universe."));
  } else if (candidate.horizon.claimsComplete && !candidate.horizon.paginationComplete) {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "CANNOT_TELL", "PAGINATION_INCOMPLETE", "The candidate claims completeness before the bounded query's last page."));
  } else if (candidate.horizon.claimsComplete && candidate.horizon.declaredTotal !== candidate.horizon.returnedRecords) {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "CANNOT_TELL", "DECLARED_TOTAL_NOT_RECONCILED", `${candidate.horizon.returnedRecords} returned != ${candidate.horizon.declaredTotal ?? "unstated"} declared.`));
  } else if (removalCheck) {
    checks.push(removalCheck);
  } else {
    checks.push(result("COMPLETENESS_HORIZON_VALIDITY", "PASS", candidate.horizon.claimsComplete ? "BOUNDED_UNIVERSE_RECONCILED" : "INDIVIDUAL_FACTS_NO_UNIVERSE_CLAIM", candidate.horizon.claimsComplete ? `${candidate.horizon.returnedRecords}/${candidate.horizon.declaredTotal} rows and pagination ended.` : "Valid individual facts may promote; broader completeness remains open."));
  }

  const absencePolicy = registered?.absencePolicy;
  if (!candidate.absence.claimsAbsence && candidate.normalization.outputRecords === 0) {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ZERO_IS_NOT_ABSENCE", "The query returned zero records but carries no competent bounded absence evidence."));
  } else if (!candidate.absence.claimsAbsence) {
    checks.push(result("ABSENCE_VALIDITY", "PASS", "NO_ABSENCE_CLAIM", "The projection makes no absence claim."));
  } else if (!absencePolicy || absencePolicy.kind === "NEVER_FROM_ZERO") {
    checks.push(result("ABSENCE_VALIDITY", "FAIL", "SOURCE_CANNOT_ESTABLISH_ABSENCE", `${candidate.sourceId} is not registered to establish absence for this record class/query.`));
  } else if (candidate.absence.basis === "ZERO_ONLY") {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ZERO_IS_NOT_ABSENCE", "A zero result without bounded horizon or an explicit official statement proves no absence."));
  } else if (!candidate.absence.exactSubject || !candidate.absence.exactHorizon) {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ABSENCE_SCOPE_INCOMPLETE", "Absence evidence lacks the exact subject or horizon."));
  } else if (candidate.absence.basis === "BOUNDED_AUTHORITATIVE_QUERY" && (!candidate.horizon.paginationComplete || candidate.horizon.kind !== "BOUNDED")) {
    checks.push(result("ABSENCE_VALIDITY", "CANNOT_TELL", "ABSENCE_QUERY_NOT_BOUNDED", "The authoritative query did not prove its last page/end of universe."));
  } else {
    checks.push(result("ABSENCE_VALIDITY", "PASS", "AUTHORITATIVE_ABSENCE_BOUNDED", `${candidate.absence.basis}: ${candidate.absence.exactSubject} within ${candidate.absence.exactHorizon}.`));
  }

  const evidence = candidate.sourceProjectionEvidence;
  const sourceProjectionEvidenceMatches = evidence?.kind === "SOURCE_PROJECTION_CONTRACT" &&
    evidence.sourceId === candidate.sourceId &&
    evidence.recordClass === candidate.recordClass &&
    evidence.scope === candidate.scope;
  const dependentChecks = [...candidate.dependentChecks, ...sourceScopedChecks];
  const failedConsumer = dependentChecks.find((check) => !check.passed);
  if (!sourceProjectionEvidenceMatches) {
    checks.push(result(
      "DEPENDENT_READ_MODEL_VALIDITY",
      "FAIL",
      "DEPENDENT_EVIDENCE_SCOPE_MISMATCH",
      "Read-model evidence is not bound to this candidate's exact source, record class, and scope.",
    ));
  } else if (dependentChecks.length === 0) {
    checks.push(result("DEPENDENT_READ_MODEL_VALIDITY", "FAIL", "DEPENDENT_CHECK_MISSING", "No named Reader/Ask consumer exercised the promoted projection shape."));
  } else if (failedConsumer) {
    checks.push(result("DEPENDENT_READ_MODEL_VALIDITY", "FAIL", "DEPENDENT_CONSUMER_REJECTED", `${failedConsumer.consumer}: ${failedConsumer.detail}`));
  } else {
    checks.push(result("DEPENDENT_READ_MODEL_VALIDITY", "PASS", "DEPENDENT_CONSUMERS_ACCEPT", dependentChecks.map((check) => check.consumer).join(", ")));
  }

  const blocking = firstBlocking(checks);
  const decision: CandidateDecision = blocking === null ? "GOOD" : blocking.verdict === "CANNOT_TELL" ? "CANNOT_TELL" : "FAIL";
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision,
    candidateId: candidate.id,
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    validatedAt,
    checks,
    excludedFacts: candidate.excludedFacts ?? [],
  };
  return { receipt, state: blocking ? failureStateFor(blocking) : "VALIDATED" };
}

/** A concluded meeting row that names an agenda, minutes, an outcome or a vote is a kept record (DB-01). */
function meetingRowCarriesRecords(row: Record<string, unknown>): boolean {
  if (typeof row.agendaUrl === "string" && row.agendaUrl !== "") return true;
  const links = Array.isArray(row.publishedLinks) ? row.publishedLinks : [];
  if (links.some((link) => typeof (link as { label?: unknown })?.label === "string" && /minutes|outcome|vote|result/i.test((link as { label: string }).label))) return true;
  return row.outcome != null || (Array.isArray(row.votes) ? row.votes.length > 0 : row.votes != null);
}
