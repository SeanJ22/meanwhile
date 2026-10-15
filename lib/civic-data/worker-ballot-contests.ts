import { parseStateBallotContractId, requireBallotState, stateBallotContractId } from "../ballot/state-scopes.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { recordPublicationFlow } from "./publication-flow.ts";
import { publicationRecordChanges } from "./publication-record-changes.ts";
import { createHash } from "node:crypto";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { linkingPageFrom, section3Contest } from "../control-plane/promotion/section3.ts";
import type { RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import type { BallotSet, Contest, Candidacy, HeldBallotContest, Measure } from "../ballot/types.ts";
import { ballotElectionKey, type GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { ManualProjectionPackage, ManualProjectionPrior } from "./manual-projections.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { captureIntact, requirePublication, verifiedWorkerRecords } from "./worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { RoutineDataStore } from "./store.ts";
import { readRegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import { readManualProjectionPrior, manualProjectionCandidate, completeOfficialBallotContests, mergeBallotSourceReferences } from "./manual-projections.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { auditPull, capturesForPublication, jobWorkerResults, latestParserResult } from "./worker-publication-evidence.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { readMeasureRegistry, workerBallotMeasuresPackage } from "./worker-ballot-measures.ts";
import { publishOfficialBallotCandidacies } from "./official-candidacy-publication.ts";
import { netlifyEvidenceStoreFromEnv } from "../control-plane/evidence/netlify-store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { manualPayloadScope } from "./scoped-manual-contracts.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { placeMeasureProblems, type PlaceMeasureProjection } from "../ballot/place-measures.ts";
import { publishPlaceReaderEdgeOutcome } from "./place-edge-publication.ts";

const words = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const text = (value: unknown) => typeof value === "string" ? value : "";
const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex").slice(0, 24);
const groupKey = (f: Readonly<Record<string, unknown>>) => canonicalCivicDataJson([words(f.election), words(f.office), words(f.jurisdictionName)]);

export function workerBallotContestsPackage(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; captures: readonly WorkerPublicationCapture[];
  registry: RegistryRuntimePrior | null; now: string; results?: readonly WorkerResultRecord[];
}): { package: ManualProjectionPackage; heldContests: readonly string[] } {
  requirePublication((input.plan.publication?.contractId === "ballot-measures" || parseStateBallotContractId(input.plan.publication?.contractId ?? "")?.family === "ballot-contests") && input.plan.contract.schemaVersion === 2, "BALLOT_CONTRACT_UNRESOLVED");
  if (input.plan.contract.recordClass === "BALLOT_MEASURE") return workerBallotMeasuresPackage(input);
  requirePublication(input.plan.contract.recordClass === "BALLOT_CONTEST", "BALLOT_CLASS_MISMATCH");
  const checked = verifiedWorkerRecords(input);
  const inventory = inventoryRecordEvidence(checked.primary.evidence, checked.contract.extraction);
  const sourceListComplete = inventory.declaredCount === null || inventory.declaredCount === inventory.rows.length;
  const source = inventory.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value])));
  const groups = new Map<string, typeof source>();
  for (const row of source) {
    const key = groupKey(row), rows = groups.get(key) ?? [];
    rows.push(row); groups.set(key, rows);
  }
  const extractedGroups = new Map<string, typeof checked.extraction.records[number][]>();
  for (const row of checked.extraction.records) {
    const key = groupKey(row.fields), rows = extractedGroups.get(key) ?? [];
    rows.push(row); extractedGroups.set(key, rows);
  }
  const state = requireBallotState(checked.contract.jurisdiction.state);
  requirePublication(input.plan.publication?.contractId === stateBallotContractId("ballot-contests", state), "BALLOT_STATE_SCOPE_MISMATCH");
  const ballots: Record<string, BallotSet & { heldContests: HeldBallotContest[] }> = {}, heldContests: string[] = [];
  const divisionsByLabel = new Map<string, NonNullable<typeof input.registry>["payload"]["registry"]["divisions"][number][]>();
  for (const row of input.registry?.payload.registry.divisions ?? []) if (row.state.toUpperCase() === state) {
    const key = words(row.label), values = divisionsByLabel.get(key) ?? [];
    values.push(row); divisionsByLabel.set(key, values);
  }
  // Structured delimiters are not visible word boundaries in section3Contest, so use the exact replayed source cells.
  const pageText = ["DELIMITED_TEXT", "JSON_RECORDS", "XML_RECORDS"].includes(checked.contract.extraction.format)
    ? source.map(row => Object.values(row).join("\n")).join("\n") : checked.primary.evidence.text;
  const page = { url: checked.primary.evidence.canonicalUrl, text: pageText,
    retrievedAt: checked.primary.observedAt, linkingPage: linkingPageFrom(checked.primary.evidence.canonicalUrl,
      input.captures.filter(captureIntact).map(c => c.evidence)), sourcePolicy: checked.primary.sourcePolicy };
  const pageOffices = [...new Set(source.map(row => text(row.office)))];
  for (const [key, listed] of groups) {
    const extracted = extractedGroups.get(key) ?? [];
    const f = listed[0];
    const names = listed.map(row => text(row.candidateName));
    const uniqueNames = new Set(names.map(words));
    const verdict = section3Contest({ page, now: input.now, pageOffices, contest: {
      election: text(f.election), office: text(f.office), candidates: names } });
    const divisions = divisionsByLabel.get(words(f.jurisdictionName)) ?? [];
    const verifiedNames = new Set(verdict.verifiedCandidates.map(words));
    const listedCounts = new Map<string, number>(), extractedCounts = new Map<string, number>();
    for (const row of listed) { const name = words(row.candidateName); listedCounts.set(name, (listedCounts.get(name) ?? 0) + 1); }
    for (const row of extracted) { const name = words(row.fields.candidateName); extractedCounts.set(name, (extractedCounts.get(name) ?? 0) + 1); }
    const rows = extracted.filter(row => {
      const name = words(row.fields.candidateName);
      return verifiedNames.has(name) && listedCounts.get(name) === 1 && extractedCounts.get(name) === 1;
    });
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
    const ballotKey = `${state}:${electionId}`;
    const ballot = ballots[ballotKey] ?? { election, contests: [], candidacies: [], measures: [], absences: [], heldContests: [] };
    if (complete) { ballot.contests.push(contest); ballot.candidacies.push(...candidacies); }
    else ballot.heldContests.push({ id: contestId, electionId, ocdId: contest.ocdId,
      title: contest.title, provenance, reason: "The official candidate list hasn't been fully checked." });
    ballots[ballotKey] = ballot;
  }
  requirePublication(Object.keys(ballots).length, "NO_VERIFIED_BALLOT_CANDIDATE");
  return { package: { contractId: stateBallotContractId("ballot-contests", state), version: `worker:${input.parser.id}`, sourceThrough: input.now,
    sourceReceipt: checked.sourceReceipt, payload: { kind: "ballot-contests", ballots } }, heldContests };
}

