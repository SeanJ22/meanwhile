import { createHash } from "node:crypto";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { sourceProjectionEvidence, type RoutineCandidate, type SourceCheckEvidence } from "../../civic-data/types.ts";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { holdRawCapture, type RawCaptureRef } from "../../civic-data/raw-capture-vault.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";

import { PLURAL_STATES } from "./targets.ts";

export function pluralVoteState(state: string): string {
  const normalized = state.toLowerCase();
  if (!PLURAL_STATES.includes(normalized)) throw new Error(`PLURAL_VOTE_STATE_UNSUPPORTED:${state}`);
  return normalized;
}
export const pluralVotesScope = (state: string) => `US-${pluralVoteState(state).toUpperCase()}:openstates-votes:v1`;
export const pluralVotesContract = (state: string) => `openstates-votes-${pluralVoteState(state)}`;
export const pluralVoteJurisdiction = (state: string) => `ocd-jurisdiction/country:us/${pluralVoteState(state) === "dc" ? "district:dc" : pluralVoteState(state) === "pr" ? "territory:pr" : `state:${pluralVoteState(state)}`}/government`;
export const PLURAL_VOTES_SOURCE = "plural-openstates-votes";
export const PLURAL_VOTES_PARSER = "plural-votes/2";
const id = (value: unknown, kind: string) => typeof value === "string" && new RegExp(`^ocd-${kind}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sessionId = (value: unknown) => text(value) || text(object(value).identifier);
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");
const url = (value: unknown) => {
  try { const parsed = new URL(text(value)); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null; } catch { return null; }
};
const pluralVoteEvidenceUrl = (value: string, state: string) => {
  try { const source = new URL(value); return source.protocol === "https:" && !source.username && !source.password &&
    (source.hostname === "v3.openstates.org" && source.pathname.startsWith("/bills/") || source.hostname === "data.openstates.org" && source.pathname.startsWith(`/csv/latest/${state}_`) && source.pathname.endsWith(".zip")); }
  catch { return false; }
};
const day = (value: unknown) => {
  const valueText = text(value), date = valueText.slice(0, 10);
  const parsed = Date.parse(date);
  return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(valueText) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
};

/** Vendor-native votes retain their intermediary provenance and literal publisher labels. */
export interface PluralVoteFact {
  id: string; billId: string; billNumber: string; billTitle: string; session: string;
  organizationId: string; chamber: "upper" | "lower" | "legislature"; date: string; motion: string; result: string;
  counts: { option: string; value: number }[];
  positions: { personId: string; option: string; retrievedAt: string }[];
  unresolvedPositions: number;
  sourceUrls: string[]; sourceApiUrl: string; retrievedAt: string;
}
export interface PluralVotesProjection { formatVersion: 1; state: string; rollCalls: PluralVoteFact[] }
export interface PluralBillEvidence { requestedUrl: string; finalUrl: string; body: string; retrievedAt: string; sha256: string; sourceCheck?: SourceCheckEvidence; vaultKey?: string }
/** Held evidence keeps a raw-capture reference; a bulk archive (empty body) keeps its release vault key. */
export type PluralVoteAcquisition = Omit<PluralBillEvidence, "body"> & { raw?: RawCaptureRef };

/** A malformed vote is isolated. Complete neighboring votes still publish independently. */
export function parsePluralBill(state: string, evidence: PluralBillEvidence): { votes: PluralVoteFact[]; held: { key: string; detail: string }[] } {
  const source = new URL(evidence.finalUrl);
  if (source.origin !== "https://v3.openstates.org" || !source.pathname.startsWith("/bills/")) throw new Error("PLURAL_VOTE_SOURCE_ROUTE_INVALID");
  if (hash(evidence.body) !== evidence.sha256 || !Number.isFinite(Date.parse(evidence.retrievedAt))) throw new Error("PLURAL_VOTE_SOURCE_EVIDENCE_INVALID");
  const bill = object(JSON.parse(evidence.body));
  const session = sessionId(bill.session) || sessionId(bill.legislative_session);
  if (!id(bill.id, "bill") || object(bill.jurisdiction).id !== pluralVoteJurisdiction(state) || !session || !text(bill.identifier) || !text(bill.title) || !Array.isArray(bill.votes)) {
    throw new Error("PLURAL_BILL_IDENTITY_OR_VOTE_SHAPE_INVALID");
  }
  if (decodeURIComponent(source.pathname.replace(/\/$/, "").slice("/bills/".length)) !== bill.id) throw new Error("PLURAL_BILL_ROUTE_IDENTITY_MISMATCH");
  const votes: PluralVoteFact[] = [], held: { key: string; detail: string }[] = [];
  const seen = new Set<string>();
  for (const [index, value] of bill.votes.entries()) {
    const vote = object(value), voteId = text(vote.id), key = voteId || `${bill.id}:vote:${index}`;
    try {
      const organization = object(vote.organization), date = day(vote.start_date), voteSession = sessionId(vote.legislative_session) || session;
      if (!id(vote.id, "vote") || seen.has(voteId) || !id(organization.id, "organization") || !["upper", "lower", "legislature"].includes(text(organization.classification)) ||
          !date || date > evidence.retrievedAt.slice(0, 10) || voteSession !== session || !text(vote.motion_text) || !text(vote.result) ||
          !Array.isArray(vote.votes) || !Array.isArray(vote.counts)) throw new Error("native vote identity, session, date, motion or positions are unresolved");
      seen.add(voteId);
      const positions: PluralVoteFact["positions"] = [], people = new Map<string, string>(), conflicts = new Set<string>();
      let unresolvedPositions = 0;
      for (const value of vote.votes) {
        const position = object(value), directId = text(position.voter_id), nestedId = text(object(position.voter).id), personId = directId || nestedId, option = text(position.option);
        if (directId && nestedId && directId !== nestedId) throw new Error("the native voter identifiers disagree");
        if (!id(personId, "person") || !option) { unresolvedPositions++; continue; }
        if (conflicts.has(personId)) { unresolvedPositions++; continue; }
        const previous = people.get(personId);
        if (previous && previous !== option) {
          conflicts.add(personId); unresolvedPositions += 2;
          held.push({ key: `${voteId}:${personId}`, detail: "the same native person has conflicting publisher positions" });
          continue;
        }
        if (previous) continue;
        people.set(personId, option); positions.push({ personId, option, retrievedAt: evidence.retrievedAt });
      }
      const resolvedPositions = positions.filter(position => !conflicts.has(position.personId));
      if (!resolvedPositions.length) throw new Error("no exact native person position was acquired");
      const counts = vote.counts.map(value => {
        const count = object(value);
        if (!text(count.option) || !Number.isSafeInteger(count.value) || Number(count.value) < 0) throw new Error("publisher count is invalid");
        return { option: text(count.option), value: Number(count.value) };
      });
      if (new Set(counts.map(row => row.option)).size !== counts.length) throw new Error("publisher count repeats an option");
      const sourceUrls = (Array.isArray(vote.sources) ? vote.sources : []).flatMap(value => {
        const parsed = url(object(value).url); return parsed ? [parsed] : [];
      });
      votes.push({ id: voteId, billId: String(bill.id), billNumber: text(bill.identifier), billTitle: text(bill.title), session,
        organizationId: text(organization.id), chamber: text(organization.classification) as PluralVoteFact["chamber"], date,
        motion: text(vote.motion_text), result: text(vote.result), counts, positions: resolvedPositions, unresolvedPositions,
        sourceUrls: [...new Set(sourceUrls)], sourceApiUrl: evidence.finalUrl, retrievedAt: evidence.retrievedAt });
    } catch (error) { held.push({ key, detail: error instanceof Error ? error.message : String(error) }); }
  }
  // A repeated native vote is ambiguous, even if one duplicate happened to parse first.
  const duplicates = new Set(bill.votes.map(value => text(object(value).id)).filter((value, at, all) => value && all.indexOf(value) !== at));
  return { votes: votes.filter(vote => !duplicates.has(vote.id)), held };
}

export function mergePluralVotes(state: string, prior: PluralVotesProjection | null, incoming: readonly PluralVoteFact[]): PluralVotesProjection {
  if (prior && prior.state !== pluralVoteState(state).toUpperCase()) throw new Error("PLURAL_VOTE_STATE_MISMATCH");
  const votes = new Map(prior?.rollCalls.map(vote => [vote.id, vote]) ?? []);
  for (const vote of incoming) {
    const old = votes.get(vote.id);
    if (old && (old.billId !== vote.billId || old.session !== vote.session || old.organizationId !== vote.organizationId)) throw new Error("PLURAL_VOTE_NATIVE_IDENTITY_CONFLICT");
    if (!old || vote.retrievedAt >= old.retrievedAt) {
      const positions = new Map(old?.positions.map(position => [position.personId, position]) ?? []);
      for (const position of vote.positions) positions.set(position.personId, position);
      votes.set(vote.id, { ...vote, positions: [...positions.values()] });
    }
  }
  return { formatVersion: 1, state: pluralVoteState(state).toUpperCase(), rollCalls: [...votes.values()].sort((left, right) => left.id.localeCompare(right.id)) };
}

export function pluralVotesProjectionIssue(value: PluralVotesProjection): string | null {
  if (value?.formatVersion !== 1 || !PLURAL_STATES.includes(value.state?.toLowerCase()) || !Array.isArray(value.rollCalls)) return "PLURAL_VOTE_PROJECTION_INVALID";
  if (new Set(value.rollCalls.map(vote => vote.id)).size !== value.rollCalls.length) return "PLURAL_VOTE_DUPLICATE";
  for (const vote of value.rollCalls) {
    if (!id(vote.id, "vote") || !id(vote.billId, "bill") || !id(vote.organizationId, "organization") || !vote.session || !day(vote.date) ||
      !["upper", "lower", "legislature"].includes(vote.chamber) || !vote.motion || !vote.result || !vote.billNumber || !vote.billTitle ||
      !Number.isFinite(Date.parse(vote.retrievedAt)) || vote.date > vote.retrievedAt.slice(0, 10) || !pluralVoteEvidenceUrl(vote.sourceApiUrl, value.state) ||
      !Number.isSafeInteger(vote.unresolvedPositions) || vote.unresolvedPositions < 0 || !Array.isArray(vote.sourceUrls) || vote.sourceUrls.some(value => url(value) !== value) ||
      !Array.isArray(vote.counts) || vote.counts.some(count => !text(count.option) || !Number.isSafeInteger(count.value) || count.value < 0) ||
      new Set(vote.counts.map(count => count.option)).size !== vote.counts.length ||
      !Array.isArray(vote.positions) || !vote.positions.length || vote.positions.some(position => !id(position.personId, "person") || !position.option || !Number.isFinite(Date.parse(position.retrievedAt)) || position.retrievedAt > vote.retrievedAt) ||
      new Set(vote.positions.map(position => position.personId)).size !== vote.positions.length) return "PLURAL_VOTE_NATIVE_FACT_INVALID";
  }
  return null;
}

export async function pluralVotesCandidate(input: { projection: PluralVotesProjection; acquired: readonly PluralBillEvidence[]; held: readonly { key: string; detail: string }[];
  checkedAt: string; vault: EvidenceStore }): Promise<RoutineCandidate> {
  const { projection } = input, issue = pluralVotesProjectionIssue(projection);
  const sourceThrough = input.acquired.map(row => row.retrievedAt).sort().at(-1) ?? input.checkedAt;
  const evidence = [...input.acquired].sort((left, right) => left.retrievedAt.localeCompare(right.retrievedAt)).at(-1);
  const acquisitions = await Promise.all(input.acquired.map(async ({ body, ...row }): Promise<PluralVoteAcquisition> =>
    body ? { ...row, raw: await holdRawCapture(input.vault, PLURAL_VOTES_SOURCE, body, "application/json") } : row));
  const payload = { acquisitions, held: input.held };
  return { id: `cv-${hash(`${PLURAL_VOTES_SOURCE}:${hash(projection)}:${input.checkedAt}`).slice(0, 32)}`,
    sourceId: PLURAL_VOTES_SOURCE, recordClass: "STATE_ROLL_CALL", scope: pluralVotesScope(projection.state),
    sourceProjectionEvidence: sourceProjectionEvidence(PLURAL_VOTES_SOURCE, "STATE_ROLL_CALL", pluralVotesScope(projection.state)),
    retrieval: { succeeded: input.acquired.length > 0, requestedUrl: evidence?.requestedUrl ?? "https://v3.openstates.org/bills",
      finalUrl: evidence?.finalUrl ?? null, httpStatus: 200, retrievedAt: sourceThrough, rawHash: evidence?.sha256 ?? hash(input.acquired.map(row => row.sha256).sort()),
      ...(evidence?.sourceCheck ? { sourceCheck: evidence.sourceCheck } : {}) },
    normalization: { succeeded: !issue, parserVersion: PLURAL_VOTES_PARSER, schemaVersion: "plural-native-votes/1",
      normalizedHash: hash(projection), normalizedPayloadHash: hash(payload), inputRecords: projection.rollCalls.length, outputRecords: projection.rollCalls.length,
      droppedRecords: 0, missingRequiredFields: [] },
    identities: projection.rollCalls.map(vote => ({ subjectId: vote.id, jurisdiction: `US-${projection.state}`, chamber: vote.chamber,
      term: vote.session, session: vote.session, identifiers: { rollCallId: vote.id, eventId: vote.id, billId: vote.billId }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
    temporal: { version: sourceThrough, expectedVersion: sourceThrough, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "Plural's native state vote events and exact person positions", violations: issue ? [issue] : [] },
    horizon: { kind: "OPEN_FACT_SET", query: "Known state bill details, each acquired native vote independently", returnedRecords: projection.rollCalls.length,
      declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "native state person vote reader", passed: !issue, detail: "Only exact OpenStates person IDs join. A partial acquisition never removes held votes." }],
    civicRecords: projection.rollCalls.map(record => ({ key: `roll:${record.id}`, record })),
    excludedFacts: input.held.map(row => ({ ...row, code: "PLURAL_VOTE_UNRESOLVED" })), normalizedPayload: payload, readModel: projection };
}

export async function readPluralVotesProjection(state: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<PluralVotesProjection>("STATE_ROLL_CALL", pluralVotesScope(state), options);
  if (read.kind === "PROMOTED" && (read.metadata.sourceId !== PLURAL_VOTES_SOURCE || pluralVotesProjectionIssue(read.value) || read.value.state !== pluralVoteState(state).toUpperCase())) throw new Error("PLURAL_VOTES_READER_INVALID");
  return read;
}
export async function readPluralVotesForPerson(state: string, personId: string, options: PromotedCivicDataReadOptions = {}): Promise<(PluralVoteFact & { position: string })[]> {
  if (!id(personId, "person")) return [];
  const read = await readPluralVotesProjection(state, options);
  if (read.kind === "NOT_RECORDED") return [];
  if (read.kind !== "PROMOTED") throw new Error("PLURAL_VOTES_UNAVAILABLE");
  return read.value.rollCalls.flatMap(vote => {
    const position = vote.positions.find(position => position.personId === personId);
    return position ? [{ ...vote, position: position.option, retrievedAt: position.retrievedAt }] : [];
  }).sort((left, right) => right.date.localeCompare(left.date));
}
