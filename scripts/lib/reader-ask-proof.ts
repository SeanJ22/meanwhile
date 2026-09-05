import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { allSeatHolders } from "../../lib/registry/server.ts";
import { rosterGapForBody, type RosterReaderGap } from "../../lib/registry/body-rosters.ts";
import { getVotesSnapshot } from "../../lib/votes/snapshot.ts";
import { getStateVotesSnapshot } from "../../lib/sources/legiscan/snapshot.ts";
import { bodyIdentityIndex } from "../../lib/ask/body-identity.ts";
import { snapshotEntities, titleCaseName } from "../../lib/ask/inventory.ts";
import { contactsForBody, contactRecord } from "../../lib/ask/contacts.ts";
import { executiveActionStore, actionText } from "../../lib/officials/executive-actions.ts";
import { localFinanceEvidenceFor } from "../../lib/ask/local-finance.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { EvidenceRecord, EvidencePack } from "../../lib/ask/evidence.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const SOURCE_PATHS = ["app/api/ask/grounded/route.ts", "lib/ask/votes.ts", "lib/ask/contacts.ts", "lib/ask/local-finance.ts", "lib/ask/official-identity.ts", "lib/registry/server.ts", "lib/funding/official-candidacies.json", "data/votes/votes-snapshot.json", "data/votes/state-votes-snapshot.json", "data/states/az/officials/az-governor-actions.json", "data/states/az/campaign-finance/az-pima-2026-held.json", "data/states/az/campaign-finance/az-pima-2026-transactions.json"];

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
export async function exhaustiveAskProof(progress: (message: string) => void = () => {}) {
  delete process.env.ANTHROPIC_API_KEY;
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
  const state = getStateVotesSnapshot();
  const federalById = new Map(federal.votes.map((vote) => [vote.id, vote]));
  const stateById = new Map(state.rollCalls.map((vote) => [vote.id, vote]));
  const votingIds = [...new Set([...federal.positions, ...state.positions].map((position) => position.officeholderId))].sort();
  for (const [index, id] of votingIds.entries()) {
    const holder = holders.get(id);
    if (!holder) throw new Error(`Held vote subject missing canonical official: ${id}`);
    const expected: ExpectedRecord[] = [
      ...federal.positions.filter((position) => position.officeholderId === id).map((position) => {
        const vote = federalById.get(position.voteId)!;
        return { id: `${id}#${position.voteId}`, sourceUrl: vote.rollCallUrl, retrievedAt: vote.retrievedAt };
      }),
      ...state.positions.filter((position) => position.officeholderId === id).map((position) => {
        const vote = stateById.get(position.rollCallId)!;
        return { id: `${id}#${position.rollCallId}`, sourceUrl: vote.rollCallUrl, retrievedAt: vote.retrievedAt };
      }),
    ];
    await prove("recorded-votes", id, holder.name, "PERSON", [`ocd-division/country:us/state:${holder.state?.toLowerCase() ?? "az"}`], "How has this person voted?", ["ROLL_CALL_VOTE"], expected);
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
    sourceHashes: SOURCE_PATHS.map((path) => ({ path, sha256: hash(readFileSync(path, "utf8")) })), proofs };
}