const observedAt = (value: unknown): number => {
  if (!value || typeof value !== "object") return 0;
  const row = value as Record<string, unknown>;
  const provenance = row.provenance as Record<string, unknown> | undefined;
  const stamp = provenance?.collectedAt ?? row.collectedAt ?? row.writtenAt ?? row.generatedAt ?? row.curatedAt ?? row.generatedOn;
  return typeof stamp === "string" ? Date.parse(stamp) || 0 : 0;
};

function mergeHeldRows<T>(before: readonly T[] = [], next: readonly T[] = [], key: (row: T) => string,
  beforeTime = 0, nextTime = 0): T[] {
  const rows = new Map(before.map(row => [key(row), row]));
  for (const row of next) {
    const old = rows.get(key(row));
    if (!old || (observedAt(row) || nextTime) >= (observedAt(old) || beforeTime)) rows.set(key(row), row);
  }
  return [...rows.values()];
}

function mergeSupplement<T>(before: T | undefined, next: T | undefined, fields: Record<string, string>): T | undefined {
  if (!before) return next;
  if (!next) return before;
  const old = before as Record<string, unknown>, fresh = next as Record<string, unknown>;
  const beforeTime = observedAt(before), nextTime = observedAt(next);
  const merged = nextTime >= beforeTime ? { ...old, ...fresh } : { ...fresh, ...old };
  for (const [field, id] of Object.entries(fields)) {
    merged[field] = mergeHeldRows(old[field] as Record<string, unknown>[] | undefined,
      fresh[field] as Record<string, unknown>[] | undefined, row => String(row[id]), beforeTime, nextTime);
  }
  if (Array.isArray(old.sources) || Array.isArray(fresh.sources)) {
    merged.sources = mergeHeldRows(old.sources as unknown[] | undefined, fresh.sources as unknown[] | undefined, canonicalCivicDataJson);
  }
  return merged as T;
}

