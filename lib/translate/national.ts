import type { BallotSet, MeasureSourceReference } from "../ballot/types.ts";
import { measureSourceReader, validateMeasureRecordEvidence } from "../ballot/measure-evidence.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { measureRecordIssue } from "../ballot/measure-record-contract.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { ZERO_COST, type Attempt } from "../control-plane/attempt.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkerMemoryRelease, WorkerProcessSlots } from "../control-plane/workers/worker-slots.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { runHeldMeasureTranslations, type TranslationAttempt } from "./standing.ts";
import { TRANSLATION_SCOPE, translationScope } from "./records.ts";
import { publishTranslation } from "./publication.ts";
import type { TranslationBallotSource } from "./projection-contract.ts";
import { currentMeasureTranslation } from "./runtime.ts";
import { readTranslationProjection, readTranslations } from "./projection-reader.ts";
import { US_JURISDICTIONS, jurisdictionFromOcdId } from "../coverage/states.ts";
import { GENERIC_BALLOT_SCOPE, genericBallotProblems } from "../ballot/generic-projection.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { PLACE_MEASURE_SCOPE, readPlaceMeasureProjection } from "../ballot/place-measures.ts";

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

export async function nationalMeasureInputs(ballot: BallotSet, vault: EvidenceStore, division: string) {
  const state = US_JURISDICTIONS.find(row => row.usps === ballot.election.state);
  if (!state) throw new Error("The ballot names an unknown jurisdiction.");
  if (jurisdictionFromOcdId(division)?.usps !== state.usps) throw new Error("Measure translation cannot cross its state boundary.");
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

export interface MeasurePlaceInput {
  readonly division: string; readonly ballots: readonly BallotSet[];
  readonly sourceBallot?: Omit<TranslationBallotSource, "measureCount">;
  readonly currentMeasureCount?: number;
}

export async function* readMeasurePlaces(state: string, input: {
  readonly store: RoutineDataStore; readonly now: () => string;
  readonly readState?: (state: string) => Promise<readonly BallotSet[]>;
  readonly query?: ReadOnlyQuery | null;
}): AsyncGenerator<MeasurePlaceInput> {
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === state);
  if (!jurisdiction) throw new Error("Measure input requires one state.");
  const division = `ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`;
  yield { division, ballots: await (input.readState ?? readNationalBallotState)(state) };
  const query = input.query === undefined ? readerQuery() : input.query;
  if (!query) throw new Error("Local measure input reader is not configured.");
  const prefix = `${PLACE_MEASURE_SCOPE}:${division}/`;
  let after = prefix;
  while (true) {
    const [rows] = await query([{ text: `WITH places AS (
      SELECT scope,current_version_id FROM civic_data_promotions
      WHERE record_class='BALLOT_CANDIDACY' AND scope LIKE $1
        AND scope COLLATE "C">$2 AND scope COLLATE "C"<$3 ORDER BY scope COLLATE "C" LIMIT 100
    ) SELECT p.scope, p.current_version_id, CASE
      WHEN v.payload->'sourceBallot'->>'versionId'=p.current_version_id
        AND v.payload->'sourceBallot'->>'scope'=p.scope
      THEN v.payload->'sourceBallot'->'measureCount' END current_measure_count
      FROM places p LEFT JOIN civic_data_promotions t ON t.record_class='CURATED_READER_RECORD'
        AND t.scope=$4||substring(p.scope from $5::integer)
      LEFT JOIN civic_data_payload_parts part ON part.hash=t.payload->>'$civicPayloadPart'
      CROSS JOIN LATERAL (SELECT CASE WHEN part.hash IS NULL THEN t.payload
        WHEN part.payload->>'kind'='object' THEN part.payload->'value' ELSE part.payload END payload) v
      ORDER BY p.scope COLLATE "C"`,
      params: [`${prefix}%`, after, `${prefix.slice(0, -1)}0`, `${TRANSLATION_SCOPE}:`, PLACE_MEASURE_SCOPE.length + 2] }]);
    if (!rows.length) return;
    for (const row of rows) {
      const scope = String(row.scope);
      if (!scope.startsWith(prefix) || scope <= after) throw new Error("Local measure cursor crossed its state or failed to advance.");
      after = scope;
      const place = scope.slice(PLACE_MEASURE_SCOPE.length + 1);
      if (typeof row.current_measure_count === "number" && Number.isSafeInteger(row.current_measure_count) && row.current_measure_count > 0) {
        yield { division: place, ballots: [], currentMeasureCount: row.current_measure_count }; continue;
      }
      const read = await readPlaceMeasureProjection(place, { store: input.store, now: input.now(), bypassCache: true });
      if (read.kind !== "PROMOTED") throw new Error(`Local measure input ${place} is ${read.kind}.`);
      yield { division: place, ballots: Object.values(read.value.ballots), sourceBallot: { scope, versionId: read.projection.versionId } };
    }
  }
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
  readonly onCostRecorded?: Parameters<typeof runHeldMeasureTranslations>[0]["onCostRecorded"];
  readonly onMeasureComplete?: (division: string) => void;
  readonly slots: WorkerProcessSlots;
  readonly capacity: () => number;
  readonly now: () => string;
  readonly continueWork: () => boolean;
  readonly report: (line: string) => void;
  readonly readPlaces?: (state: string) => AsyncIterable<MeasurePlaceInput>;
  readonly state: string;
  readonly publishPlace?: (division: string) => Promise<void>;
}) {
  const state = input.state;
  if (!US_JURISDICTIONS.some(row => row.usps === state)) throw new Error("Translation worker requires one registered state.");
  const reports: { state: string; published: number; reused: number; held: number; deferred: number; error: string | null }[] = [];
  const capacity = input.capacity();
  if (!input.continueWork() || capacity < 1) return reports;
  const report = { state, published: 0, reused: 0, held: 0, deferred: 0, error: null as string | null };
  let release: WorkerMemoryRelease | undefined;
  try {
    release = await input.slots.acquire("scripts/translate-national-measures.mts");
    release.observe?.(process.pid);
    await input.repos.locks.withLock(`measure-translations:${state}`, async () => {
      if (!input.continueWork()) return;
      const places = input.readPlaces ? input.readPlaces(state) : readMeasurePlaces(state, input);
      for await (const { division, ballots, sourceBallot, currentMeasureCount } of places) {
        if (!input.continueWork()) break;
        if (jurisdictionFromOcdId(division)?.usps !== state) throw new Error("Measure worker crossed its state boundary.");
        const publishPlace = async () => {
          if (input.publishPlace) return input.publishPlace(division);
          const { publishPlaceReaderEdgeOutcome } = await import("../civic-data/place-edge-publication.ts");
          const edge = await publishPlaceReaderEdgeOutcome(input.store, input.now(), [{ recordClass: "CURATED_READER_RECORD", scope: translationScope(division) }]);
          if (!edge.ok) throw new Error(edge.detail ?? "Checked measure summaries have not reached the place reader.");
        };
        if (currentMeasureCount !== undefined) { report.reused += currentMeasureCount; await publishPlace(); continue; }
        if (!ballots.some(ballot => ballot.measures.length)) continue;
        const checkedProjection = await readTranslationProjection({ scope: translationScope(division), store: input.store, now: input.now(), bypassCache: true });
        if (checkedProjection.kind !== "PROMOTED" && checkedProjection.kind !== "NOT_RECORDED") throw new Error(`Checked measure input ${division} is ${checkedProjection.kind}.`);
        const checked = checkedProjection.kind === "PROMOTED" ? checkedProjection.value.records : [];
        const publishedBefore = report.published;
        const scope = translationScope(division);
        let attempts: TranslationAttempt[] | null = null, sourceUnavailable = false;
        const admitMeasure = async (ballot: BallotSet, measure: BallotSet["measures"][number]) => {
          try {
            const admitted = await nationalMeasureInputs({ ...ballot, measures: [measure],
              measureRecords: ballot.measureRecords?.filter(record => record.contestId === measure.contestId) }, input.vault, division);
            if (!admitted.ballots[0].measureRecords.length) {
              sourceUnavailable = true; report.deferred++;
              input.report(`Measure summary deferred ${measure.contestId}: A complete source-bound official text is still owed.`);
              return null;
            }
            return admitted;
          } catch (error) {
            sourceUnavailable = true; report.held++;
            input.report(`Measure summary held ${measure.contestId}: ${sanitizedErrorDiagnostic(error)}`);
            return null;
          }
        };
        for (const ballot of ballots) for (const measure of ballot.measures) {
          if (!input.continueWork()) break;
          if (!ballot.contests.some(contest => contest.id === measure.contestId && contest.ocdId === division && contest.type === "MEASURE")) continue;
          try {
            const current = measure.officialText && currentMeasureTranslation(checked, { contestId: measure.contestId, ocdId: division,
              ballotQuestion: { text: measure.questionText, sourceUrl: measure.provenance.sourceUrl! } }, measure.officialText);
            if (current?.kind === "MEASURE") {
              if (canonicalCivicDataJson(current.sourceReference) !== canonicalCivicDataJson(measure.officialText)) {
                const admitted = await admitMeasure(ballot, measure);
                if (!admitted) continue;
                const sourceReference = admitted.captures[0]?.sourceReference;
                if (!sourceReference) throw new Error("Refreshed measure has no complete official source.");
                const refreshed = await publishTranslation(input.store, { record: { ...current, sourceReference, retrievedAt: sourceReference.retrievedAt },
                  captures: admitted.captures, now: input.now() });
                if (!refreshed.promoted || refreshed.readerReadback?.status !== "PASS") throw new Error(refreshed.candidate.failureDetail ?? "Refreshed measure source has not reached its reader.");
              }
              report.reused++; continue;
            }
            const admitted = await admitMeasure(ballot, measure);
            if (!admitted) continue;
            attempts ??= (await input.repos.attempts.listWhereNarrowed(["routeTaskId"], scope, { translation: true }))
              .flatMap(row => (row.value as Pick<Attempt, "translation">).translation ?? []);
            const result = await runHeldMeasureTranslations({ ...admitted, ...input, now: input.now(), attempts,
              saveAttempt: attempt => saveTranslationAttempt(input.repos, attempt, input.now(),
                admitted.captures.filter(capture => capture.evidence.contentHash === `sha256-${attempt.sourceHash}`).map(capture => capture.evidence.artifactId)),
              onPublished: attempt => input.report(`RCD_PROGRESS=${JSON.stringify({ key: attempt.versionId, records: 1 })}`) });
            report.published += result.outcomes.filter(row => row.status === "PUBLISHED").length;
            report.reused += result.outcomes.filter(row => row.status === "REUSED").length;
            report.held += result.outcomes.filter(row => row.status === "HELD").length;
            report.deferred += result.deferred.length;
            for (const held of result.outcomes.filter(row => row.status === "HELD")) input.report(`Measure summary held ${held.subjectId}: ${held.detail}`);
            for (const deferred of result.deferred) input.report(`Measure summary deferred ${deferred.subjectId}: ${deferred.reason}`);
            if (result.persistenceError) throw new Error(result.persistenceError);
          } finally { input.onMeasureComplete?.(division); }
        }
        if (sourceBallot && !sourceUnavailable && input.continueWork() && !(checkedProjection.kind === "PROMOTED" &&
            checkedProjection.value.sourceBallot?.versionId === sourceBallot.versionId && checkedProjection.value.sourceBallot.scope === sourceBallot.scope)) {
          const current = await readTranslations([division], { store: input.store, now: input.now(), bypassCache: true });
          const measures = ballots.flatMap(ballot => ballot.measures.map(measure => ({ ballot, measure })))
            .filter(({ ballot, measure }) => ballot.contests.some(contest => contest.id === measure.contestId && contest.type === "MEASURE" && contest.ocdId === division));
          const matched = measures.map(({ measure }) => measure.officialText && currentMeasureTranslation(current,
            { contestId: measure.contestId, ocdId: division, ballotQuestion: { text: measure.questionText, sourceUrl: measure.provenance.sourceUrl! } }, measure.officialText));
          if (matched.length && matched.every(Boolean)) {
            const { ballot, measure } = measures[0];
            const admitted = await admitMeasure(ballot, measure);
            if (admitted) {
              const publication = await publishTranslation(input.store, { record: matched[0]!, captures: admitted.captures, now: input.now(),
                sourceBallot: { ...sourceBallot, measureCount: matched.length } });
              if (!publication.promoted || publication.readerReadback?.status !== "PASS") throw new Error(publication.candidate.failureDetail ?? "Checked summaries lost their held ballot source identity.");
            }
          }
        }
        if (checked.length || report.published > publishedBefore) await publishPlace();
      }
      if (report.published + report.reused + report.held + report.deferred) {
        reports.push(report); input.report(`Measure summaries ${state}: ${JSON.stringify(report)}`);
      }
    });
  } catch (error) {
    const detail = sanitizedErrorDiagnostic(error);
    report.error = detail;
    reports.push(report);
    input.report(`Measure summaries ${state}: ${detail}`);
  } finally { release?.(); }
  return reports;
}
