import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { MINUTES_SUMMARIES } from "../../lib/meetings/minutes-summaries.ts";
import type { CommentAccess } from "../../lib/registry/comment-access.ts";
import { NOTICE_SUMMARIES } from "../../lib/meetings/notice-summary.ts";
import type { MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";
import { canonicalBodyIdentity } from "../../lib/ask/body-identity.ts";
import { localDate } from "../../lib/ask/meeting-time.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import type { EvidenceRecord, EvidencePack } from "../../lib/ask/evidence.ts";

export async function meetingKnowledgeAskProof(options: {
  readonly snapshot: MeetingsSnapshot;
  readonly commentAccess: readonly CommentAccess[];
}) {
  delete process.env.ANTHROPIC_API_KEY;
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const snapshot = options.snapshot;
  type Expected = Pick<EvidenceRecord, "id" | "kind" | "bodyId" | "text" | "sourceUrl" | "retrievedAt"> & Partial<Pick<EvidenceRecord, "sourceOrg" | "occurredAt" | "accessRule" | "noticeSummary">>;
  async function prove(family: string, nativeId: string, bodyId: string, ocdId: string | null, question: string, kind: EvidenceRecord["kind"], expected: Expected[]) {
    const identity = canonicalBodyIdentity(bodyId);
    if (!identity) throw new Error(`No canonical body identity for ${nativeId}`);
    const request = { question, surface: "MAP", ocdIds: ocdId ? [ocdId] : [], activeSubjects: [{ id: bodyId, name: identity.name, kind: "BODY", focused: true }] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-meeting-knowledge" }, body: JSON.stringify(request) }));
    const raw = await response.text();
    const payload = JSON.parse(raw) as AskAnswerPayload;
    const records = payload.records.filter((record) => record.kind === kind);
    const missing = expected.filter((record) => !records.some((actual) => Object.entries(record).every(([key, value]) => JSON.stringify(actual[key as keyof EvidenceRecord]) === JSON.stringify(value))));
    const unexpected = records.filter((record) => !expected.some((row) => row.id === record.id));
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length && records.length === expected.length;
    const pack: EvidencePack = { question, records: payload.records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, today: new Date().toISOString().slice(0, 10), intent: "CIVICS", temporal: { kind: "NONE" } };
    const synthesisReceivesEveryRecord = JSON.stringify((JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] }).records) === JSON.stringify(payload.records);
    return { family, nativeId, bodyId, executionLevel: "REAL_ROUTE_HANDLER", request, httpStatus: response.status, mode: payload.mode, resolvedSubjectId: payload.subject?.id ?? null, expectedRecordIds: expected.map((record) => record.id), expectedRecords: expected, returnedRecordIds: records.map((record) => record.id), returnedRecords: records, missing, unexpected, gaps: payload.gaps, denominators: payload.denominators, payloadSha256: hash(raw), countAgrees, synthesisReceivesEveryRecord, modelAnswer: payload.answer, actualRecordCount: payload.records.length, traceRecordCount: payload.trace.retrieval.recordCount, status: response.status === 200 && payload.subject?.id === bodyId && payload.answer === null && countAgrees && synthesisReceivesEveryRecord && !missing.length && !unexpected.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" };
  }
  const proofs = [];
  for (const summary of NOTICE_SUMMARIES) {
    const meeting = snapshot.meetings.find((row) => row.id === summary.meetingId);
    const document = [...(snapshot.agendaDocuments ?? [])].filter((row) => row.meetingId === summary.meetingId).sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))[0];
    if (!meeting?.bodyId || !document || document.contentHash !== summary.contentHash || document.documentUrl !== summary.summarizesUrl) throw new Error(`Notice summary is outside the current exact document identity: ${summary.meetingId}`);
    proofs.push(await prove("notice-summaries", summary.meetingId, meeting.bodyId, meeting.ocdId, `What is in this body's meeting notice on ${localDate(meeting)}?`, "MEETING_NOTICE_SUMMARY", [{ kind: "MEETING_NOTICE_SUMMARY", id: `${meeting.id}#notice-summary:${document.contentHash}`, bodyId: meeting.bodyId, text: `Meanwhile's plain-language summary of this meeting notice: ${summary.summary}`, occurredAt: meeting.startsAt, sourceUrl: summary.summarizesUrl, sourceOrg: document.sourceOrg ?? null, retrievedAt: document.retrievedAt, noticeSummary: { documentId: document.id, contentHash: document.contentHash, writtenAt: summary.writtenAt } }]));
  }
  for (const summary of MINUTES_SUMMARIES) {
    const meeting = snapshot.meetings.find((row) => row.id === summary.meetingId);
    if (!meeting?.bodyId) throw new Error(`No canonical meeting/body identity for minutes ${summary.meetingId}`);
    proofs.push(await prove("minutes-summaries", summary.meetingId, meeting.bodyId, meeting.ocdId, `What happened at this body's meeting on ${localDate(meeting)}?`, "MEETING_MINUTES_SUMMARY", [{ kind: "MEETING_MINUTES_SUMMARY", id: `${summary.meetingId}#minutes-summary`, bodyId: meeting.bodyId, text: `Meanwhile's plain-language summary of the source record: ${summary.summary}`, occurredAt: meeting.startsAt, sourceUrl: summary.minutesUrl, sourceOrg: summary.sourceOrg, retrievedAt: summary.readAt }]));
  }
  for (const access of options.commentAccess) {
    const bodyName = canonicalBodyIdentity(access.bodyId)?.name;
    if (!bodyName) throw new Error(`No canonical comment-access body: ${access.bodyId}`);
    const fields = ["commentPeriodDetail", "timeLimit", "signup", "writtenComment", "attend"] as const;
    const period = access.commentPeriod === "YES" ? "These standing rules provide a public-comment period." : "These standing rules do not provide a public-comment period.";
    const expected: Expected[] = [{ kind: "PUBLIC_COMMENT_ACCESS", id: `${access.bodyId}#comment-access:commentPeriod`, bodyId: access.bodyId, text: `Standing public-comment rules: ${period} These are the body's published standing rules, not a verified change for a particular meeting.`, sourceUrl: access.sourceUrl, retrievedAt: access.collectedAt, accessRule: { field: "commentPeriod", value: access.commentPeriod, standingRule: true } }];
    for (const field of fields) if (access[field]) expected.push({ kind: "PUBLIC_COMMENT_ACCESS", id: `${access.bodyId}#comment-access:${field}`, bodyId: access.bodyId, text: access[field], sourceUrl: access.sourceUrl, retrievedAt: access.collectedAt, accessRule: { field, value: access[field], standingRule: true } });
    proofs.push(await prove("comment-access", access.bodyId, access.bodyId, access.ocdId, "How can I speak, submit written comments, sign up, or attend this body's meetings?", "PUBLIC_COMMENT_ACCESS", expected));
  }
  const paths = ["app/api/ask/grounded/route.ts", "lib/ask/meeting-knowledge.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts", "lib/registry/comment-access.ts", "lib/meetings/minutes-summaries.ts", "lib/meetings/notice-summary.ts", "lib/meetings/snapshot.ts", "lib/civic-data/meeting-partitions.ts", "data/states/az/meetings/notice-summaries.json"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", modelDisabled: true, sourceHashes: paths.map((path) => ({ path, sha256: hash(readFileSync(path)) })), noticeDenominator: NOTICE_SUMMARIES.length, summaryDenominator: MINUTES_SUMMARIES.length, accessDenominator: options.commentAccess.length, proofs };
}
