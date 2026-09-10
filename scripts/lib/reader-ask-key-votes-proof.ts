import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { allSeatHolders, chamberForOfficeholder } from "../../lib/registry/server.ts";
import { getKeyVotesSnapshot } from "../../lib/votes/key-votes-rows.ts";
import { keyVotePositionKey } from "../../lib/votes/key-vote-positions.ts";
import { getVotesSnapshot, readFederalRollCallsProjection } from "../../lib/votes/snapshot.ts";
import { getFederalKeyVotesReadModel, readFederalKeyVotesProjection } from "../../lib/votes/key-votes-projection.ts";
import { allBillSummaries } from "../../lib/votes/bill-summaries.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import type { EvidencePack } from "../../lib/ask/evidence.ts";

export async function keyVotesAskProof() {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
  const [federalProjection, keyVoteProjection] = await Promise.all([
    readFederalRollCallsProjection(),
    readFederalKeyVotesProjection(),
  ]);
  if (federalProjection.kind !== "PROMOTED" && federalProjection.kind !== "BOOTSTRAP") throw new Error(federalProjection.detail);
  if (keyVoteProjection.kind !== "PROMOTED" && keyVoteProjection.kind !== "BOOTSTRAP") throw new Error(keyVoteProjection.detail);
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const held = getFederalKeyVotesReadModel().positions;
  const keyVotes = getKeyVotesSnapshot();
  const recent = getVotesSnapshot();
  const summaries = allBillSummaries().summaries;
  const proofs = [];
  for (const holder of (await allSeatHolders()).filter((holder) => /^congress:[A-Z]\d{6}$/.test(holder.id))) {
    const chamber = await chamberForOfficeholder(holder.id); if (!chamber) continue;
    const expected = keyVotes.entries.flatMap((entry) => entry[chamber].flatMap((ref) => {
      const key = keyVotePositionKey(entry.id, chamber, ref.congress, ref.session, ref.rollNumber);
      const position = held.positions[key]?.[holder.id];
      return position && ref.url && ref.verifiedAt ? [{ key, position, sourceUrl: ref.url, referenceVerifiedAt: ref.verifiedAt }] : [];
    }));
    const mine = new Set(recent.positions.filter((position) => position.officeholderId === holder.id).map((position) => position.voteId));
    const expectedBills = [...new Set(recent.votes.filter((vote) => mine.has(vote.id) && vote.billUrl && summaries[vote.billUrl]).map((vote) => vote.billUrl!))];
    const request = { question: "How has this person voted on the recorded key questions, and what do the held bills say?", surface: "MAP", ocdIds: [`ocd-division/country:us/state:${holder.state?.toLowerCase() ?? "az"}`], today: "2026-09-04", activeSubjects: [{ id: holder.id, name: holder.name, kind: "PERSON", focused: true }] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-key-votes" }, body: JSON.stringify(request) }));
    const raw = await response.text(); const payload = JSON.parse(raw) as AskAnswerPayload;
    const returned = payload.records.filter((record) => ["KEY_VOTE_CONTEXT", "KEY_VOTE_POSITION", "BILL_SUMMARY"].includes(record.kind));
    const actualPositions = returned.filter((record) => record.kind === "KEY_VOTE_POSITION");
    const actualKeys = actualPositions.flatMap((record) => record.keyVote!.positionKeys);
    const missing = expected.filter((entry) => !actualPositions.some((record) => record.keyVote?.positionKeys.includes(entry.key) && record.keyVote.position === entry.position && record.canonicalSubjectId === holder.id && record.sourceUrl === entry.sourceUrl && record.retrievedAt === held.fetchedAt && record.keyVote.referenceVerifiedAt === entry.referenceVerifiedAt));
    const missingEntries = keyVotes.entries.filter((entry) => !returned.some((record) => record.id === `key-vote-entry:${entry.id}` && record.text.includes(entry.explainer) && record.sourceOrg === entry.explainerSource && record.retrievedAt === entry.explainerReadAt));
    const missingBills = expectedBills.filter((url) => !returned.some((record) => record.kind === "BILL_SUMMARY" && record.id === `bill-summary:${url}` && record.text.includes(summaries[url].summary) && record.sourceUrl === url && record.retrievedAt === summaries[url].curatedAt));
    const unexpectedKeys = actualKeys.filter((key) => !expected.some((entry) => entry.key === key));
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length && payload.denominators.keyVotePositionsReturned === actualPositions.length && payload.denominators.keyVoteContextsReturned === returned.filter((record) => record.kind === "KEY_VOTE_CONTEXT").length && payload.denominators.billSummariesReturned === returned.filter((record) => record.kind === "BILL_SUMMARY").length;
    const pack: EvidencePack = { records: payload.records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, question: request.question, today: request.today, intent: "CIVICS", temporal: { kind: "NONE" } };
    const synthesisReceivesEveryRecord = JSON.stringify(JSON.parse(synthesisContextPayload(pack)).records) === JSON.stringify(payload.records);
    proofs.push({ executionLevel: "REAL_ROUTE_HANDLER", family: "key-votes", subjectId: holder.id, request, httpStatus: response.status, resolvedSubjectId: payload.subject?.id ?? null, expectedNativePositionKeys: expected.map((entry) => entry.key), expectedEntryIds: keyVotes.entries.map((entry) => entry.id), expectedBillUrls: expectedBills, expectedRecordIds: [...expected.map((entry) => `${holder.id}#${entry.key}`), ...keyVotes.entries.map((entry) => entry.id), ...expectedBills], returnedRecordIds: returned.map((record) => record.id), returnedRecords: returned, gaps: payload.gaps, denominators: payload.denominators, payloadSha256: hash(raw), countAgrees, synthesisReceivesEveryRecord, modelAnswer: payload.answer, missing, missingEntries: missingEntries.map((entry) => entry.id), missingBills, unexpectedKeys, status: response.status === 200 && payload.answer === null && countAgrees && synthesisReceivesEveryRecord && !missing.length && !missingEntries.length && !missingBills.length && !unexpectedKeys.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" });
  }
  const paths = ["app/api/ask/grounded/route.ts", "lib/ask/key-votes.ts", "lib/votes/key-votes-reader.ts", "lib/votes/key-votes-rows.ts", "lib/votes/key-vote-positions.ts", "lib/votes/key-votes-projection.ts", "lib/votes/snapshot.ts", "lib/votes/bill-summaries.ts"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", sourceHashScope: "Working-tree actual route and canonical promoted-projection readers; not deployed-build proof.", sourceHashes: paths.map((path) => ({ path, sha256: hash(readFileSync(path)) })), modelDisabled: true, keyEntryCount: keyVotes.entries.length, nativePositionMapCount: Object.keys(held.positions).length, billSummaryCount: Object.keys(summaries).length, proofs };
}
