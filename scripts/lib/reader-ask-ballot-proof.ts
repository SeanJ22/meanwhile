import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { BALLOT_SOURCES } from "../../lib/ballot/registry.ts";
import { getMeasureAnalyses } from "../../lib/ballot/analyses.ts";
import { summaryForContest } from "../../lib/ballot/measure-summary.ts";
import { provisionsForContest } from "../../lib/ballot/measure-provisions.ts";
import { absencesWithoutRemovals, removalRecords } from "../../lib/ask/ballot-inventory.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import type { EvidencePack, EvidenceRecord } from "../../lib/ask/evidence.ts";

type Expected = Pick<EvidenceRecord, "kind" | "id" | "sourceUrl"> & Partial<Pick<EvidenceRecord, "sourceOrg" | "retrievedAt" | "text">>;
const hash = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");

export async function ballotAskProof() {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const proofs = [];
  const denominator = { contests: 0, candidacies: 0, measures: 0, absences: 0, removals: 0, adoptedAnalyses: 0 };
  async function prove(family: string, nativeIds: string[], ocdId: string, subject: { id: string; name: string; kind: "PERSON" | "CONTEST" | "MEASURE" } | null, question: string, expected: Expected[]) {
    const request = { question, surface: "BALLOT", ocdIds: [ocdId], activeSubjects: subject ? [{ ...subject, focused: true }] : [] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-ballot" }, body: JSON.stringify(request) }));
    const raw = await response.text();
    const payload = JSON.parse(raw) as AskAnswerPayload;
    const kinds = new Set(expected.map((record) => record.kind));
    const returned = payload.records.filter((record) => kinds.has(record.kind));
    const missing = expected.filter((record) => !returned.some((actual) => Object.entries(record).every(([key, value]) => actual[key as keyof EvidenceRecord] === value)));
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length;
    const pack: EvidencePack = { records: payload.records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, question, today: new Date().toISOString().slice(0, 10), intent: "CIVICS", temporal: { kind: "NONE" } };
    const synthesisReceivesEveryRecord = JSON.stringify((JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] }).records) === JSON.stringify(payload.records);
    const ownCandidateOnly = subject?.kind !== "PERSON" || returned.filter((record) => record.kind === "CANDIDACY").every((record) => nativeIds.includes(record.id));
    return { family, nativeIds, subjectId: subject?.id ?? null, executionLevel: "REAL_ROUTE_HANDLER", request, expectedRecords: expected, expectedRecordIds: expected.map((record) => record.id), returnedRecords: returned, returnedRecordIds: returned.map((record) => record.id), httpStatus: response.status, mode: payload.mode, resolvedSubjectId: payload.subject?.id ?? null, payloadSha256: hash(raw), countAgrees, synthesisReceivesEveryRecord, actualRecordCount: payload.records.length, traceRecordCount: payload.trace.retrieval.recordCount, denominators: payload.denominators, gaps: payload.gaps, missing, ownCandidateOnly, modelAnswer: payload.answer, status: response.status === 200 && payload.answer === null && countAgrees && synthesisReceivesEveryRecord && ownCandidateOnly && !missing.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" };
  }
  for (const { source } of BALLOT_SOURCES) {
    const set = source.normalize(await source.fetch());
    denominator.contests += set.contests.length;
    denominator.candidacies += set.candidacies.length;
    denominator.measures += set.measures.length;
    denominator.absences += set.absences.length;
    denominator.removals += set.removals?.length ?? 0;
    for (const contest of set.contests) {
      const expected: Expected[] = [{ kind: "CONTEST", id: contest.id, sourceUrl: contest.provenance.sourceUrl, sourceOrg: contest.provenance.sourceOrg, retrievedAt: contest.provenance.collectedAt }];
      for (const measure of set.measures.filter((row) => row.contestId === contest.id)) {
        expected.push({ kind: "MEASURE_QUESTION", id: measure.id, text: measure.questionText, sourceUrl: measure.provenance.sourceUrl, sourceOrg: measure.provenance.sourceOrg, retrievedAt: measure.provenance.collectedAt });
        if (measure.officialStatement) expected.push({ kind: "MEASURE_STATEMENT", id: `${measure.id}#statement`, text: measure.officialStatement, sourceUrl: measure.provenance.sourceUrl, sourceOrg: measure.provenance.sourceOrg, retrievedAt: measure.provenance.collectedAt });
      }
      const analysis = getMeasureAnalyses()?.analyses.find((row) => row.contestId === contest.id);
      if (analysis?.text && analysis.extraction !== "failed") {
        denominator.adoptedAnalyses += 1;
        expected.push({ kind: "MEASURE_ANALYSIS", id: `${contest.id}#analysis`, text: analysis.text, sourceUrl: analysis.analysisUrl, sourceOrg: analysis.sourceOrg, retrievedAt: analysis.retrievedAt });
      }
      const summary = summaryForContest(contest.id);
      if (summary) expected.push({ kind: "MEASURE_SUMMARY", id: `${contest.id}#summary`, text: summary.summary, sourceUrl: summary.summarizesUrl });
      for (const provision of provisionsForContest(contest.id)) expected.push({ kind: "MEASURE_PROVISION", id: provision.id, text: `${provision.label}: ${provision.what}`, sourceUrl: provision.citesUrl });
      const isMeasure = contest.type === "MEASURE";
      proofs.push(await prove("ballot-contests-measures", [contest.id, ...set.measures.filter((row) => row.contestId === contest.id).map((row) => row.id)], contest.ocdId, { id: contest.id, name: contest.title, kind: isMeasure ? "MEASURE" : "CONTEST" }, isMeasure ? "What does this measure say?" : "What is recorded about this contest?", expected));
    }
    for (const candidate of set.candidacies) {
      const contest = set.contests.find((row) => row.id === candidate.contestId)!;
      proofs.push(await prove("ballot-candidacies", [candidate.id], contest.ocdId, { id: candidate.id, name: `${candidate.givenName} ${candidate.familyName}`, kind: "PERSON" }, "What filing records are held for this person?", [{ kind: "CANDIDACY", id: candidate.id, sourceUrl: candidate.provenance.sourceUrl, sourceOrg: candidate.provenance.sourceOrg, retrievedAt: candidate.provenance.collectedAt }]));
    }
    for (const absence of absencesWithoutRemovals(set.absences, set.removals ?? [])) proofs.push(await prove("ballot-absence", [absence.ocdId], absence.ocdId, null, "What elections are absent from my ballot?", [{ kind: "BALLOT_ABSENCE", id: `absence:${absence.ocdId}`, text: absence.statement, sourceUrl: absence.provenance.sourceUrl, sourceOrg: absence.provenance.sourceOrg, retrievedAt: absence.provenance.collectedAt }]));
    for (const removal of set.removals ?? []) proofs.push(await prove("ballot-removal", [removal.id], set.contests.find((contest) => contest.id === removal.contestId)!.ocdId, { id: removal.id, name: `${removal.givenName} ${removal.familyName}`, kind: "PERSON" }, "What filing records are held for this person?", removalRecords(removal)));
  }
  const paths = ["app/api/ask/grounded/route.ts", "lib/ask/ballot-inventory.ts", "lib/ask/server-sources.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts", "lib/ask/relevance.ts", "lib/ask/synthesize.ts", "lib/ballot/analyses.ts", "lib/ballot/general-lineup.ts", "lib/identity/az-2026.ts", "data/states/az/ballot/az-pima-2026.json", "data/states/nh/ballot/nh-merrimack-2026.json", "data/states/nj/ballot/nj-morris-2026.json", "data/states/az/ballot/az-analyses-2026.json", "data/states/az/ballot/measure-summaries.json"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", sourceHashScope: "Exact current handler and holding bytes; not deployed proof.", sourceHashes: paths.map((path) => ({ path, sha256: hash(readFileSync(path)) })), modelDisabled: true, denominator, proofs };
}
