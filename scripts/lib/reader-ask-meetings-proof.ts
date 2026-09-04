import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readSnapshot } from "../../lib/meetings/snapshot.ts";
import { canonicalBodyIdentity } from "../../lib/ask/body-identity.ts";
import { localDate } from "../../lib/ask/meeting-time.ts";
import { classifyAgendaPublication } from "../../lib/ask/agenda-publication.ts";
import { getOutcomeSnapshot } from "../../lib/outcomes/store.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { EvidencePack, EvidenceRecord } from "../../lib/ask/evidence.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import type { Meeting } from "../../lib/sources/types.ts";

type Expected = Pick<EvidenceRecord, "id" | "kind" | "bodyId" | "sourceUrl" | "sourceOrg" | "retrievedAt"> & Partial<Pick<EvidenceRecord, "text" | "occurredAt">>;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export async function meetingsAskProof(progress: (message: string) => void = () => {}) {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const snapshot = readSnapshot();
  if (!snapshot) throw new Error("Canonical meetings snapshot unavailable");
  const groups = new Map<string, Meeting[]>();
  const unbound: { meetingId: string; reason: string }[] = [];
  for (const meeting of snapshot.meetings) {
    if (!meeting.bodyId || !canonicalBodyIdentity(meeting.bodyId)) {
      unbound.push({ meetingId: meeting.id, reason: "No canonical body identity for this held meeting; no nearby or same-name body's record may be attached." });
      continue;
    }
    const key = `${meeting.bodyId}|${localDate(meeting)}`;
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }
  const documents = snapshot.agendaDocuments ?? [];
  const outcomes = getOutcomeSnapshot();
  const documentDispositions: { id: string; meetingId: string; documentUrl: string; sourceUrl: string; sourceOrg: string; contentHash: string; retrievedAt: string; acquisition: string; expectedRecordIds: string[]; reason: string | null }[] = [];
  async function prove(family: string, group: (Pick<Meeting, "id" | "bodyId" | "ocdId" | "startsAt"> & { timeZone?: string })[], question: string, kinds: EvidenceRecord["kind"][], expected: Expected[], requestedDate = localDate(group[0]), structuredAgendaOnly = false) {
    const meeting = group[0];
    const bodyId = meeting.bodyId!;
    const request = { question, surface: "MAP", ocdIds: [meeting.ocdId].filter((id): id is string => Boolean(id)), activeSubjects: [{ id: bodyId, name: canonicalBodyIdentity(bodyId)!.name, kind: "BODY", focused: true }] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-meetings" }, body: JSON.stringify(request) }));
    const raw = await response.text();
    const payload = JSON.parse(raw) as AskAnswerPayload;
    const actual = payload.records.filter((record) => kinds.includes(record.kind) && (!structuredAgendaOnly || record.id.endsWith("#agenda")));
    const missing = expected.filter((record) => !actual.some((row) => Object.entries(record).every(([key, value]) => row[key as keyof EvidenceRecord] === value)));
    const expectedKeys = new Set(expected.map((record) => `${record.kind}:${record.id}`));
    const unexpected = actual.filter((record) => !expectedKeys.has(`${record.kind}:${record.id}`));
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length &&
      (!kinds.includes("MEETING_MEMBER_VOTE") || payload.denominators.personVoteRowsInPack === actual.filter((record) => record.kind === "MEETING_MEMBER_VOTE").length);
    const pack: EvidencePack = { question, subject: payload.subject, records: payload.records, gaps: payload.gaps, denominators: payload.denominators, intent: "PAST_MEETING", temporal: { kind: "DATE", localDate: requestedDate }, today: new Date().toISOString().slice(0, 10) };
    const synthesisReceivesEveryRecord = JSON.stringify((JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] }).records) === JSON.stringify(payload.records);
    return { family, executionLevel: "REAL_ROUTE_HANDLER", request, subjectId: bodyId, meetingIds: group.map((row) => row.id), httpStatus: response.status, resolvedSubjectId: payload.subject?.id ?? null, mode: payload.mode, expectedRecordIds: expected.map((record) => record.id), expectedRecords: expected, returnedRecordIds: actual.map((record) => record.id), returnedRecords: actual, payloadSha256: hash(raw), payloadBytes: Buffer.byteLength(raw), countAgrees, synthesisReceivesEveryRecord, actualRecordCount: payload.records.length, traceRecordCount: payload.trace.retrieval.recordCount, denominators: payload.denominators, gaps: payload.gaps, missing, unexpected, modelAnswer: payload.answer, status: response.status === 200 && payload.subject?.id === bodyId && payload.answer === null && countAgrees && synthesisReceivesEveryRecord && !missing.length && !unexpected.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" };
  }
  const proofs = [];
  for (const group of groups.values()) {
    const expected: Expected[] = group.map((meeting) => ({ kind: "MEETING", id: meeting.id, bodyId: meeting.bodyId, occurredAt: meeting.startsAt, sourceUrl: meeting.provenance.sourceUrl ?? meeting.agendaUrl ?? null, sourceOrg: meeting.provenance.sourceOrg, retrievedAt: meeting.provenance.collectedAt }));
    for (const meeting of group) {
      const sitting = outcomes.sittings.find((row) => row.meetingId === meeting.id && row.bodyId === meeting.bodyId && row.extraction === "RETRIEVED");
      for (const rec of sitting?.agenda ?? []) expected.push({ kind: "AGENDA_ITEM", id: `${rec.eventItemId}#agenda`, bodyId: meeting.bodyId, text: rec.title, occurredAt: meeting.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
      const held = documents.filter((document) => document.meetingId === meeting.id);
      const newest = [...held].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))[0];
      const publication = classifyAgendaPublication({ bodyName: canonicalBodyIdentity(meeting.bodyId!)!.name, meetingId: meeting.id, documentsForMeeting: held, documentsAcrossCorpus: documents, discoveredDocumentUrl: meeting.agendaUrl, observations: [], now: Date.now() });
      const recordIds: string[] = [];
      if (newest && publication.acquisition === "ITEMS_READER_READY") for (const [index, item] of publication.items.entries()) {
        const id = `${meeting.id}#${index}`;
        recordIds.push(id);
        expected.push({ kind: "AGENDA_ITEM", id, bodyId: meeting.bodyId, text: item, occurredAt: meeting.startsAt, sourceUrl: newest.documentUrl, sourceOrg: newest.sourceOrg ?? null, retrievedAt: newest.retrievedAt });
      }
      if (newest && publication.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX") {
        recordIds.push(newest.documentUrl);
        expected.push({ kind: "AGENDA_DOCUMENT", id: newest.documentUrl, bodyId: meeting.bodyId, sourceUrl: newest.documentUrl, sourceOrg: newest.sourceOrg ?? null, retrievedAt: newest.retrievedAt });
      }
      for (const document of held) documentDispositions.push({ id: document.id, meetingId: meeting.id, documentUrl: document.documentUrl, sourceUrl: document.sourceUrl, sourceOrg: document.sourceOrg, contentHash: document.contentHash, retrievedAt: document.retrievedAt, acquisition: document === newest ? publication.acquisition : "SUPERSEDED_REVISION", expectedRecordIds: document === newest ? recordIds : [], reason: document === newest ? publication.gap?.statement ?? null : "The canonical meeting projection selects the latest held revision, preserving the older acquisition as inventory." });
    }
    proofs.push(await prove("meetings-and-agendas", group, `What was on this body's agenda on ${localDate(group[0])}?`, ["MEETING", "AGENDA_ITEM", "AGENDA_DOCUMENT"], expected));
    if (proofs.length % 100 === 0) progress(`Executed ${proofs.length}/${groups.size} local body-date meeting queries`);
  }
  const outcomeGroups = new Set(outcomes.sittings.filter((sitting) => sitting.startsAt && sitting.bodyId).map((sitting) => `${sitting.bodyId}|${sitting.startsAt!.slice(0, 10)}`));
  for (const key of outcomeGroups) {
    const date = key.slice(key.lastIndexOf("|") + 1);
    const bodyId = key.slice(0, key.lastIndexOf("|"));
    const group = outcomes.sittings.filter((sitting) => sitting.bodyId === bodyId && sitting.startsAt?.slice(0, 10) === date).map((sitting) => ({ id: sitting.meetingId, bodyId, ocdId: sitting.ocdId, startsAt: sitting.startsAt!, timeZone: snapshot.meetings.find((meeting) => meeting.id === sitting.meetingId)?.timeZone }));
    const sittingIds = new Set(group.map((meeting) => meeting.id));
    const held = outcomes.sittings.filter((sitting) => sittingIds.has(sitting.meetingId) && sitting.extraction === "RETRIEVED");
    for (const kind of ["MEETING_MEMBER_VOTE", "MEETING_ACTION", "AGENDA_ITEM"] as const) {
      const expected: Expected[] = [];
      for (const sitting of held) {
        const meeting = group.find((row) => row.id === sitting.meetingId)!;
        if (kind === "MEETING_MEMBER_VOTE") for (const rec of sitting.rollCalls) for (const vote of rec.votes.filter((vote) => vote.personName && vote.value)) expected.push({ kind, id: `${rec.eventItemId}#${vote.personId ?? vote.personName}`, bodyId: sitting.bodyId, occurredAt: meeting.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
        if (kind === "MEETING_ACTION") for (const rec of sitting.outcomes) expected.push({ kind, id: `${rec.eventItemId}#action`, bodyId: sitting.bodyId, occurredAt: meeting.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
        if (kind === "AGENDA_ITEM") for (const rec of sitting.agenda) expected.push({ kind, id: `${rec.eventItemId}#agenda`, bodyId: sitting.bodyId, text: rec.title, occurredAt: meeting.startsAt, sourceUrl: rec.provenance.endpoint, sourceOrg: rec.provenance.sourceOrg, retrievedAt: rec.provenance.readOn === "NEVER_READ" ? null : rec.provenance.readOn });
      }
      proofs.push(await prove("meeting-outcomes", group, `${kind === "MEETING_MEMBER_VOTE" ? "How did this body's members vote" : kind === "MEETING_ACTION" ? "What did this body decide" : "What was on this body's agenda"} on ${date}?`, [kind], expected, date, kind === "AGENDA_ITEM"));
    }
  }
  const paths = ["app/api/ask/grounded/route.ts", "lib/ask/select.ts", "lib/ask/meeting-date.ts", "lib/ask/meeting-time.ts", "lib/ask/meeting-outcomes.ts", "lib/ask/agenda-publication.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts", "lib/ask/synthesize.ts", "lib/meetings/snapshot.ts", "lib/outcomes/store.ts", "data/meetings-snapshot.json", "data/states/az/outcomes/legistar-outcomes.json"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", sourceHashScope: "Exact source-handler bytes; the real clock is unchanged, and this is not deployed-build proof.", sourceHashes: paths.map((path) => ({ path, sha256: hash(readFileSync(path)) })), modelDisabled: true, meetingDenominator: snapshot.meetings.length, documentDenominator: documents.length, outcomeSittingDenominator: outcomes.sittings.length, unbound, documentDispositions, proofs };
}