function citedBallotSources(payload: GenericBallotProjection | PlaceMeasureProjection, sources: ManualProjectionPackage["sourceReceipt"]["sources"]) {
  type Need = { hashes: Set<string>; times: Set<number>; days: Set<string>; latest: boolean; matched: Set<string> };
  const needed = new Map<string, Need>();
  const cite = (url: unknown, record: Record<string, unknown>) => {
    if (typeof url !== "string" || !url) return;
    const need = needed.get(url) ?? { hashes: new Set<string>(), times: new Set<number>(), days: new Set<string>(), latest: false, matched: new Set<string>() };
    const hash = text(record.rawHash || record.contentHash || (record.sourceHashKind !== "HELD_TEXT" && record.sourceHash)).replace(/^sha256-/, "");
    const stamp = text(record.collectedAt || record.retrievedAt || record.readAt);
    if (/^[a-f0-9]{64}$/.test(hash)) need.hashes.add(hash);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) need.days.add(stamp);
    else if (Number.isFinite(Date.parse(stamp))) need.times.add(Date.parse(stamp));
    else need.latest = true;
    needed.set(url, need);
  };
  const pending: unknown[] = [payload];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { for (const row of value) pending.push(row); continue; }
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    for (const key of ["sourceUrl", "candidacySourceUrl", "citesUrl"]) cite(row[key], row);
    if (Array.isArray(row.sourceUrls)) for (const url of row.sourceUrls) cite(url, row);
    const sourceRows = [...Array.isArray(row.sources) ? row.sources : [], row.canvass, row.retrieval];
    for (const source of sourceRows) if (source && typeof source === "object") {
      const record = source as Record<string, unknown>; cite(record.url, record);
    }
    for (const child of Object.values(row)) if (child && typeof child === "object") pending.push(child);
  }
  const versions = new Map<string, typeof sources[number]>();
  for (const source of sources) versions.set(`${source.requestedUrl}\n${source.finalUrl}\n${source.rawHash}`, source);
  const selected = new Set<string>(), latest = new Map<string, typeof sources[number]>();
  const identity = (source: typeof sources[number]) => `${source.finalUrl}\n${source.rawHash}`;
  for (const source of versions.values()) for (const url of new Set([source.requestedUrl, source.finalUrl])) {
    const need = needed.get(url);
    if (!need) continue;
    if (!latest.has(url) || Date.parse(source.retrievedAt) > Date.parse(latest.get(url)!.retrievedAt)) latest.set(url, source);
    const time = Date.parse(source.retrievedAt), day = source.retrievedAt.slice(0, 10);
    for (const [matches, key] of [[need.hashes.has(source.rawHash), `hash:${source.rawHash}`],
      [need.times.has(time), `time:${time}`], [need.days.has(day), `day:${day}`]] as const) {
      if (matches) { selected.add(identity(source)); need.matched.add(key); }
    }
  }
  for (const [url, need] of needed) if (need.latest || [...need.hashes].some(hash => !need.matched.has(`hash:${hash}`)) ||
    [...need.times].some(time => !need.matched.has(`time:${time}`)) || [...need.days].some(day => !need.matched.has(`day:${day}`))) {
    const source = latest.get(url);
    if (source) selected.add(identity(source));
  }
  return [...versions.values()].filter(source => selected.has(identity(source)));
}

