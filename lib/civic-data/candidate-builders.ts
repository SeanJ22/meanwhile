import { createHash } from "node:crypto";

import type { FundingSnapshot } from "../funding/types.ts";
import type { AcsFetch, AcsPopulationRow } from "../sources/census-acs-population/index.ts";
import { BASE as CENSUS_ACS_BASE, VINTAGE_YEAR, normalize as normalizeAcs } from "../sources/census-acs-population/index.ts";
import type { MembersExtraction } from "../../scripts/nh-gencourt-members.mts";
import type { Division } from "../registry/types.ts";
import type { GeoFeature } from "../registry/resolve.ts";
import type { StateMemberVote, StateRollCall, StateVotesSnapshot } from "../sources/legiscan/types.ts";
import type { RoutineCandidate, RoutineRecordClass } from "./types.ts";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizedHash(value: unknown): string {
  return sha256(canonical(value));
}

export interface PromotedCensusGeography {
  readonly formatVersion: 1;
  readonly product: string;
  readonly vintage: string;
  readonly features: readonly GeoFeature[];
  readonly divisions: readonly Division[];
}

/** Candidate for the exact geography/division projection the point resolver reads. */
export function censusGeographyCandidate(input: {
  readonly rawBodies: readonly string[];
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
  readonly product: string;
  readonly vintage: string;
  readonly expectedVintage: string;
  readonly features: readonly GeoFeature[];
  readonly divisions: readonly Division[];
  readonly declaredFeatureTotal: number;
}): RoutineCandidate {
  const rawHash = sha256(input.rawBodies.map((body) => sha256(body)).join("\n"));
  const readModel: PromotedCensusGeography = {
    formatVersion: 1,
    product: input.product,
    vintage: input.vintage,
    features: input.features,
    divisions: input.divisions,
  };
  const featureIds = input.features.map((feature) => feature.properties.ocdId);
  const divisionIds = input.divisions.map((division) => division.ocdId);
  const divisionSet = new Set(divisionIds);
  const missing: string[] = [];
  if (input.rawBodies.length === 0) missing.push("raw product bytes");
  if (input.features.some((feature) => !feature.properties.ocdId || !feature.geometry?.type)) missing.push("feature ocdId/geometry");
  if (input.divisions.some((division) => !division.geoid || !division.sourceDataset)) missing.push("division geoid/sourceDataset");
  const violations: string[] = [];
  if (new Set(featureIds).size !== featureIds.length) violations.push("Resolver feature OCD identifiers are duplicated.");
  if (new Set(divisionIds).size !== divisionIds.length) violations.push("Resolver division OCD identifiers are duplicated.");
  if (featureIds.some((id) => !divisionSet.has(id))) violations.push("A geometry feature has no exact division identity.");
  if (input.divisions.some((division) => division.canonicalGap === "NOT_A_GOVERNMENT" && division.canonicalOcdId !== null)) {
    violations.push("A statistical Census entity was assigned a government identity.");
  }
  return {
    id: candidateId("census-bulk-products", "reader-resolver", rawHash, input.retrievedAt),
    sourceId: "census-bulk-products",
    recordClass: "CENSUS_GEOGRAPHY",
    scope: "reader-resolver",
    retrieval: {
      succeeded: input.rawBodies.length > 0,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.rawBodies.length > 0 ? 200 : null,
      retrievedAt: input.retrievedAt,
      rawHash: input.rawBodies.length > 0 ? rawHash : null,
      failureDetail: input.rawBodies.length > 0 ? undefined : "No Census bulk-product bytes were acquired.",
    },
    normalization: {
      succeeded: true,
      parserVersion: "census-bulk/2",
      schemaVersion: `${input.product}:${input.vintage}:resolver-1`,
      normalizedHash: normalizedHash(readModel),
      inputRecords: input.features.length,
      outputRecords: input.features.length,
      droppedRecords: 0,
      missingRequiredFields: missing,
    },
    identities: input.divisions.map((division) => ({
      subjectId: division.ocdId,
      jurisdiction: "US",
      identifiers: { product: input.product, vintage: input.vintage, geoid: division.geoid ?? "" },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    })),
    temporal: { version: input.vintage, expectedVersion: input.expectedVintage, sourceThrough: input.vintage, staleAtRetrieval: false },
    semantics: { factKind: "Census product geometry and government-unit classification", violations },
    horizon: {
      kind: "BOUNDED",
      query: `${input.product} ${input.vintage}, every configured resolver geography member`,
      returnedRecords: input.features.length,
      declaredTotal: input.declaredFeatureTotal,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/registry/server.ts", passed: featureIds.every((id) => divisionSet.has(id)), detail: `${featureIds.length} resolver features have exact division rows.` },
      { consumer: "statistical-place guard", passed: !violations.some((violation) => violation.includes("statistical")), detail: "Census statistical classifications do not inherit government identity." },
    ],
    normalizedPayload: { product: input.product, vintage: input.vintage, featureIds, divisionIds },
    readModel,
  };
}

