import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BALLOT_SOURCES } from "../../lib/ballot/registry.ts";
import { lineupForContest } from "../../lib/ballot/general-lineup.ts";
import { ballotAskInventory } from "../../lib/ask/ballot-inventory.ts";
import { getFundingSnapshot, refreshFundingFromPromoted } from "../../lib/funding/snapshot.ts";
import { fundingAnswerForTarget } from "../../lib/funding/display.ts";
import { seatHolderById } from "../../lib/registry/server.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import type { EvidencePack, EvidenceRecord } from "../../lib/ask/evidence.ts";

/** Every existing FEC primary answer, through the actual Ask handler. */
export async function federalMoneyAskProof() {
  await refreshFundingFromPromoted();
  delete process.env.ANTHROPIC_API_KEY;
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const identities = new Map<string, { id: string; name: string; ocdIds: string[] }>();
  for (const { source } of BALLOT_SOURCES) {
    const set = source.normalize(await source.fetch());
    const contests = new Map(set.contests.map((contest) => [contest.id, contest]));
    for (const candidate of set.candidacies) {
      const contest = contests.get(candidate.contestId);
      if (contest) identities.set(candidate.id, { id: candidate.id, name: `${candidate.givenName} ${candidate.familyName}`, ocdIds: [contest.ocdId] });
    }
    for (const subject of ballotAskInventory(set, set.contests, (id) => lineupForContest(id)?.nominees ?? []).subjects.values()) {
      if (subject.kind === "PERSON") identities.set(subject.id, { id: subject.id, name: subject.name, ocdIds: [subject.ocdId] });
    }
  }
  const snapshot = getFundingSnapshot();
  const sourceRows = [
    ...snapshot.candidates.map((record) => ({ nativeId: record.fecCandidateId, nativeKind: "candidate", targets: record.targetKeys })),
    ...snapshot.absences.map((record) => ({ nativeId: record.targetKey, nativeKind: "absence", targets: [record.targetKey] })),
  ];
  const proofs = [];
  for (const source of sourceRows) {
    for (const target of source.targets) if (!identities.has(target)) {
      const holder = await seatHolderById(target);
      if (holder) identities.set(target, { id: target, name: holder.name, ocdIds: [] });
    }
    const target = source.targets.find((key) => identities.has(key));
    const identity = target ? identities.get(target) : null;
    if (!target || !identity) {
      proofs.push({ ...source, executionLevel: "NOT_EXECUTED", status: "IDENTITY_UNRESOLVED", reason: "No exact held source candidacy or official ID resolves this FEC target." });
      continue;
    }
    const expected = fundingAnswerForTarget(target);
    if (expected.kind === "none") throw new Error(`Held FEC primary answer disappeared from its selector: ${source.nativeId}`);
    const expectedRecord: Pick<EvidenceRecord, "id" | "canonicalSubjectId" | "text" | "sourceUrl" | "sourceOrg" | "retrievedAt"> = expected.kind === "funding"
      ? { id: `fec:${expected.data.fecCandidateId}`, canonicalSubjectId: expected.data.fecCandidateId, text: expected.data.sentences.join(" "), sourceUrl: expected.data.sourceUrl, sourceOrg: expected.data.sourceOrg, retrievedAt: expected.data.collectedAt }
      : { id: `fec-absence:${target}`, canonicalSubjectId: target, text: expected.data.statement, sourceUrl: expected.data.searchUrl, sourceOrg: "Federal Election Commission", retrievedAt: expected.data.checkedAt };
    const request = { question: "What campaign money has this person raised and spent, and what federal filing records do we hold?", surface: "BALLOT", ocdIds: identity.ocdIds, activeSubjects: [{ id: identity.id, name: identity.name, kind: "PERSON", focused: true }] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-federal-money" }, body: JSON.stringify(request) }));
    const raw = await response.text();
    const payload = JSON.parse(raw) as AskAnswerPayload;
    const finance = payload.records.filter((record) => record.kind === "FINANCE_SUMMARY" && /^fec[:\-]/.test(record.id));
    const actual = finance.find((record) => record.id === expectedRecord.id);
    const missing = !actual || Object.entries(expectedRecord).some(([key, value]) => actual[key as keyof EvidenceRecord] !== value) ? [expectedRecord] : [];
    const unexpected = finance.filter((record) => record.id !== expectedRecord.id);
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length && payload.denominators.federalFinanceRecordsReturned === finance.length && finance.length === 1;
    const pack: EvidencePack = { question: request.question, records: payload.records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, today: new Date().toISOString().slice(0, 10), intent: "CIVICS", temporal: { kind: "NONE" } };
    const synthesisReceivesEveryRecord = JSON.stringify((JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] }).records) === JSON.stringify(payload.records);
    proofs.push({ ...source, target, executionLevel: "REAL_ROUTE_HANDLER", request, httpStatus: response.status, mode: payload.mode, resolvedSubject: payload.subject, expectedRecordIds: [expectedRecord.id], expectedRecords: [expectedRecord], returnedRecordIds: finance.map((record) => record.id), returnedRecords: finance, payloadSha256: hash(raw), gaps: payload.gaps, denominators: payload.denominators, modelAnswer: payload.answer, countAgrees, synthesisReceivesEveryRecord, actualRecordCount: payload.records.length, traceRecordCount: payload.trace.retrieval.recordCount, missing, unexpected, status: response.status === 200 && payload.answer === null && countAgrees && synthesisReceivesEveryRecord && !missing.length && !unexpected.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" });
  }
  const paths = ["app/api/ask/grounded/route.ts", "lib/ask/campaign-money.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts", "lib/ask/ballot-inventory.ts", "lib/funding/campaign-money.ts", "lib/funding/display.ts", "lib/funding/snapshot.ts", "data/fec/fec-2026.json"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", modelDisabled: true, sourceHashes: paths.map((path) => ({ path, sha256: hash(readFileSync(path)) })), candidateDenominator: snapshot.candidates.length, absenceDenominator: snapshot.absences.length, proofs };
}
