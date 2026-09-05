import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { allCandidateCards } from "../../lib/ballot/candidate-cards.ts";
import { allCandidateLinks } from "../../lib/ballot/candidate-sites.ts";
import { BALLOT_SOURCES } from "../../lib/ballot/registry.ts";
import { lineupForContest } from "../../lib/ballot/general-lineup.ts";
import { ballotAskInventory } from "../../lib/ask/ballot-inventory.ts";
import { candidateProfileEvidenceFor } from "../../lib/ask/candidate-profile.ts";
import { reconciledCandidacyIdForCard } from "../../lib/identity/az-2026.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";

export async function candidateProfileAskProof() {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const identities = new Map<string, { id: string; name: string; ocdId: string }>();
  for (const { source } of BALLOT_SOURCES) {
    const set = source.normalize(await source.fetch());
    const contests = new Map(set.contests.map(contest => [contest.id, contest]));
    for (const candidate of set.candidacies) {
      const contest = contests.get(candidate.contestId);
      if (contest) identities.set(candidate.id, { id: candidate.id, name: `${candidate.givenName} ${candidate.familyName}`, ocdId: contest.ocdId });
    }
    const inventory = ballotAskInventory(set, set.contests, id => lineupForContest(id)?.nominees ?? []);
    for (const subject of inventory.subjects.values()) if (subject.kind === "PERSON") {
      identities.set(subject.id, { id: subject.id, name: subject.name, ocdId: subject.ocdId });
      const canonical = reconciledCandidacyIdForCard(subject.id) ?? subject.candidacyId;
      if (canonical) identities.set(canonical, { id: subject.id, name: subject.name, ocdId: subject.ocdId });
    }
  }
  const cards = allCandidateCards().cards;
  const links = allCandidateLinks().links;
  const keys = [...new Set([...Object.keys(cards), ...Object.keys(links)])].sort();
  const proofs = [];
  for (const key of keys) {
    const expected = candidateProfileEvidenceFor({ kind: "PERSON", id: key, name: key }).records.filter(record => record.candidateProfile?.holdingKey === key);
    if (!expected.length) continue;
    const identity = identities.get(key);
    if (!identity) {
      proofs.push({ nativeHoldingKey: key, status: "IDENTITY_UNRESOLVED", executionLevel: "NOT_EXECUTED", expectedRecords: expected, reason: "No exact current or held source-ballot candidacy identity was found for this native profile key." });
      continue;
    }
    const request = { question: "What biography, published contact information, and verified campaign and official pages do we hold for this person?", surface: "BALLOT", ocdIds: [identity.ocdId], today: "2026-09-04", activeSubjects: [{ id: identity.id, name: identity.name, kind: "PERSON", focused: true }] };
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-candidate-profile" }, body: JSON.stringify(request) }));
    const payloadText = await response.text();
    const payload = JSON.parse(payloadText) as AskAnswerPayload;
    const profile = payload.records.filter(record => record.candidateProfile);
    const missing = expected.filter(record => !profile.some(actual => actual.id === record.id && actual.text === record.text && actual.sourceUrl === record.sourceUrl && actual.sourceOrg === record.sourceOrg && actual.retrievedAt === record.retrievedAt && JSON.stringify(actual.candidateProfile) === JSON.stringify(record.candidateProfile)));
    const countAgrees = payload.trace.retrieval.recordCount === payload.records.length;
    proofs.push({ nativeHoldingKey: key, request, executionLevel: "REAL_ROUTE_HANDLER", httpStatus: response.status,
      resolvedSubject: payload.subject, expectedRecords: expected, returnedRecords: profile, missing, gaps: payload.gaps,
      denominators: payload.denominators, modelAnswer: payload.answer, actualRecordCount: payload.records.length,
      traceRecordCount: payload.trace.retrieval.recordCount, countAgrees,
      payloadSha256: createHash("sha256").update(payloadText).digest("hex"),
      status: response.status === 200 && payload.answer === null && countAgrees && !missing.length ? "PROVEN" : "ELIGIBLE_NOT_FULLY_DELIVERED" });
  }
  const paths = ["app/api/ask/grounded/route.ts", "lib/ask/candidate-profile.ts", "lib/ballot/candidate-contacts.ts", "lib/identity/reader-person.ts", "lib/ask/evidence.ts", "data/ballot/candidate-cards-2026.json", "data/ballot/candidate-links-2026.json", "data/states/nj/ballot/nj-morris-2026-contacts.json"];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER", modelDisabled: true,
    sourceHashes: paths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
    eligibleFields: proofs.reduce((sum, proof) => sum + proof.expectedRecords.length, 0), proofs,
    failed: proofs.filter(proof => proof.status !== "PROVEN").length };
}