export function mergeBallotContests(input: ManualProjectionPackage, prior: ManualProjectionPrior | null): ManualProjectionPackage {
  const partition = parseStateBallotContractId(input.contractId);
  const fresh = input.payload as GenericBallotProjection | PlaceMeasureProjection;
  const previous = prior?.payload as GenericBallotProjection | PlaceMeasureProjection | undefined;
  requirePublication(partition?.family === "ballot-contests" || input.contractId === "ballot-measures" && fresh.kind === "ballot-measures", "BALLOT_SCOPE_CONTRACT_REQUIRED");
  for (const value of [fresh, previous]) if (value) {
    if (fresh.kind === "ballot-measures") requirePublication(value.kind === "ballot-measures" && value.ocdId === fresh.ocdId && !placeMeasureProblems(value).length, "BALLOT_PLACE_SCOPE_MISMATCH");
    else for (const ballot of Object.values(value.ballots)) requirePublication(ballot.election.state === partition!.state, "BALLOT_STATE_SCOPE_MISMATCH");
  }
  const jurisdiction = partition && US_JURISDICTIONS.find(row => row.usps === partition.state);
  const measureDivision = fresh.kind === "ballot-measures" ? fresh.ocdId
    : `ocd-division/country:us/${jurisdiction!.prefix}:${jurisdiction!.slug}`;
  const ballots = Object.fromEntries(Object.entries(previous?.ballots ?? {}).map(([key, ballot]) => {
    const contests = ballot.contests.filter(row => row.type !== "MEASURE" || row.ocdId === measureDivision);
    const ids = new Set(contests.filter(row => row.type === "MEASURE").map(row => row.id));
    return [key, { ...ballot, contests, measures: ballot.measures.filter(row => ids.has(row.contestId)),
      ...(ballot.measureRecords ? { measureRecords: ballot.measureRecords.filter(row => ids.has(row.contestId)) } : {}) }];
  }));
  const complete = new Set(completeOfficialBallotContests({ ...fresh, kind: "ballot-contests" }, input.sourceReceipt).map(row => row.contest.id));
  for (const freshBallot of Object.values(fresh.ballots)) {
    const key = ballotElectionKey(freshBallot), before = ballots[key];
    requirePublication(!before?.election.date || !freshBallot.election.date || before.election.date === freshBallot.election.date, "BALLOT_ELECTION_DATE_CONFLICT");
    if (!before) { ballots[key] = freshBallot; continue; }
    const oldContests = new Map(before.contests.map(row => [row.id, row]));
    const oldHolds = new Map(before.heldContests?.map(row => [row.id, row]));
    const currentEnough = (row: Pick<Contest, "id" | "provenance">) => {
      const old = oldContests.get(row.id) ?? oldHolds.get(row.id);
      return !old || Date.parse(row.provenance.collectedAt) >= Date.parse(old.provenance.collectedAt);
    };
    const incomingContests = new Map(freshBallot.contests.filter(currentEnough).map(row => [row.id, row]));
    const ballot: BallotSet = { ...freshBallot, contests: [...incomingContests.values()],
      candidacies: freshBallot.candidacies.filter(row => incomingContests.has(row.contestId)),
      measures: freshBallot.measures.filter(row => incomingContests.has(row.contestId)),
      ...(freshBallot.measureRecords ? { measureRecords: freshBallot.measureRecords.filter(row => incomingContests.has(row.contestId)) } : {}),
      ...(freshBallot.heldContests ? { heldContests: freshBallot.heldContests.filter(currentEnough) } : {}) };

    const incomingCandidates = new Set(ballot.candidacies.map(row => row.id));
    const replacedLists = new Set(ballot.contests.filter(row => complete.has(row.id) &&
      Date.parse(row.provenance.collectedAt) >= Date.parse(oldContests.get(row.id)?.provenance.collectedAt ?? "")).map(row => row.id));
    const heldContests = (ballot.heldContests ?? []).filter(row => {
      const old = oldContests.get(row.id);
      return !old || old.candidateListComplete !== true && old.provenance.sourceUrl === row.provenance.sourceUrl &&
        Date.parse(row.provenance.collectedAt) >= Date.parse(old.provenance.collectedAt);
    });
    const incomingHolds = new Set(heldContests.map(row => row.id));
    const candidacies = new Map(before.candidacies.filter(row => !incomingHolds.has(row.contestId) &&
      (incomingCandidates.has(row.id) || !replacedLists.has(row.contestId))).map(row => [row.id, row]));
    for (const row of ballot.candidacies) candidacies.set(row.id, { ...candidacies.get(row.id), ...row });
    const held = new Map((before.heldContests ?? []).filter(row => !incomingContests.has(row.id) && !incomingHolds.has(row.id)).map(row => [row.id, row]));
    for (const row of heldContests) held.set(row.id, row);
    const contests = new Map(before.contests.filter(row => !incomingHolds.has(row.id)).map(row => [row.id, row]));
    for (const row of ballot.contests) contests.set(row.id, { ...contests.get(row.id), ...row });
    const incomingMeasures = new Set(ballot.measures.map(row => row.contestId));
    const keepsMeasure = (contestId: string, sourceUrl: string | null) => contests.get(contestId)?.type === "MEASURE" &&
      (!incomingContests.has(contestId) || !incomingMeasures.has(contestId) && incomingContests.get(contestId)?.measureTextUrl === sourceUrl);
    const measures = new Map<string, Measure>(before.measures.filter(row =>
      keepsMeasure(row.contestId, row.officialText?.sourceUrl ?? row.provenance.sourceUrl)).map(row => [row.contestId, row]));
    for (const next of ballot.measures) {
      const old = before.measures.find(row => row.contestId === next.contestId);
      const url = incomingContests.get(next.contestId)?.measureTextUrl;
      const officialText = next.officialText ?? (old?.officialText?.sourceUrl === url ? old?.officialText : undefined);
      const voterGuide = next.voterGuide ?? old?.voterGuide;
      measures.set(next.contestId, { ...next, ...(officialText ? { officialText } : {}), ...(voterGuide ? { voterGuide } : {}) });
    }
    const measureRecords = new Map((before.measureRecords ?? []).filter(row => contests.get(row.contestId)?.type === "MEASURE" &&
      (keepsMeasure(row.contestId, row.sourceUrl) || measures.get(row.contestId)?.officialText?.sourceHash === row.sourceHash &&
        measures.get(row.contestId)?.officialText?.sourceUrl === row.sourceUrl)).map(row => [row.contestId, row]));
    for (const row of ballot.measureRecords ?? []) {
      const source = measures.get(row.contestId)?.officialText;
      if (!source || source.sourceHash === row.sourceHash && source.sourceUrl === row.sourceUrl) measureRecords.set(row.contestId, row);
    }
    const merged: BallotSet = { ...ballot, ...mergeBallotSourceReferences(ballot, before),
      election: { ...ballot.election, date: ballot.election.date || before.election.date },
      contests: [...contests.values()], candidacies: [...candidacies.values()], measures: [...measures.values()],
      ...(before.heldContests !== undefined || ballot.heldContests !== undefined ? { heldContests: [...held.values()] } : {}),
      absences: mergeHeldRows(before.absences, ballot.absences, row => `${row.ocdId}:${row.statement}`),
      ...(before.removals || ballot.removals ? { removals: mergeHeldRows(before.removals, ballot.removals, row => row.id) } : {}),
      ...(before.coverageNotes || ballot.coverageNotes ? { coverageNotes: [...new Set([...before.coverageNotes ?? [], ...ballot.coverageNotes ?? []])] } : {}),
      ...(before.scopedCoverageNotes || ballot.scopedCoverageNotes ? { scopedCoverageNotes:
        mergeHeldRows(before.scopedCoverageNotes, ballot.scopedCoverageNotes, canonicalCivicDataJson) } : {}),
      ...(before.contacts || ballot.contacts ? { contacts: mergeHeldRows(before.contacts, ballot.contacts, row => row.candidacyId)
        .filter(row => candidacies.has(row.candidacyId)) } : {}),
      ...(before.generalLineup || ballot.generalLineup ? { generalLineup: mergeSupplement(before.generalLineup, ballot.generalLineup, { contests: "contestId" }) } : {}),
      ...(before.lineupReconciliation || ballot.lineupReconciliation ? { lineupReconciliation: mergeSupplement(before.lineupReconciliation, ballot.lineupReconciliation, { rows: "cardKey" }) } : {}),
      ...(before.filingCandidacies || ballot.filingCandidacies ? { filingCandidacies: mergeHeldRows(before.filingCandidacies, ballot.filingCandidacies, row => row.id)
        .filter(row => !candidacies.has(row.id)) } : {}),
      ...(before.measureRecords !== undefined || ballot.measureRecords !== undefined ? { measureRecords: [...measureRecords.values()] } : {}),
    };
    ballots[key] = merged;
  }
  const payload = { ...fresh, ballots };
  return { ...input, payload, sourceReceipt: { ...input.sourceReceipt,
    sources: citedBallotSources(payload, [...prior?.sourceReceipt.sources ?? [], ...input.sourceReceipt.sources]) } };
}

