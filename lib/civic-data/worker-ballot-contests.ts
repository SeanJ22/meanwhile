import { verifiedBallotListReplacement } from "./ballot-list-replacement.ts";
import type { BallotCandidateListEvidence } from "./types.ts";
import { recordPublicationFlow } from "./publication-flow.ts";
import { publicationRecordChanges } from "./publication-record-changes.ts";
import { createHash } from "node:crypto";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { linkingPageFrom, section3Contest } from "../control-plane/promotion/section3.ts";
import type { RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import type { BallotSet, Contest, Candidacy } from "../ballot/types.ts";
import { ballotElectionKey, type GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { ManualProjectionPackage, ManualProjectionPrior } from "./manual-projections.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { captureIntact, requirePublication, verifiedWorkerRecords } from "./worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { RoutineDataStore } from "./store.ts";
import { readRegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import { readManualProjectionPrior, manualProjectionCandidate, completeOfficialBallotContests } from "./manual-projections.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { auditPull, capturesForPublication, jobWorkerResults, latestParserResult } from "./worker-publication-evidence.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { workerBallotMeasuresPackage } from "./worker-ballot-measures.ts";

const words = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const text = (value: unknown) => typeof value === "string" ? value : "";
const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex").slice(0, 24);
const groupKey = (f: Readonly<Record<string, unknown>>) => canonicalCivicDataJson([words(f.election), words(f.office), words(f.jurisdictionName)]);

export function workerBallotContestsPackage(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; captures: readonly WorkerPublicationCapture[];
  registry: RegistryRuntimePrior | null; now: string; results?: readonly WorkerResultRecord[];
}): { package: ManualProjectionPackage; heldContests: readonly string[] } {
  requirePublication(input.plan.publication?.contractId === "ballot-contests" && input.plan.contract.schemaVersion === 2, "BALLOT_CONTRACT_UNRESOLVED");
  if (input.plan.contract.recordClass === "BALLOT_MEASURE") return workerBallotMeasuresPackage(input);
  requirePublication(input.plan.contract.recordClass === "BALLOT_CONTEST", "BALLOT_CLASS_MISMATCH");
  const checked = verifiedWorkerRecords(input);
  const inventory = inventoryRecordEvidence(checked.primary.evidence, checked.contract.extraction, checked.contract);
  const sourceListComplete = inventory.declaredCount === null || inventory.declaredCount === inventory.rows.length;
  const source = inventory.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])));
  const groups = new Map<string, typeof source>();
  for (const row of source) groups.set(groupKey(row), [...groups.get(groupKey(row)) ?? [], row]);
  const state = checked.contract.jurisdiction.state.toUpperCase();
  const ballots: Record<string, BallotSet> = {}, heldContests: string[] = [];
  const ballotCandidateLists: BallotCandidateListEvidence[] = [];
    // Structured delimiters are not visible word boundaries in section3Contest, so use the exact replayed source cells.
  const pageText = ["DELIMITED_TEXT", "JSON_RECORDS", "XML_RECORDS"].includes(checked.contract.extraction.format)
    ? source.map(row => Object.values(row).join("\n")).join("\n") : checked.primary.evidence.text;
  const page = { url: checked.primary.evidence.canonicalUrl, text: pageText,
    retrievedAt: checked.primary.observedAt, linkingPage: linkingPageFrom(checked.primary.evidence.canonicalUrl,
      input.captures.filter(captureIntact).map(c => c.evidence)), sourcePolicy: checked.primary.sourcePolicy };
  const pageOffices = [...new Set(source.map(row => text(row.office)))];
  for (const [key, listed] of groups) {
    const extracted = checked.extraction.records.filter(row => groupKey(row.fields) === key);
    const f = listed[0];
    const names = listed.map(row => text(row.candidateName));
    const uniqueNames = new Set(names.map(words));
    const verdict = section3Contest({ page, now: input.now, pageOffices, contest: {
      election: text(f.election), office: text(f.office), candidates: names } });
    const divisions = input.registry?.payload.registry.divisions.filter(row => row.state.toUpperCase() === state && words(row.label) === words(f.jurisdictionName)) ?? [];
    const verifiedNames = new Set(verdict.verifiedCandidates.map(words));
    const rows = extracted.filter(row => verifiedNames.has(words(row.fields.candidateName)) &&
      listed.filter(source => words(source.candidateName) === words(row.fields.candidateName)).length === 1 &&
      extracted.filter(other => words(other.fields.candidateName) === words(row.fields.candidateName)).length === 1);
    if (!verdict.live || !rows.length || divisions.length !== 1) {
      heldContests.push(`${text(f.election)} / ${text(f.office)} / ${text(f.jurisdictionName)}`); continue;
    }
    const complete = sourceListComplete && names.every(Boolean) && uniqueNames.size === names.length && rows.length === listed.length;
    if (!complete) heldContests.push(`${text(f.election)} / ${text(f.office)} / ${text(f.jurisdictionName)}`);
    const electionId = `${state.toLowerCase()}-${hash([state, text(f.election)])}`;
    const election = { id: electionId, state, name: text(f.election), date: text(rows[0].fields.electionDate) };
    const contestId = `ballot-contest:${hash([state, electionId, text(f.office), divisions[0].ocdId])}`;
    const provenance = { sourceUrl: page.url, sourceOrg: checked.primary.evidence.sourceId, collectedAt: checked.primary.observedAt, verifiedAt: input.now };
    const verified = rows[0].fields;
    const contest: Contest = { id: contestId, electionId, ocdId: divisions[0].ocdId, divisionVintage: divisions[0].sourceDataset,
      title: text(f.office), type: "CANDIDACY", voteFor: typeof verified.voteFor === "number" && verified.voteFor > 0 ? verified.voteFor : null,
      termYears: typeof verified.termYears === "number" ? verified.termYears : null,
      candidateListComplete: complete, scopeNote: complete ? null : "We're working on getting the rest of this candidate list", provenance };
    const candidacies: Candidacy[] = rows.map(row => {
      const value = row.fields;
      return { id: `ballot-candidacy:${hash([contestId, text(value.candidateName)])}`, contestId,
        familyName: text(value.familyName) || text(value.candidateName), givenName: text(value.familyName) ? text(value.givenName) : "",
        partyLabel: text(value.partyLabel) || null, slogan: text(value.slogan) || null,
        incumbent: typeof value.incumbent === "boolean" ? value.incumbent : null, websiteUrl: text(value.websiteUrl) || null, provenance };
    });
    if (complete) ballotCandidateLists.push({ contestId, sourceUrl: page.url,
      rawHash: (checked.primary.evidence.sourceDocument?.contentHash ?? checked.primary.evidence.contentHash).slice(7),
      retrievedAt: checked.primary.observedAt, candidateIds: candidacies.map(row => row.id) });
    const ballotKey = `${state}:${electionId}`;
    const ballot = ballots[ballotKey] ?? { election, contests: [], candidacies: [], measures: [], absences: [] };
    ballot.contests.push(contest); ballot.candidacies.push(...candidacies); ballots[ballotKey] = ballot;
  }
  requirePublication(Object.keys(ballots).length, "NO_VERIFIED_BALLOT_CANDIDATE");
  return { package: { contractId: "ballot-contests", version: `worker:${input.parser.id}`, sourceThrough: input.now,
    sourceReceipt: checked.sourceReceipt, payload: { kind: "ballot-contests", ballots }, ballotCandidateLists }, heldContests };
}