function candidateId(sourceId: string, scope: string, rawHash: string, retrievedAt: string): string {
  return `cv-${sha256(`${sourceId}\u001f${scope}\u001f${rawHash}\u001f${retrievedAt}`).slice(0, 32)}`;
}

/**
 * Durable evidence for a source attempt that failed before bytes existed.
 * The runner uses this only when the source process did not already emit a
 * candidate receipt. No zero rows or guessed final URL can escape as absence.
 */
export function failedAcquisitionCandidate(input: {
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly requestedUrl: string;
  readonly attemptedAt: string;
  readonly failureDetail: string;
  readonly parserVersion: string;
}): RoutineCandidate {
  const attemptKey = sha256(`${input.requestedUrl}\u001f${input.failureDetail}`);
  return {
    id: candidateId(input.sourceId, input.scope, `blocked-${attemptKey}`, input.attemptedAt),
    sourceId: input.sourceId,
    recordClass: input.recordClass,
    scope: input.scope,
    retrieval: {
      succeeded: false,
      requestedUrl: input.requestedUrl,
      finalUrl: null,
      httpStatus: null,
      retrievedAt: input.attemptedAt,
      rawHash: null,
      failureDetail: input.failureDetail,
    },
    normalization: {
      succeeded: false,
      parserVersion: input.parserVersion,
      schemaVersion: "unread",
      normalizedHash: null,
      inputRecords: 0,
      outputRecords: 0,
      droppedRecords: 0,
      missingRequiredFields: [],
      failureDetail: "No authoritative bytes reached the normalizer.",
    },
    identities: [],
    temporal: {
      version: "UNKNOWN",
      expectedVersion: "UNKNOWN",
      sourceThrough: input.attemptedAt,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "source acquisition attempt", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: input.requestedUrl,
      returnedRecords: 0,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "Reader last-known-good projection",
      passed: true,
      detail: "The failed acquisition cannot replace or clear the promoted pointer.",
    }],
    normalizedPayload: null,
    readModel: null,
  };
}

export interface PromotedAcsPopulation {
  readonly formatVersion: 1;
  readonly vintage: number;
  readonly zcta: readonly AcsPopulationRow[];
  readonly state: readonly AcsPopulationRow[];
}

