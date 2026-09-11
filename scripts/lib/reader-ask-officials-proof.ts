import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { allSeatHolders } from "../../lib/registry/server.ts";
import { currentBodyRosters, rosterGapForBody } from "../../lib/registry/body-rosters.ts";
import { officeholderEvidence } from "../../lib/ask/officeholder.ts";
import { contactForOfficeholder } from "../../lib/ask/contacts.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import type { EvidencePack, EvidenceRecord } from "../../lib/ask/evidence.ts";

/** Every exact held official identity; this query makes no geographical claim. */
export async function officialsAskProof(progress: (message: string) => void = () => {}) {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const holders = await allSeatHolders();
  const bodyRosters = currentBodyRosters();
  const proofs = [];
  for (const holder of holders) {
    const expected = officeholderEvidence(holder);
    const expectedContact = contactForOfficeholder(holder);
    const request = { question: "What office does this person hold, and what does the source roster state about their term?", surface: "MAP", ocdIds: [], activeSubjects: [{ id: holder.id, name: holder.name, kind: "PERSON", focused: true }] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-officials" }, body: JSON.stringify(request) }));
    const raw = await response.text();
    const payload = JSON.parse(raw) as AskAnswerPayload;
    const records = payload.records.filter((record) => record.kind === "OFFICEHOLDER");
    const rosterGapRecords = payload.records.filter((record) => record.kind === "ROSTER_IDENTITY_GAP");
    const expectedRosterGap = bodyRosters.filter((roster) => roster.members.some((member) => member.id === holder.id)).map((roster) => rosterGapForBody(roster.bodyId)).find((gap) => gap !== null) ?? null;
    const rosterGapAgrees = expectedRosterGap ? rosterGapRecords.length === 1 && JSON.stringify(rosterGapRecords[0].rosterGap) === JSON.stringify(expectedRosterGap) && payload.gaps.some((gap) => gap.whose === "OURS" && gap.statement === expectedRosterGap.statement) : rosterGapRecords.length === 0;
    const actual = records.find((record) => record.canonicalSubjectId === holder.id);
    const missing = !actual || Object.entries(expected).some(([key, value]) => JSON.stringify(actual[key as keyof EvidenceRecord]) !== JSON.stringify(value)) ? [expected] : [];
    const unexpected = records.filter((record) => record.canonicalSubjectId !== holder.id);
    const contact = payload.contacts.find((row) => row.id === expectedContact.id);
    const contactAgrees = JSON.stringify(contact) === JSON.stringify(expectedContact);
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length && records.length === 1 && payload.denominators.verifiedContacts === payload.contacts.length;
    const pack: EvidencePack = { question: request.question, records: payload.records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, today: new Date().toISOString().slice(0, 10), intent: "CIVICS", temporal: { kind: "NONE" } };
    const synthesisReceivesEveryRecord = JSON.stringify((JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] }).records) === JSON.stringify(payload.records);
    proofs.push({ nativeId: holder.id, executionLevel: "REAL_ROUTE_HANDLER", request, httpStatus: response.status, mode: payload.mode, resolvedSubjectId: payload.subject?.id ?? null, expectedRecordIds: [expected.id], expectedRecords: [expected], returnedRecordIds: records.map((record) => record.id), returnedRecords: records, expectedContact, contacts: payload.contacts, contactAgrees, expectedRosterGap, rosterGapRecords, rosterGapAgrees, missing, unexpected, gaps: payload.gaps, denominators: payload.denominators, payloadSha256: hash(raw), countAgrees, synthesisReceivesEveryRecord, modelAnswer: payload.answer, actualRecordCount: payload.records.length, traceRecordCount: payload.trace.retrieval.recordCount, status: response.status === 200 && payload.subject?.id === holder.id && payload.answer === null && countAgrees && contactAgrees && rosterGapAgrees && synthesisReceivesEveryRecord && !missing.length && !unexpected.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" });
    if (proofs.length % 250 === 0) progress(`Executed ${proofs.length}/${holders.length} exact official queries`);
  }
  const paths = ["app/api/ask/grounded/route.ts", "lib/ask/officeholder.ts", "lib/ask/contacts.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts", "lib/registry/server.ts", "lib/registry/body-rosters.ts", "lib/registry/rosters-nj-morris.ts", "lib/officials/lookup.ts", "lib/officials/statewide-executives.ts", "lib/registry/officeholders-us.json"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", modelDisabled: true, sourceHashes: paths.map((path) => ({ path, sha256: hash(readFileSync(path)) })), officialDenominator: holders.length, termNoteDenominator: holders.filter((holder) => holder.termNote).length, proofs };
}