export function mergeBallotContests(input: ManualProjectionPackage, prior: ManualProjectionPrior | null): ManualProjectionPackage {
  const fresh = input.payload as GenericBallotProjection;
  const previous = prior?.payload as GenericBallotProjection | undefined;
  const ballots = { ...previous?.ballots };
  const complete = new Set(completeOfficialBallotContests(fresh, input.sourceReceipt).map(row => row.contest.id));
  for (const ballot of Object.values(fresh.ballots)) {
    const key = ballotElectionKey(ballot), before = ballots[key];
    const ids = new Set(ballot.contests.map(row => row.id));
    const replacedLists = new Set(ballot.contests.filter(contest => verifiedBallotListReplacement({
      contest, priorContest: before?.contests.find(row => row.id === contest.id),
      candidates: ballot.candidacies, priorCandidates: before?.candidacies ?? [],
      evidence: input.ballotCandidateLists ?? [], receipt: input.sourceReceipt,
    })).map(contest => contest.id));
    const keepsMeasure = (contestId: string, sourceUrl: string | null) => !ids.has(contestId) ||
      !ballot.measures.some(row => row.contestId === contestId) && ballot.contests.some(row => row.id === contestId && row.measureTextUrl === sourceUrl);
    requirePublication(!before?.election.date || !ballot.election.date || before.election.date === ballot.election.date, "BALLOT_ELECTION_DATE_CONFLICT");
    // A candidacy leaves when a verified list replaces it. Packages without per-contest list evidence rely on a newer complete official list for the contest.
    const carriedCandidates = (before?.candidacies ?? []).filter(row => !ballot.candidacies.some(next => next.id === row.id) &&
      !replacedLists.has(row.contestId) &&
      !(input.ballotCandidateLists === undefined && ballot.contests.some(contest => contest.id === row.contestId && complete.has(contest.id) &&
        Date.parse(contest.provenance.collectedAt) >= Date.parse(before?.contests.find(old => old.id === contest.id)?.provenance.collectedAt ?? ""))));
    const contests = ballot.contests.map(contest => carriedCandidates.some(row => row.contestId === contest.id)
      ? { ...contest, candidateListComplete: false, scopeNote: "We're working on getting the rest of this candidate list" }
      : contest);
    ballots[key] = before ? { ...before, election: { ...ballot.election, date: ballot.election.date || before.election.date },
      contests: [...before.contests.filter(row => !ids.has(row.id)), ...contests],
      candidacies: [...carriedCandidates, ...ballot.candidacies],
      measures: [...before.measures.filter(row => keepsMeasure(row.contestId, row.provenance.sourceUrl)), ...ballot.measures],
      ...(before.measureRecords !== undefined || ballot.measureRecords !== undefined ? {
        measureRecords: [...before.measureRecords ?? []].filter(row => keepsMeasure(row.contestId, row.sourceUrl)).concat([...ballot.measureRecords ?? []]) } : {}) } : ballot;
  }
  const urls = new Set(Object.values(ballots).flatMap(ballot => [...ballot.contests, ...ballot.candidacies, ...ballot.measures].map(row => row.provenance.sourceUrl)));
  const sources = [...input.sourceReceipt.sources, ...prior?.sourceReceipt.sources ?? []].filter(row => urls.has(row.finalUrl) || urls.has(row.requestedUrl));
  return { ...input, payload: { kind: "ballot-contests", ballots }, sourceReceipt: { ...input.sourceReceipt,
    sources: sources.filter((source, at) => sources.findIndex(row =>
      new URL(row.finalUrl).href === new URL(source.finalUrl).href && row.rawHash === source.rawHash) === at) } };
}