export function censusAcsCandidate(zctaFetch: AcsFetch, stateFetch: AcsFetch): RoutineCandidate {
  const zcta = normalizeAcs(zctaFetch);
  const state = normalizeAcs(stateFetch);
  const readModel: PromotedAcsPopulation = { formatVersion: 1, vintage: VINTAGE_YEAR, zcta, state };
  const rawZcta = zctaFetch.rawText ?? JSON.stringify(zctaFetch.rows);
  const rawState = stateFetch.rawText ?? JSON.stringify(stateFetch.rows);
  const rawHash = sha256(`${sha256(rawZcta)}\n${sha256(rawState)}`);
  const retrievedAt = [zctaFetch.fetchedAt, stateFetch.fetchedAt].sort().at(-1)!;
  const duplicates = (rows: readonly AcsPopulationRow[]) => rows.length - new Set(rows.map((row) => row.code)).size;
  const violations: string[] = [];
  if (duplicates(zcta) > 0 || duplicates(state) > 0) violations.push("Census geography identifiers are not unique within scope.");
  if (zcta.some((row) => !/^\d{5}$/.test(row.code))) violations.push("A ZCTA row does not carry a five-digit geography identifier.");
  if (state.some((row) => !/^\d{2}$/.test(row.code))) violations.push("A state row does not carry a two-digit FIPS identifier.");
  const count = zcta.length + state.length;
  return {
    id: candidateId("census-data-api", "acs-population", rawHash, retrievedAt),
    sourceId: "census-data-api",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population",
    retrieval: {
      succeeded: true,
      requestedUrl: CENSUS_ACS_BASE,
      finalUrl: zctaFetch.finalUrl ?? CENSUS_ACS_BASE,
      httpStatus: zctaFetch.status === 200 && stateFetch.status === 200 ? 200 : null,
      retrievedAt,
      rawHash,
    },
    normalization: {
      succeeded: true,
      parserVersion: "census-data-api/2",
      schemaVersion: "ACSDT5Y2024:B01003_001E+B01003_001M",
      normalizedHash: normalizedHash(readModel),
      inputRecords: count,
      outputRecords: count,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [
      ...zcta.map((row) => ({ subjectId: `zcta:${row.code}`, jurisdiction: "US", identifiers: { product: "ACSDT5Y2024", vintage: String(VINTAGE_YEAR), geography: row.code }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false })),
      ...state.map((row) => ({ subjectId: `state-fips:${row.code}`, jurisdiction: "US", identifiers: { product: "ACSDT5Y2024", vintage: String(VINTAGE_YEAR), geography: row.code }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false })),
    ],
    temporal: { version: String(VINTAGE_YEAR), expectedVersion: String(VINTAGE_YEAR), sourceThrough: String(VINTAGE_YEAR), staleAtRetrieval: false },
    semantics: { factKind: "ACS 5-year B01003 population estimate and 90% margin for the exact returned geography", violations },
    horizon: { kind: "BOUNDED", query: "all ZCTAs plus all states/DC/Puerto Rico in ACSDT5Y2024", returnedRecords: count, declaredTotal: 33_824, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/reference/acs-population.ts", passed: zcta.length === 33_772 && state.length === 52, detail: `${zcta.length} ZCTA + ${state.length} state rows.` },
      { consumer: "scripts/readiness-refresh.mts", passed: state.some((row) => row.code === "04") && zcta.every((row) => row.marginOfError === null || row.marginOfError >= 0), detail: "State FIPS 04 and nonnegative/null margins are readable." },
    ],
    normalizedPayload: { product: "ACSDT5Y2024", table: "B01003", zcta, state },
    readModel,
  };
}

export interface NhMemberReadModel {
  readonly formatVersion: 1;
  readonly jurisdiction: "US-NH";
  readonly term: string;
  readonly members: MembersExtraction["members"];
}

const NH_MEMBERS_SUPPORTED_TERM = "2025-2026";
const NH_MEMBERS_SUPPORTED_UNTIL = Date.parse("2026-12-01T00:00:00.000Z");

/**
 * Members.txt does not expose a term field. Stop the current parser before the
 * biennial turnover window so a freshly downloaded prior-term file can never
 * be treated as current merely because the transport succeeded.
 */
export function expectedNhMembersTerm(retrievedAt: string): string {
  const instant = Date.parse(retrievedAt);
  if (!Number.isFinite(instant)) return "INVALID_RETRIEVAL_DATE";
  if (instant < NH_MEMBERS_SUPPORTED_UNTIL) return NH_MEMBERS_SUPPORTED_TERM;
  const year = new Date(instant).getUTCFullYear();
  const start = year % 2 === 1 ? year : year + 1;
  return `${start}-${start + 1}`;
}

type OfficialStateSourceId = "az-legislature" | "nh-general-court" | "nj-legislature";

/**
 * Official state roll calls use state publisher ids end to end. LegiScan may
 * still discover a lead, but its ids are not accepted by this constructor.
 */
export function officialStateRollCallsCandidate(input: {
  readonly sourceId: OfficialStateSourceId;
  readonly jurisdiction: "US-AZ" | "US-NH" | "US-NJ";
  readonly rawBodies: readonly string[];
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
  readonly term: string;
  readonly expectedTerm: string;
  readonly session: string;
  readonly rolls: readonly (StateRollCall & {
    readonly sourceId: OfficialStateSourceId;
    readonly officialRollCallId: string;
    readonly eventId: string;
    readonly chamber: "House" | "Senate" | "Assembly";
    readonly term: string;
    readonly session: string;
    readonly actionStage: string;
    readonly expectedActionStage: string;
  })[];
  readonly positions: readonly (Omit<StateMemberVote, "legiscanPeopleId"> & { readonly officialPersonId: string })[];
  readonly declaredRollTotal: number;
}): RoutineCandidate {
  const rawHash = sha256(input.rawBodies.map((body) => sha256(body)).join("\n"));
  const rollIds = new Set(input.rolls.map((roll) => roll.id));
  const people = new Set(input.positions.map((position) => position.officialPersonId));
  const violations: string[] = [];
  if (input.rolls.some((roll) => roll.sourceId !== input.sourceId)) violations.push("A roll call inherits identity from a different publisher.");
  if (input.rolls.some((roll) => roll.actionStage !== roll.expectedActionStage)) violations.push("A roll call is attached to the wrong legislative action stage.");
  if (input.positions.some((position) => !rollIds.has(position.rollCallId))) violations.push("A member position points at a roll outside the official horizon.");
  if (input.rolls.some((roll) => roll.term !== input.term || roll.session !== input.session)) violations.push("A roll call belongs to a different term/session.");
  const readModel: StateVotesSnapshot = {
    generatedAt: input.retrievedAt,
    datasets: [{ state: input.jurisdiction.slice(-2), sessionId: 0, sessionName: `${input.term} ${input.session}`, datasetHash: rawHash, datasetDate: input.retrievedAt.slice(0, 10), downloadedAt: input.retrievedAt }],
    identifierMatch: {
      peopleSeen: people.size,
      peopleMatched: people.size,
      distinctOfficeholders: new Set(input.positions.map((position) => position.officeholderId)).size,
      byState: { [input.jurisdiction.slice(-2)]: { peopleSeen: people.size, peopleMatched: people.size, rollCalls: input.rolls.length } },
    },
    rollCalls: [...input.rolls],
    positions: input.positions.map((position) => ({ ...position, legiscanPeopleId: 0 })),
  };
  return {
    id: candidateId(input.sourceId, `${input.jurisdiction}:${input.term}:${input.session}`, rawHash, input.retrievedAt),
    sourceId: input.sourceId,
    recordClass: "STATE_ROLL_CALL",
    scope: input.jurisdiction,
    retrieval: { succeeded: input.rawBodies.length > 0, requestedUrl: input.requestedUrl, finalUrl: input.finalUrl, httpStatus: input.rawBodies.length > 0 ? 200 : null, retrievedAt: input.retrievedAt, rawHash: input.rawBodies.length > 0 ? rawHash : null, failureDetail: input.rawBodies.length > 0 ? undefined : "No official roll-call bytes were acquired." },
    normalization: { succeeded: true, parserVersion: `${input.sourceId}/2`, schemaVersion: `official-roll-call:${input.term}:${input.session}`, normalizedHash: normalizedHash(readModel), inputRecords: input.rolls.length, outputRecords: input.rolls.length, droppedRecords: 0, missingRequiredFields: input.rolls.some((roll) => !roll.officialRollCallId || !roll.eventId || !roll.chamber || !roll.term || !roll.session) ? ["roll/event/chamber/term/session"] : [] },
    identities: input.rolls.map((roll) => ({
      subjectId: roll.id,
      jurisdiction: input.jurisdiction,
      identifiers: { rollCallId: roll.officialRollCallId, eventId: roll.eventId },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber: roll.chamber,
      term: roll.term,
      session: roll.session,
    })),
    temporal: { version: input.term, expectedVersion: input.expectedTerm, sourceThrough: input.rolls.map((roll) => roll.date).sort().at(-1) ?? input.retrievedAt, staleAtRetrieval: input.term !== input.expectedTerm },
    semantics: { factKind: "official state-legislature roll-call decision", actionStage: input.rolls[0]?.actionStage, expectedActionStage: input.rolls[0]?.expectedActionStage, violations },
    horizon: { kind: "BOUNDED", query: `${input.sourceId} ${[...new Set(input.rolls.map((roll) => roll.chamber))].join("+") || "all chambers"} ${input.term} ${input.session} official index`, returnedRecords: input.rolls.length, declaredTotal: input.declaredRollTotal, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/sources/legiscan/snapshot.ts compatibility projection", passed: input.rolls.length > 0 && input.positions.every((position) => rollIds.has(position.rollCallId)), detail: `${input.rolls.length} rolls and ${input.positions.length} exact member positions.` },
      { consumer: "grounded Ask state-vote records", passed: input.rolls.every((roll) => Boolean(roll.billNumber && roll.motion && roll.billUrl && roll.rollCallUrl)), detail: "Every roll retains official bill/action links." },
    ],
    normalizedPayload: { sourceId: input.sourceId, jurisdiction: input.jurisdiction, term: input.term, session: input.session, rolls: input.rolls, positions: input.positions },
    readModel,
  };
}

export function nhMembersCandidate(input: {
  readonly rawText: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly extraction: MembersExtraction;
}): RoutineCandidate {
  const rawHash = sha256(input.rawText);
  const expectedTerm = expectedNhMembersTerm(input.retrievedAt);
  const current = input.extraction.members.filter((member) => member.electedStatus === "INCUMBENT" || member.electedStatus === "NEW");
  const readModel: NhMemberReadModel = { formatVersion: 1, jurisdiction: "US-NH", term: NH_MEMBERS_SUPPORTED_TERM, members: current };
  const identities = input.extraction.members.map((member) => {
    const officialComposite = `${member.chamber}:${member.seatNo}:${member.district}:${member.email ?? "no-email"}`;
    return {
      subjectId: `nh-general-court:${sha256(officialComposite).slice(0, 20)}`,
      jurisdiction: "US-NH",
      identifiers: { seatNo: member.seatNo, chamber: member.chamber, district: member.district, ...(member.email ? { officialEmail: member.email } : {}) },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber: member.chamber,
      office: member.title ?? (member.chamber === "S" ? "Senator" : "Representative"),
      term: NH_MEMBERS_SUPPORTED_TERM,
      district: member.district,
    };
  });
  const duplicateKeys = identities.length - new Set(identities.map((identity) => canonical(identity.identifiers))).size;
  const missingRequiredFields = input.extraction.members.some((member) => !member.chamber || !member.district || !member.seatNo) ? ["LegislativeBody/District/seatno"] : [];
  const violations = duplicateKeys > 0 ? [`${duplicateKeys} official chamber/seat/district/email identity composites are duplicated.`] : [];
  return {
    id: candidateId("nh-general-court", "US-NH", rawHash, input.retrievedAt),
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    retrieval: { succeeded: input.httpStatus === 200, requestedUrl: "https://gc.nh.gov/downloads/Members.txt", finalUrl: input.finalUrl, httpStatus: input.httpStatus, retrievedAt: input.retrievedAt, rawHash },
    normalization: { succeeded: true, parserVersion: "nh-general-court/2", schemaVersion: `Members.txt:${NH_MEMBERS_SUPPORTED_TERM}`, normalizedHash: normalizedHash(input.extraction), inputRecords: input.extraction.counts.logicalInput, outputRecords: input.extraction.counts.produced, droppedRecords: input.extraction.counts.dropped, missingRequiredFields },
    identities,
    temporal: { version: NH_MEMBERS_SUPPORTED_TERM, expectedVersion: expectedTerm, sourceThrough: input.retrievedAt, staleAtRetrieval: expectedTerm !== NH_MEMBERS_SUPPORTED_TERM },
    semantics: { factKind: "current legislative membership as stated by electedStatus", violations },
    horizon: { kind: "BOUNDED", query: "the complete Members.txt logical row set", returnedRecords: input.extraction.counts.produced, declaredTotal: input.extraction.counts.logicalInput, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/civic-data/state-members.ts", passed: current.length > 0, detail: `${current.length} rows marked INCUMBENT or NEW.` },
      { consumer: "state chamber contract", passed: (input.extraction.byChamber.H ?? 0) > 0 && (input.extraction.byChamber.S ?? 0) > 0, detail: JSON.stringify(input.extraction.byChamber) },
    ],
    normalizedPayload: input.extraction,
    readModel,
  };
}

/** Existing FundingSnapshot shape, with invalid zero-result absences excluded. */
export function fecFundingCandidate(input: {
  readonly snapshot: FundingSnapshot;
  readonly rawBodies: readonly string[];
  readonly finalUrl: string;
  readonly retrievedAt: string;
  readonly excludedFacts: readonly { code: string; detail: string }[];
}): RoutineCandidate {
  const rawHash = sha256(input.rawBodies.map((body) => sha256(body)).join("\n"));
  const snapshot: FundingSnapshot = { ...input.snapshot, absences: [] };
  const missing: string[] = [];
  const violations: string[] = [];
  for (const row of snapshot.candidates) {
    // FEC candidate ids are nine characters. Congressional ids carry the
    // office, cycle digit, two-letter state and five digits (H8VA01233);
    // presidential ids carry the office plus eight digits (P80001571).
    // Requiring eight digits after every office letter rejects every real
    // House/Senate identifier while accepting a shape the FEC does not issue.
    if (!/^(?:[HS]\d[A-Z]{2}\d{5}|P\d{8})$/.test(row.fecCandidateId)) missing.push(`${row.name}:candidate_id`);
    if (row.principalCommitteeId && !/^C\d{8}$/.test(row.principalCommitteeId)) missing.push(`${row.name}:committee_id`);
    if (row.cycle !== snapshot.cycle) violations.push(`${row.fecCandidateId} cycle ${row.cycle} != snapshot ${snapshot.cycle}.`);
    if (row.totals.coverageEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.totals.coverageEndDate)) violations.push(`${row.fecCandidateId} has an invalid coverage_end_date.`);
  }
  const sourceThrough = snapshot.candidates.map((row) => row.totals.coverageEndDate ?? "").sort().at(-1) || String(snapshot.cycle);
  return {
    id: candidateId("fec-open-api", "federal-supported", rawHash, input.retrievedAt),
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    retrieval: { succeeded: input.rawBodies.length > 0, requestedUrl: "https://api.open.fec.gov/v1/", finalUrl: input.finalUrl, httpStatus: input.rawBodies.length > 0 ? 200 : null, retrievedAt: input.retrievedAt, rawHash: input.rawBodies.length > 0 ? rawHash : null, failureDetail: input.rawBodies.length > 0 ? undefined : "No FEC response bytes were acquired." },
    normalization: { succeeded: true, parserVersion: "fec-funding/2", schemaVersion: `FundingSnapshot:1:cycle-${snapshot.cycle}`, normalizedHash: normalizedHash(snapshot), inputRecords: snapshot.candidates.length, outputRecords: snapshot.candidates.length, droppedRecords: 0, missingRequiredFields: missing },
    identities: snapshot.candidates.map((row) => ({ subjectId: row.fecCandidateId, jurisdiction: "US", identifiers: { candidate_id: row.fecCandidateId, ...(row.principalCommitteeId ? { committee_id: row.principalCommitteeId } : {}) }, matchBasis: row.matchRoutes.every((route) => route === "bioguide-bridge" || route === "roster-person-reuse") ? "OFFICIAL_ID_CROSSWALK" as const : "EXACT_SCOPED_ID" as const, ambiguous: false, office: row.office, district: row.district ?? undefined })),
    temporal: { version: String(snapshot.cycle), expectedVersion: "2026", sourceThrough, staleAtRetrieval: snapshot.candidates.some((row) => row.cycle !== 2026) },
    semantics: { factKind: "FEC-filed candidate/committee totals and itemized receipts", violations },
    horizon: { kind: "OPEN_FACT_SET", query: "individually matched supported federal candidates; no claim that every filing/report class is held", returnedRecords: snapshot.candidates.length, declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/funding/snapshot.ts", passed: snapshot.candidates.length > 0 && new Set(snapshot.candidates.map((row) => row.fecCandidateId)).size === snapshot.candidates.length, detail: `${snapshot.candidates.length} unique FEC candidate projections.` },
      { consumer: "lib/funding/display.ts + grounded Ask", passed: snapshot.candidates.every((row) => row.targetKeys.length > 0 && Number.isFinite(row.totals.receipts)), detail: "Every candidate has a target key and numeric totals." },
    ],
    normalizedPayload: snapshot,
    readModel: snapshot,
    excludedFacts: input.excludedFacts,
  };
}
