import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { allSeatHolders } from "../../lib/registry/server.ts";
import { rosterGapForBody, type RosterReaderGap } from "../../lib/registry/body-rosters.ts";
import { heldOfficialStateLegislators } from "../../lib/state-rollcalls/legislators.ts";
import { officialStateVoteScopeForOfficeholderId } from "../../lib/state-rollcalls/authority.ts";
import { getVotesSnapshot, readFederalRollCallsProjection } from "../../lib/votes/snapshot.ts";
import { readAllProvenFederalVoteHistoryForProof } from "../../lib/votes/history.ts";
import { summaryForBill } from "../../lib/votes/bill-summaries.ts";
import {
  readAvailableOfficialStateVotes,
  type AvailableOfficialStateVotes,
  type OfficialStateVoteScope,
} from "../../lib/sources/legiscan/snapshot.ts";
import { bodyIdentityIndex } from "../../lib/ask/body-identity.ts";
import { snapshotEntities, titleCaseName } from "../../lib/ask/inventory.ts";
import { contactsForBody, contactRecord } from "../../lib/ask/contacts.ts";
import { executiveActionStore, actionText } from "../../lib/officials/executive-actions.ts";
import { localFinanceEvidenceFor } from "../../lib/ask/local-finance.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { EvidenceRecord, EvidencePack } from "../../lib/ask/evidence.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const SOURCE_PATHS = ["app/api/ask/grounded/route.ts", "lib/ask/votes.ts", "lib/ask/key-votes.ts", "lib/ask/contacts.ts", "lib/ask/local-finance.ts", "lib/ask/official-identity.ts", "lib/registry/server.ts", "lib/funding/campaign-money.ts", "lib/registry/runtime-data-plane.ts", "lib/registry/runtime-read-model.ts", "lib/votes/snapshot.ts", "lib/votes/history.ts", "lib/votes/data-plane.ts", "lib/sources/legiscan/snapshot.ts", "lib/state-rollcalls/authority.ts", "lib/officials/executive-actions.ts", "lib/civic-data/read-model.ts", "data/states/az/campaign-finance/az-pima-2026-held.json", "data/states/az/campaign-finance/az-pima-2026-transactions.json"];

interface ExpectedRecord { id: string; sourceUrl?: string | null; retrievedAt?: string | null; text?: string }
interface DeliveryProof {
  executionLevel: string;
  family: string;
  subjectId: string;
  request: { question: string; surface: string; ocdIds: string[]; today: string; activeSubjects: { id: string; name: string; kind: "PERSON" | "BODY"; focused: boolean }[] };
  httpStatus: number;
  mode: AskAnswerPayload["mode"];
  resolvedSubjectId: string | null;
  payloadSha256: string;
  payloadBytes: number;
  modelAnswer: string | null;
  expectedRecords: ExpectedRecord[];
  expectedRecordIds: string[];
  returnedRecordIds: string[];
  returnedRecords: EvidenceRecord[];
  contacts: AskAnswerPayload["contacts"] | null;
  expectedRosterGap: RosterReaderGap | null;
  rosterGapRecords: EvidenceRecord[];
  rosterGapAgrees: boolean;
  denominators: Record<string, number>;
  actualRecordCount: number;
  traceRecordCount: number;
  countAgrees: boolean;
  synthesisReceivesEveryRecord: boolean;
  missingRecords: ExpectedRecord[];
  unexpectedRecords: EvidenceRecord[];
  gaps: AskAnswerPayload["gaps"];
  status: string;
}
export interface ExhaustiveAskProofOptions {
  readonly readStateVotes?: () => Promise<AvailableOfficialStateVotes>;
}