export async function publishWorkerBallotContestsResults(input: {
  repos: ControlPlaneRepositories; store: RoutineDataStore; workItemIds: readonly string[]; now: string;
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
}) {
  const { results, readCapture } = await jobWorkerResults(input.repos, input.workItemIds, input.readCapture);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value, plan = item.autonomousPlan;
    const parser = latestParserResult(results, id);
    if (!parser || plan?.publication?.contractId !== "ballot-contests") continue;
    const pull = auditPull(results, parser);
    if (item.publicationOutcome?.workerResultId === parser.id && item.publicationOutcome.sourceObservedAt && item.publicationOutcome.recovery !== "PUBLISHER" &&
      item.publicationOutcome.status !== "PARTIALLY_PUBLISHED" &&
      !(pull && pull.at > item.publicationOutcome.at)) { report.push({ workItemId: id, outcome: item.publicationOutcome }); continue; }
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let candidateId: string | null = null, versionId: string | null = null, verified = false;
    try {
      requirePublication(parser.result.role === "PARSER", "PARSER_RESULT_UNRESOLVED");
      const captures = await capturesForPublication({ ...input, readCapture, workItemId: id, primaryId: parser.result.artifactId, results });
      if (plan.contract.schemaVersion === 2 && plan.contract.recordClass === "BALLOT_MEASURE") {
        const urls = new Set(parser.result.records.map(row => row.fields.textUrl).filter((url): url is string => typeof url === "string" && url.startsWith("https://")));
        const held = (await input.repos.artifacts.read(id)).filter(row => urls.has(row.canonicalUrl) && !row.partial)
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
        const fetched = await Promise.all(held.filter(row => !captures.some(capture => capture.evidence.artifactId === row.artifactId))
          .map(row => readCapture(row.artifactId, results).catch(() => null)));
        captures.push(...fetched.filter((capture): capture is WorkerPublicationCapture => capture !== null));
      }
      const checked = workerBallotContestsPackage({ plan, parser, captures, now: input.now, results,
        registry: await readRegistryRuntimePrior(input.store, input.now) });
      const prior = await readManualProjectionPrior("ballot-contests", input.store, input.now);
      const candidate = manualProjectionCandidate(mergeBallotContests(checked.package, prior));
      candidateId = candidate.id; verified = true;
      const contests = Object.values((checked.package.payload as GenericBallotProjection).ballots).flatMap(ballot => ballot.contests);
      const before = Object.values((prior?.payload as GenericBallotProjection | undefined)?.ballots ?? {}).flatMap(ballot => ballot.contests);
      const changes = publicationRecordChanges({ previousVersionId: prior?.versionId ?? null,
        accepted: contests.map(contest => ({ recordId: contest.id, readerId: contest.id, value: contest, previous: before.find(old => old.id === contest.id) })) });
      const published = await processRegisteredManualCandidate(input.store, "ballot-contests", candidate, input.now, prior?.versionId ?? null);
      if (published.candidate.receipt?.decision === "GOOD") await recordPublicationFlow(input.repos, published.candidate.candidate.id,
        { workerResultId: parser.id, stage: "CHECKED", records: contests.length, changedRecords: changes.records.added + changes.records.changed, versionId: null }, input.now);
      requirePublication(published.promoted && published.readerReadback?.status === "PASS", `BALLOT_READER_HELD:${published.candidate.failureDetail ?? published.candidate.state}`);
      versionId = published.promoted.versionId;
      await recordPublicationFlow(input.repos, published.candidate.candidate.id,
        { workerResultId: parser.id, stage: "LIVE", records: contests.length, changedRecords: published.confirmed ? 0 : changes.records.added + changes.records.changed, versionId }, input.now);
      outcome = { at: input.now, workerResultId: parser.id, status: checked.heldContests.length ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
        code: published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_BALLOT_FACTS_PUBLISHED", candidateId, versionId,
        detail: `${contests.length} official contest(s) published with ${plan.contract.recordClass === "BALLOT_MEASURE" ? "each independently verified measure fact" : "independently verified candidates"}; ${checked.heldContests.length} source or text gap(s) remain owed: ${checked.heldContests.join("; ")}.`,
        ...changes, sourceObservedAt: captures[0]?.observedAt, sourceArtifactId: captures[0]?.evidence.artifactId,
        acceptedRecordIds: contests.map(contest => contest.id), ...(checked.heldContests.length ? { recovery: "WORKER" as const } : {}) };
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      outcome = { at: input.now, workerResultId: parser.id, status: "HELD", code: detail.split(":")[0], detail,
        recovery: verified ? "PUBLISHER" : "WORKER", candidateId, versionId };
    }
    const latest = await input.repos.workItems.mustRead(id);
    await input.repos.workItems.compareAndSet(id, latest.revision, { ...latest.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: id, outcome });
  }
  return report;
}