export async function publishWorkerBallotContestsResults(input: {
  repos: ControlPlaneRepositories; store: RoutineDataStore; workItemIds: readonly string[]; now: string;
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  evidenceStore?: EvidenceStore;
}) {
  const { results, readCapture } = await jobWorkerResults(input.repos, input.workItemIds, input.readCapture);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value, plan = item.autonomousPlan;
    const parser = latestParserResult(results, id);
    if (!parser || !plan || plan.publication?.contractId !== "ballot-measures" && parseStateBallotContractId(plan.publication?.contractId ?? "")?.family !== "ballot-contests") continue;
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
        const capturedIds = new Set(captures.map(capture => capture.evidence.artifactId));
        const fetched = await Promise.all(held.filter(row => !capturedIds.has(row.artifactId))
          .map(row => readCapture(row.artifactId, results).catch(() => null)));
        captures.push(...fetched.filter((capture): capture is WorkerPublicationCapture => capture !== null));
      }
      const checked = plan.contract.recordClass === "BALLOT_MEASURE"
        ? workerBallotMeasuresPackage({ plan, parser, captures, now: input.now, results, registry: await readMeasureRegistry(plan) })
        : workerBallotContestsPackage({ plan, parser, captures, now: input.now, results, registry: await readRegistryRuntimePrior(input.store, input.now) });
      const contractId = checked.package.contractId;
      const contract = requiredManualProductionContract(contractId);
      const scope = manualPayloadScope(contractId, contract.scope, checked.package.payload);
      const prior = await readManualProjectionPrior(contractId, input.store, input.now, scope);
      const merged = mergeBallotContests(checked.package, prior);
      const candidate = manualProjectionCandidate(merged);
      candidateId = candidate.id; verified = true;
      const contests = Object.values((checked.package.payload as GenericBallotProjection).ballots).flatMap(ballot => ballot.contests);
      const before = new Map(Object.values((prior?.payload as GenericBallotProjection | undefined)?.ballots ?? {}).flatMap(ballot => ballot.contests.map(row => [row.id, row] as const)));
      const changes = publicationRecordChanges({ previousVersionId: prior?.versionId ?? null,
        accepted: contests.map(contest => ({ recordId: contest.id, readerId: contest.id, value: contest, previous: before.get(contest.id) })) });
      const published = await processRegisteredManualCandidate(input.store, contractId, candidate, input.now, prior?.versionId ?? null,
        { vault: input.evidenceStore ?? netlifyEvidenceStoreFromEnv() ?? undefined });
      if (published.candidate.receipt?.decision === "GOOD") await recordPublicationFlow(input.repos, published.candidate.candidate.id,
        { workerResultId: parser.id, stage: "CHECKED", records: contests.length, changedRecords: changes.records.added + changes.records.changed, versionId: null }, input.now);
      requirePublication(published.promoted && published.readerReadback?.status === "PASS", `BALLOT_READER_HELD:${published.candidate.failureDetail ?? published.candidate.state}`);
      versionId = published.promoted.versionId;
      if (contractId === "ballot-measures") {
        const edge = await publishPlaceReaderEdgeOutcome(input.store, input.now, [{ recordClass: "BALLOT_CANDIDACY", scope }]);
        requirePublication(edge.ok, `MEASURE_READER_EDGE_HELD:${edge.detail}`);
      }
      requirePublication(plan.contract.schemaVersion === 2, "BALLOT_CONTRACT_UNRESOLVED");
      const state = plan.contract.jurisdiction.state.toUpperCase();
      if (plan.contract.recordClass !== "BALLOT_MEASURE") await publishOfficialBallotCandidacies({ store: input.store, now: input.now, sourceReceipt: merged.sourceReceipt,
        ballots: Object.values((merged.payload as GenericBallotProjection).ballots).filter(ballot => ballot.election.state === state) });
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