export async function exhaustiveAskProof(
  progress: (message: string) => void = () => {},
  options: ExhaustiveAskProofOptions = {},
) {
  delete process.env.ANTHROPIC_API_KEY;
  const federalProjection = await readFederalRollCallsProjection();
  if (federalProjection.kind !== "PROMOTED" && federalProjection.kind !== "BOOTSTRAP") throw new Error(federalProjection.detail);
  // This local synthetic corpus walk has its own test budget; production intake is unchanged.
  process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const proofs: DeliveryProof[] = [];
  async function prove(family: string, subjectId: string, name: string, kind: "PERSON" | "BODY", ocdIds: string[], question: string, recordKind: EvidenceRecord["kind"][], expected: ExpectedRecord[]): Promise<DeliveryProof> {
    const request = { question, surface: "MAP", ocdIds, today: "2026-09-04", activeSubjects: [{ id: subjectId, name, kind, focused: true }] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-exhaustive" }, body: JSON.stringify(request) }));
    const raw = await response.text();
    if (!raw) throw new Error(`Ask returned ${response.status} without a payload for ${subjectId}`);
    const payload = JSON.parse(raw) as AskAnswerPayload;
    const returned = (payload.records ?? []).filter((record) => recordKind.includes(record.kind));
    const expectedIds = new Set(expected.map((record) => record.id));
    const missing = expected.filter((record) => !returned.some((actual) => actual.id === record.id &&
      (record.sourceUrl === undefined || actual.sourceUrl === record.sourceUrl) &&
      (record.retrievedAt === undefined || actual.retrievedAt === record.retrievedAt) &&
      (record.text === undefined || actual.text === record.text)));
    const unexpected = returned.filter((record) => !expectedIds.has(record.id));
    const contacts = recordKind.includes("CONTACT") ? payload.contacts : null;
    const expectedRosterGap = rosterGapForBody(subjectId);
    const rosterGapRecords = payload.records.filter((record) => record.kind === "ROSTER_IDENTITY_GAP");
    const rosterGapAgrees = expectedRosterGap ? rosterGapRecords.length === 1 &&
      JSON.stringify(rosterGapRecords[0].rosterGap) === JSON.stringify(expectedRosterGap) &&
      payload.gaps.some((gap) => gap.whose === "OURS" && gap.statement === expectedRosterGap.statement) &&
      payload.denominators.rosterExpectedMembers === expectedRosterGap.expectedMembers &&
      payload.denominators.rosterVerifiedMembers === expectedRosterGap.verifiedMembers : rosterGapRecords.length === 0;
    const pack: EvidencePack = { records: payload.records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, question, today: request.today, intent: "CIVICS", temporal: { kind: "NONE" } };
    const modelInput = JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] };
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length && (!contacts || (contacts.length === payload.denominators.verifiedContacts && contacts.length === returned.length));
    const synthesisReceivesEveryRecord = JSON.stringify(modelInput.records) === JSON.stringify(payload.records);
    const proof = { executionLevel: "REAL_ROUTE_HANDLER", family, subjectId, request, httpStatus: response.status, mode: payload.mode, resolvedSubjectId: payload.subject?.id ?? null,
      payloadSha256: hash(raw), payloadBytes: Buffer.byteLength(raw), modelAnswer: payload.answer, expectedRecords: expected, expectedRecordIds: [...expectedIds],
      returnedRecordIds: payload.records.map((record) => record.id), returnedRecords: returned, contacts, expectedRosterGap, rosterGapRecords, rosterGapAgrees, denominators: payload.denominators,
      actualRecordCount: payload.records.length, traceRecordCount: payload.trace.retrieval.recordCount, countAgrees, synthesisReceivesEveryRecord,
      missingRecords: missing, unexpectedRecords: unexpected, gaps: payload.gaps,
      status: response.status === 200 && payload.answer === null && countAgrees && rosterGapAgrees && synthesisReceivesEveryRecord && missing.length === 0 && unexpected.length === 0 ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" };
    proofs.push(proof);
    return proof;
  }

  const holders = new Map((await allSeatHolders()).map((holder) => [holder.id, holder]));
  const federal = getVotesSnapshot();
  // The proven read model, not bypassCache (R29): a fresh proof process proves
  // each state's pointer in full on its first read either way, and the Ask
  // route's own later reads of the same pointers share that proof instead of
  // downloading every official state vote again.
  const stateAuthority = await (options.readStateVotes ?? (() => readAvailableOfficialStateVotes({})))();
  const stateSnapshots = stateAuthority.promoted.map(({ snapshot }) => snapshot);
  const state = {
    rollCalls: stateSnapshots.flatMap((snapshot) => snapshot.rollCalls),
    positions: stateSnapshots.flatMap((snapshot) => snapshot.positions),
  };
  // State legislators live in per-jurisdiction promoted projections, not the
  // federal-only allSeatHolders() roster (lib/registry/server.ts admits the
  // federal roster only; state legislators remain in a separate projection).
  // Resolve every promoted state-vote subject through the same authority the
  // live reader uses — officialStateVoteScopeForOfficeholderId ->
  // heldOfficialStateLegislators, mirroring officialStateVoteSeat in
  // lib/ask/votes.ts — so the join below proves against what production serves.
  // A subject absent from BOTH the federal set and its scope's promoted roster
  // still trips the guard: this widens the holder universe, it does not stop checking.
  const stateLegislatorScopes = [
    ...new Set(
      state.positions
        .map((position) => officialStateVoteScopeForOfficeholderId(position.officeholderId))
        .filter((scope): scope is OfficialStateVoteScope => scope !== null),
    ),
  ];
  for (const scope of stateLegislatorScopes) {
    const roster = await heldOfficialStateLegislators(scope);
    for (const seat of roster?.seats ?? []) holders.set(seat.id, seat);
  }
  const federalById = new Map(federal.votes.map((vote) => [vote.id, vote]));
  const federalPositions = new Map<string, (typeof federal.positions)[number]>(federal.positions.map((position) =>
    [`${position.officeholderId}#${position.voteId}`, position] as const));
  const historicalVersions = federalProjection.kind === "PROMOTED"
    ? await readAllProvenFederalVoteHistoryForProof(federalProjection) : [];
  for (const version of historicalVersions) {
    for (const vote of version.value.snapshot.votes) if (!federalById.has(vote.id)) federalById.set(vote.id, vote);
    for (const position of version.value.snapshot.positions) {
      const key = `${position.officeholderId}#${position.voteId}`;
      if (!federalPositions.has(key)) federalPositions.set(key, position);
    }
  }
  const stateById = new Map(state.rollCalls.map((vote) => [vote.id, vote]));
  const votingIds = [...new Set([...federalPositions.values(), ...state.positions]
    .map((position) => position.officeholderId))].sort();
  for (const [index, id] of votingIds.entries()) {
    const holder = holders.get(id);
    if (!holder) throw new Error(`Held vote subject missing canonical official: ${id}`);
    const expected: ExpectedRecord[] = [
      ...[...federalPositions.values()].filter((position) => position.officeholderId === id).map((position) => {
        const vote = federalById.get(position.voteId)!;
        return { id: `${id}#${position.voteId}`, sourceUrl: vote.rollCallUrl, retrievedAt: vote.retrievedAt };
      }),
      ...state.positions.filter((position) => position.officeholderId === id).map((position) => {
        const vote = stateById.get(position.rollCallId)!;
        return { id: `${id}#${position.rollCallId}`, sourceUrl: vote.rollCallUrl, retrievedAt: vote.retrievedAt };
      }),
    ];
    const summaryUrls = new Set<string>();
    for (const position of federalPositions.values()) if (position.officeholderId === id) {
      const billUrl = federalById.get(position.voteId)?.billUrl;
      if (billUrl && summaryForBill(billUrl)) summaryUrls.add(billUrl);
    }
    for (const billUrl of summaryUrls) expected.push({ id: `bill-summary:${billUrl}`,
      sourceUrl: billUrl, retrievedAt: summaryForBill(billUrl)!.curatedAt });
    await prove("recorded-votes", id, holder.name, "PERSON", [`ocd-division/country:us/state:${holder.state?.toLowerCase() ?? "az"}`], "How has this person voted?", ["ROLL_CALL_VOTE", "BILL_SUMMARY"], expected);
    if ((index + 1) % 100 === 0) progress(`Executed ${index + 1}/${votingIds.length} voting officials`);
  }
  for (const body of bodyIdentityIndex().values()) {
    const readerName = titleCaseName(snapshotEntities([body], () => body)[0].name);
    const expected = contactsForBody(body, readerName).map(contactRecord);
    if (!expected.length) continue;
    const ids = body.ocdId ? [body.ocdId.split("/").slice(0, 3).join("/"), body.ocdId] : [];
    await prove("body-contacts", body.bodyId, body.name, "BODY", [...new Set(ids)], "Who sits on this body?", ["CONTACT"], expected);
  }
  const actions = executiveActionStore()!;
  for (const id of [...new Set(actions.actions.map((action) => action.officeholderId))]) {
    const held = actions.actions.filter((action) => action.officeholderId === id);
    await prove("official-actions", id, held[0].officeholderName, "PERSON", [held[0].ocdId], "What actions are recorded for this person?", ["OFFICIAL_ACTION"], held.map((action) => ({ id: action.id, text: actionText(action), sourceUrl: action.documentUrl ?? action.sourceUrl, retrievedAt: action.collectedAt })));
  }
  const vailId = "ocd-division/country:us/state:az/school_district:vail_unified_district#board";
  const vail = { kind: "BODY" as const, id: vailId, name: "Vail Unified School District Governing Board" };
  const local = localFinanceEvidenceFor(vail)!;
  await prove("local-finance", vail.id, vail.name, "BODY", ["ocd-division/country:us/state:az", vailId.split("#")[0]], "What campaign money is recorded for this body?", ["FINANCE_COMMITTEE", "FINANCE_TRANSACTION"], local.records);
  return { purpose: "Exhaustive real POST delivery for every held voting official, every canonical body with projected contacts, all held official actions without a time filter, and the current resolved local-finance body. Expected vote IDs come directly from held snapshots. This is not proof for nonexecuted record families.", modelDisabled: true,
    exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", sourceHashScope: "Working-tree source bytes; not a deployed build proof",
    stateVoteAuthorityReadbacks: stateAuthority.readbacks,
    sourceHashes: SOURCE_PATHS.map((path) => ({ path, sha256: hash(readFileSync(path, "utf8")) })), proofs };
}
