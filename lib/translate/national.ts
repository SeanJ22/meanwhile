import type { BallotSet, MeasureSourceReference } from "../ballot/types.ts";
import { measureSourceReader, validateMeasureRecordEvidence } from "../ballot/measure-evidence.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { measureRecordIssue } from "../ballot/measure-record-contract.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { ZERO_COST, type Attempt } from "../control-plane/attempt.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkerProcessSlots } from "../control-plane/workers/worker-slots.ts";
import { runPool } from "../control-plane/scheduler/shadow-loop.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { runHeldMeasureTranslations, type TranslationAttempt } from "./standing.ts";
import { translationScope } from "./records.ts";
import { currentMeasureTranslation } from "./runtime.ts";
import { readTranslations } from "./projection-reader.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { GENERIC_BALLOT_SCOPE, genericBallotProblems } from "../ballot/generic-projection.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";

export async function readNationalBallotState(state: string, query: ReadOnlyQuery | null = readerQuery()): Promise<readonly BallotSet[]> {
  if (!query) throw new Error("Held national ballot reader is not configured.");
  if (!US_JURISDICTIONS.some(row => row.usps === state)) throw new Error("National ballot reader requires one jurisdiction.");
  const [rows] = await query([{ text: `WITH RECURSIVE walk(step,node) AS (
    SELECT 0,payload FROM civic_data_promotions WHERE record_class='BALLOT_CANDIDACY' AND scope=$1
    UNION ALL
    SELECT n.step,n.node FROM walk w
      LEFT JOIN civic_data_payload_parts p ON p.hash=w.node->>'$civicPayloadPart'
      CROSS JOIN LATERAL (SELECT CASE WHEN p.hash IS NULL THEN w.node
        WHEN p.payload->>'kind'='object' THEN p.payload->'value' ELSE p.payload END node) r
      CROSS JOIN LATERAL (
        SELECT 1 step,r.node->'ballots' node WHERE w.step=0
        UNION ALL
        SELECT 2,e.value FROM jsonb_each(CASE WHEN jsonb_typeof(r.node)='object' THEN r.node ELSE '{}'::jsonb END) e
          WHERE w.step=1 AND split_part(e.key,':',1)=$2
      ) n WHERE n.node IS NOT NULL
  ) SELECT node value FROM walk WHERE step=2
    UNION ALL SELECT jsonb_build_object('$missing',node) FROM walk WHERE step<2 AND node ? '$civicPayloadPart'
      AND NOT EXISTS (SELECT 1 FROM civic_data_payload_parts p WHERE p.hash=node->>'$civicPayloadPart')`,
    params: [GENERIC_BALLOT_SCOPE, state] }]);
  if (rows.some(row => row.value && typeof row.value === "object" && "$missing" in row.value)) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => { throw new Error("READ_ONLY"); },
    read: async hashes => {
      const [found] = await query([{ text: "SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [[...hashes]] }]);
      return found as unknown as { hash: string; payload: unknown }[];
    } });
  const ballots = await parts.load(rows.map(row => row.value)) as BallotSet[];
  const problems = genericBallotProblems({ kind: "ballot-contests", ballots: Object.fromEntries(ballots.map(ballot => [`${ballot.election?.state}:${ballot.election?.id}`, ballot])) });
  if (problems.length || ballots.some(ballot => ballot.election.state !== state)) throw new Error(`Held national ballot ${state} is invalid: ${problems.join(" ")}`);
  return ballots;
}

function sourceCapture(source: MeasureSourceReference, text: string): WorkerPublicationCapture {
  return { evidence: { artifactId: source.vault.key, acquiredByAttemptId: "",
    sourceId: source.publisher, methodRouteId: "", canonicalUrl: source.sourceUrl,
    contentHash: `sha256-${source.sourceHash}`, text, retrievedAt: source.retrievedAt },
    sourceReference: source, observedAt: source.retrievedAt, partial: false, httpStatus: 200, transport: "REACHABLE" };
}

export async function nationalMeasureInputs(ballot: BallotSet, vault: EvidenceStore) {
  const state = US_JURISDICTIONS.find(row => row.usps === ballot.election.state);
  if (!state) throw new Error("The ballot names an unknown jurisdiction.");
  const division = `ocd-division/country:us/${state.prefix}:${state.slug}`;
  const captures: WorkerPublicationCapture[] = [], records = [];
  const read = measureSourceReader(vault);
  for (const record of ballot.measureRecords ?? []) {
    const measure = ballot.measures.find(row => row.contestId === record.contestId);
    const contest = ballot.contests.find(row => row.id === record.contestId && row.type === "MEASURE" && row.ocdId === division);
    const source = measure?.officialText;
    if (!contest || !source || measureRecordIssue(record)) continue;
    const text = await validateMeasureRecordEvidence(record, source, vault, read);
    captures.push(sourceCapture(source, text));
    records.push(record);
  }
  const urls = captures.map(capture => capture.evidence.canonicalUrl).filter(url => !isOfficialSource(url));
  if (urls.length) for (const authority of ballot.sourceAuthorities ?? []) {
    const text = await read(authority);
    if (urls.some(url => isOfficialSource(url, { url: authority.sourceUrl, html: text }))) captures.push(sourceCapture(authority, text));
  }
  return { divisions: [division], ballots: [{ ...ballot, measureRecords: records }], captures };
}

async function saveTranslationAttempt(repos: ControlPlaneRepositories, translation: TranslationAttempt, recordedAt: string, artifactIds: string[]) {
  const prior = await repos.attempts.read(translation.id);
  const done = translation.status !== "RUNNING";
  const measured = translation.usage.every(row => row.usd !== null);
  const value: Attempt = { id: translation.id, routeTaskId: translation.scope, workItemId: translation.subjectId,
    worker: { role: "PARSER", provider: "anthropic", version: "plain-english-translations", instance: `translations:${process.pid}` },
    leaseId: translation.id, startedAt: translation.at, endedAt: done ? recordedAt : null,
    outcome: done ? translation.status === "HELD" ? "ABORTED" : "COMPLETED" : null,
    abortReason: translation.status === "HELD" ? translation.detail ?? "Translation remains held." : null,
    artifactIds,
    cost: { ...ZERO_COST, requestCount: translation.usage.length, durationMs: done ? Date.parse(recordedAt) - Date.parse(translation.at) : null,
      usd: measured ? translation.usage.reduce((sum, row) => sum + row.usd!, 0) : null },
    methodVersion: 0, policyVersion: "PLAIN_ENGLISH_TRANSLATION_ROUTINE", translation };
  if (prior) await repos.attempts.compareAndSet(translation.id, prior.revision, value, recordedAt);
  else await repos.attempts.put(translation.id, value, recordedAt);
}

export async function runNationalMeasureTranslations(input: {
  readonly vault: EvidenceStore;
  readonly repos: ControlPlaneRepositories;
  readonly store: RoutineDataStore;
  readonly transportFor: Parameters<typeof runHeldMeasureTranslations>[0]["transportFor"];
  readonly slots: WorkerProcessSlots;
  readonly capacity: () => number;
  readonly now: () => string;
  readonly continueWork: () => boolean;
  readonly report: (line: string) => void;
  readonly readState?: (state: string) => Promise<readonly BallotSet[]>;
}) {
  const states = US_JURISDICTIONS.map(state => state.usps);
  const reports: { state: string; published: number; reused: number; held: number; deferred: number; error: string | null }[] = [];
  const capacity = input.capacity();
  if (!input.continueWork() || capacity < 1) return reports;
  await runPool(states, capacity, async state => {
    if (!input.continueWork() || input.capacity() < 1) return;
    let release: (() => void) | undefined;
    try {
      release = await input.slots.acquire("lib/control-plane/workers/lease-worker.ts");
      await input.repos.locks.withLock(`measure-translations:${state}`, async () => {
        if (!input.continueWork()) return;
        const ballots = await (input.readState ?? readNationalBallotState)(state);
        if (!ballots.some(ballot => ballot.measures.length)) return;
        const jurisdiction = US_JURISDICTIONS.find(row => row.usps === state)!;
        const division = `ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`;
        const checked = await readTranslations([division], { store: input.store, now: input.now(), bypassCache: true });
        let reused = 0;
        const pending = ballots.map(ballot => {
          const current = new Set(ballot.measures.filter(measure => measure.officialText &&
            ballot.contests.some(contest => contest.id === measure.contestId && contest.ocdId === division && contest.type === "MEASURE") &&
            currentMeasureTranslation(checked, { contestId: measure.contestId, ocdId: division,
              ballotQuestion: { text: measure.questionText, sourceUrl: measure.provenance.sourceUrl! } }, measure.officialText))
            .map(measure => measure.contestId));
          reused += current.size;
          return { ...ballot, measures: ballot.measures.filter(measure => !current.has(measure.contestId)),
            measureRecords: ballot.measureRecords?.filter(record => !current.has(record.contestId)) };
        });
        const inputs = await Promise.all(pending.map(async ballot => nationalMeasureInputs(ballot, input.vault)));
        const admitted = { divisions: inputs[0].divisions, ballots: inputs.flatMap(row => row.ballots), captures: inputs.flatMap(row => row.captures) };
        const missing = pending.flatMap(ballot => ballot.measures.filter(measure => !admitted.ballots.some(admitted => admitted.measureRecords.some(record => record.contestId === measure.contestId))));
        const scope = translationScope(admitted.divisions[0]);
        const attempts = (await input.repos.attempts.listWhereNarrowed(["routeTaskId"], scope, { translation: true }))
          .flatMap(row => (row.value as Pick<Attempt, "translation">).translation ?? []);
        const result = await runHeldMeasureTranslations({ ...admitted, ...input, now: input.now(), attempts,
          saveAttempt: attempt => saveTranslationAttempt(input.repos, attempt, input.now(),
            admitted.captures.filter(capture => capture.evidence.contentHash === `sha256-${attempt.sourceHash}`).map(capture => capture.evidence.artifactId)),
          onPublished: attempt => input.report(`RCD_PROGRESS=${JSON.stringify({ key: attempt.versionId, records: 1 })}`) });
        const report = { state, published: result.outcomes.filter(row => row.status === "PUBLISHED").length,
          reused: reused + result.outcomes.filter(row => row.status === "REUSED").length,
          held: result.outcomes.filter(row => row.status === "HELD").length, deferred: result.deferred.length + missing.length,
          error: result.persistenceError };
        reports.push(report);
        input.report(`Measure summaries ${state}: ${JSON.stringify(report)}`);
        for (const held of result.outcomes.filter(row => row.status === "HELD")) input.report(`Measure summary held ${held.subjectId}: ${held.detail}`);
        for (const deferred of result.deferred) input.report(`Measure summary deferred ${deferred.subjectId}: ${deferred.reason}`);
        for (const measure of missing) input.report(`Measure summary deferred ${measure.contestId}: A complete source-bound official text is still owed.`);
      });
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      reports.push({ state, published: 0, reused: 0, held: 0, deferred: 0, error: detail });
      input.report(`Measure summaries ${state}: ${detail}`);
    } finally { release?.(); }
  });
  return reports;
}
