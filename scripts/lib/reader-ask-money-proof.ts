import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { BALLOT_SOURCES } from "../../lib/ballot/registry.ts";
import { stateMoneyForTarget, stateMoneySources } from "../../lib/funding/state-snapshot.ts";
import { stateMoneyRecordsForDisplay } from "../../lib/funding/state-money-reader.ts";
import type { StateMoneySnapshot } from "../../lib/funding/state-money.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import { synthesisContextPayload } from "../../lib/ask/synthesize.ts";
import type { EvidencePack, EvidenceRecord } from "../../lib/ask/evidence.ts";

export async function stateMoneyAskProof() {
delete process.env.ANTHROPIC_API_KEY;
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const sets = await Promise.all(BALLOT_SOURCES.map(async ({ source }) => source.normalize(await source.fetch())));
const candidates = new Map(sets.flatMap((set) => set.candidacies).map((row) => [row.id, row]));
const contests = new Map(sets.flatMap((set) => set.contests).map((row) => [row.id, row]));
const paths = stateMoneySources().map((file) => `data/states/${/^state-money-([a-z]{2})-/.exec(file)![1]}/funding/${file}`);
const targets = [...new Set(paths.flatMap((path) => (JSON.parse(readFileSync(path, "utf8")) as StateMoneySnapshot).records.flatMap((record) => record.targetKeys)))];
const proofs = [];
const dispositions = [];
for (const target of targets) {
  const expected = stateMoneyRecordsForDisplay(stateMoneyForTarget(target));
  if (!expected.length) { dispositions.push({ target, status: "NOT_READER_ELIGIBLE", reason: "Canonical reader selector withholds staged or unresolved finance." }); continue; }
  const candidate = candidates.get(target);
  if (!candidate) { dispositions.push({ target, status: "IDENTITY_UNRESOLVED", reason: "No canonical current or source-ballot candidacy with this exact target identity." }); continue; }
  const contest = contests.get(candidate.contestId)!;
  const request = { question: "What campaign money has this person raised and spent, and what filing records do we hold?", surface: "BALLOT", ocdIds: [contest.ocdId], today: "2026-09-04", activeSubjects: [{ id: candidate.id, name: `${candidate.givenName} ${candidate.familyName}`, kind: "PERSON", focused: true }] };
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-money" }, body: JSON.stringify(request) }));
  const text = await response.text();
  const payload = JSON.parse(text) as AskAnswerPayload;
  const finance = payload.records.filter((record) => record.kind === "FINANCE_SUMMARY" && record.id.startsWith("state-money:"));
  const expectedIds = expected.flatMap((record, index) => record.filingState === "OURS_GAP" ? [] : [`state-money:${target}:${record.committeeId ?? record.filingState}:${index}`]);
  const missing = expected.flatMap((record, index) => {
    if (record.filingState === "OURS_GAP") {
      const statement = record.ourGap?.whatIsMissing ?? "We have not resolved this campaign-finance identity.";
      return payload.gaps.some((gap) => gap.whose === "OURS" && gap.statement === statement) && payload.denominators.financeIdentityUnresolved >= 1
        ? [] : [{ expectedId: `${target}#OURS_GAP`, holding: record, actual: undefined }];
    }
    const expectedId = `state-money:${target}:${record.committeeId ?? record.filingState}:${index}`;
    const actual = finance.find((row) => row.id === expectedId);
    const valid = actual && actual.canonicalSubjectId === target && actual.finance?.filingState === record.filingState && JSON.stringify(actual.finance?.totals) === JSON.stringify(record.totals) && actual.sourceOrg === record.provenance.sourceOrg && actual.sourceUrl === (record.filingsUrl ?? record.provenance.sourceUrl) && actual.retrievedAt === record.checkedAt;
    return valid ? [] : [{ expectedId, holding: record, actual }];
  });
  const unexpected = finance.filter((record) => !expectedIds.includes(record.id));
  const countAgrees = payload.trace.retrieval.recordCount === payload.records.length && payload.denominators.stateFinanceRecordsReturned === finance.length && finance.length === expectedIds.length;
  const pack: EvidencePack = { records: payload.records, gaps: payload.gaps, denominators: payload.denominators, subject: payload.subject, question: request.question, today: request.today, intent: "CIVICS", temporal: { kind: "NONE" } };
  const synthesisReceivesEveryRecord = JSON.stringify((JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[] }).records) === JSON.stringify(payload.records);
  proofs.push({ target, executionLevel: "REAL_ROUTE_HANDLER", request, httpStatus: response.status, mode: payload.mode, resolvedSubject: payload.subject, expectedRecordIds: expectedIds, expectedFinance: expected, returnedRecords: finance, returnedRecordIds: finance.map((record) => record.id), gaps: payload.gaps, denominators: payload.denominators, payloadSha256: hash(text), countAgrees, synthesisReceivesEveryRecord, actualRecordCount: payload.records.length, traceRecordCount: payload.trace.retrieval.recordCount, modelAnswer: payload.answer, missing, unexpected, status: response.status === 200 && payload.answer === null && countAgrees && synthesisReceivesEveryRecord && !missing.length && !unexpected.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" });
}
const sourcePaths = ["app/api/ask/grounded/route.ts", "lib/ask/subject.ts", "lib/ask/resolve.ts", "lib/ask/ballot-inventory.ts", "lib/ask/campaign-money.ts", "lib/ask/synthesize.ts", "lib/funding/state-money-reader.ts", "lib/funding/campaign-money.ts", "lib/funding/official-candidacies.json", ...paths];
const result = { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", sourceHashScope: "Exact current source/holding bytes; deployed bundle proof is separate.", sourceHashes: sourcePaths.map((path) => ({ path, sha256: hash(readFileSync(path)) })), modelDisabled: true, targetDenominator: targets.length, proofs, dispositions };
return result;
}
