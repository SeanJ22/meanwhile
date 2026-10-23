/** BA-02: read-only production inputs, ordinary publication in memory, and the actual ballot route.
 * Reproduction, including both capture commands and scoped control-history SQL: docs/ba02-replay.md.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateEvent, CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { decodeStateCandidate } from "../lib/civic-data/state-publication.ts";
import { stateBallotScope, type BallotState } from "../lib/civic-data/state-scopes.ts";
import { runBallotPublication } from "./assemble-ballot-package.mts";
import { ballotPublicationDue } from "../lib/civic-data/ballot-publication.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { readPromotedCivicData, promotedEdgeEntryOf, clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { readerBallotSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { divisionsWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";
import { indexedZipDivisionEntry } from "../lib/geo/zip-division-index.ts";
import { stateContainers } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { CensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { censusWorkDivision } from "../lib/census-geography/division-id.ts";
import { stateAuthorityPointers } from "../lib/civic-data/state-reader.ts";
import type { StateAuthorityFamily, PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import { installReaderValues, activateCanonicalFixture } from "../tests/helpers/canonical-reader-fixtures.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneElement, isValidElement, type ReactNode } from "react";

export const BA02_STATES = ["AK", "AZ", "CO", "FL", "ID", "KS", "MO", "MT", "NM", "WY", "MP", "SC", "AS", "GU", "PR"] as const;
const retentionCounts: Record<string, number> = { AK: 1, AZ: 13, CO: 7, FL: 23, ID: 33, KS: 63, MO: 1, MT: 10, NM: 43, WY: 3, MP: 1 };
const directory = ".scratch/ba02-production";
const reportPath = "data/ballot/reports/ba02-replay.json";
const production = { projectId: "tiny-hill-13996172", branchId: "br-delicate-lab-ax02xuo5", role: "readonly" };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
type Held = { value: { projection: PromotedProjection<GenericBallotProjection>; candidate: CandidateVersionRecord; events: CandidateEvent[] }; parts: Record<string, unknown> };

/** Only SELECT is sent to the real production database. Local publications never use this client. */
async function capturePriors() {
  const connection = process.env.BA02_READONLY_DATABASE_URL;
  assert.ok(connection, "BA02_READONLY_DATABASE_URL is required for capture");
  assert.equal(decodeURIComponent(new URL(connection).username), "readonly");
  const sql = neon(connection);
  const identity = await sql`SELECT current_user AS role, current_setting('neon.branch_id',true) AS branch`;
  assert.equal(identity[0].role, "readonly"); assert.equal(identity[0].branch, production.branchId);
  await mkdir(directory, { recursive: true });
  for (const state of BA02_STATES) {
    const rows = await sql.query(`WITH RECURSIVE roots AS (
      SELECT jsonb_build_object('projection', jsonb_build_object('key',p.key,'sourceId',p.source_id,
        'recordClass',p.record_class,'scope',p.scope,'versionId',p.current_version_id,'lastKnownGoodVersionId',p.last_known_good_version_id,
        'promotedAt',p.promoted_at,'payload',p.payload,'receipt',p.validation_receipt),
        'candidate',jsonb_build_object('candidate',c.candidate,'state',c.state,'acquisitionSucceeded',c.acquisition_succeeded,
          'receipt',c.validation_receipt,'promotedVersion',c.promoted_version_id,'lastKnownGoodVersion',c.last_known_good_version_id,
          'failureCode',c.failure_code,'failureDetail',c.failure_detail),
        'events',(SELECT jsonb_agg(jsonb_build_object('candidateId',e.candidate_id,'sequence',e.sequence,'state',e.state,'at',e.at,'detail',e.detail)
          ORDER BY e.sequence) FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id)) AS value
      FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1
    ), hashes(hash) AS (
      SELECT ref#>>'{}' FROM roots,LATERAL jsonb_path_query(value,'strict $.**."$civicPayloadPart"','{}',true) ref
      UNION SELECT ref#>>'{}' FROM hashes JOIN civic_data_payload_parts part USING(hash),
        LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
    ) SELECT value,COALESCE((SELECT jsonb_object_agg(part.hash,part.payload)
      FROM hashes JOIN civic_data_payload_parts part USING(hash)),'{}'::jsonb) AS parts FROM roots`,
    [`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`]);
    await writeFile(`${directory}/${state.toLowerCase()}.json`, JSON.stringify({ capturedAt: new Date().toISOString(), production, rows }) + "\n");
    console.log(`${state}: captured ${rows.length} published production prior(s), read only`);
  }
}

async function captureGeography() {
  const connection = process.env.BA02_READONLY_DATABASE_URL;
  assert.ok(connection, "BA02_READONLY_DATABASE_URL is required only for capture");
  assert.equal(decodeURIComponent(new URL(connection).username), "readonly");
  const sql = neon(connection);
  const identity = await sql`SELECT current_user AS role, current_setting('neon.branch_id',true) AS branch`;
  assert.equal(identity[0].role, "readonly");
  assert.equal(identity[0].branch, production.branchId);
  const query = async (statements: readonly { text: string; params: readonly unknown[] }[]) =>
    Promise.all(statements.map(statement => sql.query(statement.text, [...statement.params])));
  await mkdir(directory, { recursive: true });
  for (const state of BA02_STATES) {
    const slice = await stateContainers(state, ["congressional_district", "state_leg_upper", "state_leg_lower"], true, query);
    const codes: Record<string, [number, boolean, number | null][]> = {};
    const containers: CensusDistrictEdge["containers"][number][] = [];
    if (slice.kind === "HELD") for (const container of slice.value.containers) {
      const { overlaps, ...rest } = container;
      const index = containers.length; containers.push(rest);
      for (const overlap of overlaps ?? []) (codes[overlap.zcta5] ??= []).push([index, overlap.whole, overlap.fraction]);
    }
    const edge: CensusDistrictEdge = { formatVersion: 1, versionId: slice.kind === "HELD" ? slice.versionId : `absent:${state}`,
      scopes: slice.kind === "HELD" ? slice.value.scopes : [], containers, codes };
    await writeFile(`${directory}/${state.toLowerCase()}-geography.json`, JSON.stringify({ capturedAt: new Date().toISOString(), production, identity, edge }) + "\n");
    console.log(`${state}: read-only production geography ${containers.length} containers / ${Object.keys(codes).length} ZIPs`);
  }
}

async function hydrate(state: BallotState) {
  const body = await readFile(`${directory}/${state.toLowerCase()}.json`, "utf8");
  const capture = JSON.parse(body) as { capturedAt: string; production: typeof production; rows: Held[] };
  assert.deepEqual(capture.production, production);
  assert.ok(capture.rows.length <= 1);
  const store = new MemoryRoutineDataStore();
  const maps = store as unknown as { candidates: Map<string, CandidateVersionRecord>; promotions: Map<string, PromotedProjection>; history: Map<string, CandidateEvent[]> };
  for (const row of capture.rows) {
    const parts = new CivicPayloadParts({ existing: async () => [], write: async () => assert.fail("capture is read only"), read: async () => assert.fail("all parts must be captured") });
    const decoded = await parts.loadOwned(row.value, row.parts) as Held["value"];
    const candidate = { ...decoded.candidate, candidate: decodeStateCandidate(decoded.candidate.candidate) as CandidateVersionRecord["candidate"] };
    const { projection, events } = decoded;
    assert.equal(projection.scope, stateBallotScope("ballot-contests", state));
    assert.equal(projection.versionId, candidate.candidate.id);
    assert.deepEqual(projection.payload, candidate.candidate.readModel);
    maps.promotions.set(projection.key, projection);
    maps.candidates.set(candidate.candidate.id, candidate);
    maps.history.set(candidate.candidate.id, events ?? []);
  }
  return { store, capture: { capturedAt: capture.capturedAt, sha256: sha256(body), versionId: capture.rows[0]?.value.projection.versionId ?? null } };
}

/** The ordinary publisher receives only an isolated memory store and an unreachable staging DB. */
async function publishIsolated(store: MemoryRoutineDataStore, state: BallotState, now: string) {
  const environment = { WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control", WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" };
  const prior = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const realNow = Date.now;
  Date.now = () => Date.parse(now);
  try {
    const result = await runBallotPublication({ state, store, now });
    assert.equal(result.report.status, "PUBLISHED", `${state}: ${result.report.reason}`);
    return result;
  } finally {
    Date.now = realNow;
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

async function readerSet(store: MemoryRoutineDataStore, state: BallotState, divisions: readonly string[], now: string) {
  const sources = await readerBallotSourcesForDivisions(divisions, { store, now, bypassCache: true });
  const sets = await Promise.all(sources.map(async row => row.source.normalize(await row.source.fetch())));
  assert.equal(sets.length, 1, state);
  return sets[0];
}

async function allRelevantDivisions(state: BallotState, ballot: BallotSet, edge: CensusDistrictEdge) {
  const manifest = JSON.parse(await readFile("data/derived/zip-divisions/index.json", "utf8")) as { statesToShards: Record<string, string[]> };
  const indexed = new Map<string, string[]>();
  for (const shardName of manifest.statesToShards[state] ?? []) {
    const shard = JSON.parse(await readFile(`data/derived/zip-divisions/${shardName}.json`, "utf8")) as { zips: Record<string, number[]> };
    for (const zip of Object.keys(shard.zips)) {
      const entry = await indexedZipDivisionEntry(zip);
      if (!entry) continue;
      const divisions = [...entry.ids];
      for (const [index] of edge.codes[zip] ?? []) {
        const id = censusWorkDivision(edge.containers[index].ref); if (id) divisions.push(id);
      }
      indexed.set(zip, [...divisionsWithDistrictMemberships(ballot, divisions)]);
    }
  }
  return indexed;
}

async function installPageReplay(store: MemoryRoutineDataStore, state: BallotState, edge: CensusDistrictEdge, now: string) {
  const scope = stateBallotScope("ballot-contests", state);
  const read = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", scope, { store, now, bypassCache: true });
  const entry = promotedEdgeEntryOf(read, "BALLOT_CANDIDACY", scope, store); assert.ok(entry?.kind === "PROMOTED");
  const key = `ba02:${state}:${now}`;
  const stateAuthorities: Partial<Record<StateAuthorityFamily, Record<string, { versionId: string; value: PromotedFamilyArtifactValue }>>> = Object.fromEntries((["registry-runtime", "federal-directory", "candidate-profiles", "candidate-publications", "candidate-campaign-sites-derived", "voting-sites"] as StateAuthorityFamily[])
    .map(family => [family, { [state]: { versionId: `absent:${family}:${state}`, value: { kind: "PROMOTED_POINTERS", entries: stateAuthorityPointers(family, state).map(pointer => ({ kind: "NOT_RECORDED", ...pointer })) } } }]));
  stateAuthorities["ballot-contests"] = { [state]: { versionId: entry.projection.versionId, value: { kind: "PROMOTED_POINTERS", entries: [entry] } } };
  installReaderValues({ authority: { "census-districts": { value: edge, versionId: edge.versionId } }, stateAuthorities }, key);
  return key;
}

/** Call the real page and its async server components. Render each real PickControl through React SSR. */
async function pageReplay(key: string, zip: string) {
  activateCanonicalFixture(key); clearPromotedReadModelCache();
  const { default: BallotPage } = await import("../app/ballot/page.tsx");
  const start = performance.now();
  const tree = await BallotPage({ searchParams: Promise.resolve({ zip }) });
  const seen = new WeakSet<object>(), text: string[] = [];
  const resolved = new WeakMap<object, unknown>();
  const contests = new Set<string>(), questions = new Map<string, string>();
  const picks = new Map<string, { voteFor: number; options: string[]; renderedButtons: number; htmlSha256: string }>();
  const walk = async (node: unknown, parentContest = ""): Promise<void> => {
    const awaited = node;
    node = await node;
    if (awaited && typeof awaited === "object" && node !== awaited) resolved.set(awaited, node);
    if (typeof node === "string") { text.push(node); return; }
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const child of node) await walk(child, parentContest); return; }
    const element = node as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
    if (element.$$typeof === undefined) {
      if (Object.getPrototypeOf(node) === Object.prototype) for (const value of Object.values(node)) await walk(value, parentContest);
      return;
    }
    const props = element.props ?? {};
    const id = props["data-contest-id"] ?? (props.attrs as Record<string, unknown> | undefined)?.["data-contest-id"];
    const contestId = typeof id === "string" ? id : parentContest;
    if (typeof id === "string") contests.add(id);
    if (props["data-retention-question"] !== undefined) questions.set(contestId, String(props.children));
    if (typeof element.type === "function" && element.type.name === "PickControl") {
      const html = renderToStaticMarkup(node as ReactNode);
      picks.set(String(props.contestId), { voteFor: Number(props.voteFor), options: (props.options as { label: string }[]).map(row => row.label),
        renderedButtons: [...html.matchAll(/<button\b/g)].length, htmlSha256: sha256(html) });
      assert.ok(html.includes("<button"), `ZIP ${zip}: ${props.contestId} has visible pick buttons`);
      return;
    }
    if (typeof element.type === "function" && (element.type.constructor.name === "AsyncFunction" || ["CandidateSources", "CandidateContactSources", "CandidatePortraitSources"].includes(element.type.name))) {
      const child = await (element.type as (props: unknown) => Promise<unknown>)(props);
      resolved.set(node, child); await walk(child, contestId); return;
    }
    for (const value of Object.values(props)) await walk(value, contestId);
  };
  await walk(tree);
  {
    const materialize = (node: unknown): unknown => {
      if (node === null || typeof node !== "object") return node;
      if (resolved.has(node)) return materialize(resolved.get(node));
      if (Array.isArray(node)) return node.map(materialize);
      if (isValidElement(node)) return cloneElement(node, Object.fromEntries(Object.entries(node.props as Record<string, unknown>).map(([name, value]) => [name, materialize(value)])));
      if (Object.getPrototypeOf(node) === Object.prototype) return Object.fromEntries(Object.entries(node).map(([name, value]) => [name, materialize(value)]));
      return node;
    };
    const html = renderToStaticMarkup(materialize(tree) as ReactNode);
    const cssDirectory = resolve(".next/static/chunks");
    const css = (await readdir(cssDirectory)).filter(name => name.endsWith(".css"));
    const styles = css.map(name => `<link rel="stylesheet" href="${pathToFileURL(resolve(cssDirectory, name)).href}">`).join("");
    await mkdir(".scratch/ba02-pages", { recursive: true });
    await writeFile(`.scratch/ba02-pages/${zip}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<title>BA-02 actual ballot route replay · ${zip}</title></head><body>${html}</body></html>`);
  }
  return { elapsedMs: Math.round(performance.now() - start), contests, questions, picks, text: text.join(" ") };
}

async function main() {
  if (process.argv.includes("--capture-priors")) return capturePriors();
  if (process.argv.includes("--capture-geography")) return captureGeography();
  const today = new Date().toISOString(), tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const states: Record<string, unknown>[] = [];
  const historyBody = await readFile(`${directory}/publication-history.json`, "utf8");
  const publicationHistory = JSON.parse(historyBody) as {
    capturedAt: string; production: { projectId: string; branchId: string; sql: string };
    rows: { log_key: string; publication: Parameters<typeof ballotPublicationDue>[2] }[];
  };
  assert.deepEqual(publicationHistory.production, { projectId: "withered-sunset-39821877", branchId: "br-tiny-frog-aeufpjeq", sql: "SELECT ONLY" });
  const selected: readonly string[] = process.argv.find(arg => arg.startsWith("--states="))?.slice(9).split(",") ?? BA02_STATES;
  if (process.argv.some(arg => arg.startsWith("--states="))) {
    try {
      const prior = JSON.parse(await readFile(reportPath, "utf8")) as { proofMode?: string; states?: Record<string, unknown>[] };
      if (prior.proofMode === "STRICT_AUTOMATIC_ADMISSION") for (const row of prior.states ?? []) {
        if (selected.includes(String(row.state))) continue;
        const input = await readFile(`data/ballot/2026-general/${String(row.state).toLowerCase()}.json`, "utf8");
        if (sha256(input) === row.inputSha256) states.push(row);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const state of selected as BallotState[]) {
    const { store, capture } = await hydrate(state);
    const scope = stateBallotScope("ballot-contests", state);
    const prior = await store.readPromotion<GenericBallotProjection>("BALLOT_CANDIDACY", scope);
    const priorIds = Object.values(prior?.payload.ballots ?? {}).flatMap(ballot => [...ballot.contests, ...ballot.candidacies, ...ballot.measures].map(row => row.id));
    const clockBefore = await store.clock("official-ballot-authorities", "BALLOT_CANDIDACY", scope);
    const productionPublication = publicationHistory.rows.find(row => row.log_key === `ballot-publication:${state}`)?.publication ?? null;
    const inputBody = await readFile(`data/ballot/2026-general/${state.toLowerCase()}.json`, "utf8");
    const first = await publishIsolated(store, state, today);
    assert.match(first.report.inputStamp ?? "", /^git:[a-f0-9]{40,64}$/, "strict replay requires the production committed-blob admission path");
    const gitAlgorithm = first.report.inputStamp!.length === 44 ? "sha1" : "sha256";
    const inputBlob = createHash(gitAlgorithm).update(`blob ${Buffer.byteLength(inputBody)}\0`).update(inputBody).digest("hex");
    assert.equal(first.report.inputStamp, `git:${inputBlob}`, `${state}: replay input bytes must match the committed input used by automatic admission`);
    assert.equal(ballotPublicationDue(`ballot-contests:${state}`, first.report.inputStamp ?? null, productionPublication, clockBefore), true,
      "the modified input is automatically due against the actual production publication history");
    const projection = await store.readPromotion<GenericBallotProjection>("BALLOT_CANDIDACY", scope);
    assert.ok(projection);
    const ballots = Object.values(projection.payload.ballots);
    const allIds = new Set(ballots.flatMap(ballot => [...ballot.contests, ...ballot.candidacies, ...ballot.measures].map(row => row.id)));
    const lostIds = priorIds.filter(id => !allIds.has(id)); assert.deepEqual(lostIds, [], `${state} preserves held production identities`);
    const edgeBody = await readFile(`${directory}/${state.toLowerCase()}-geography.json`, "utf8");
    const edgeCapture = JSON.parse(edgeBody) as { edge: CensusDistrictEdge; capturedAt: string; production: typeof production };
    assert.deepEqual(edgeCapture.production, production);
    const pageKey = await installPageReplay(store, state, edgeCapture.edge, today);
    let questionCount = 0, pickableCount = 0;
    const zipReadbacks: { zip: string; contests: string[]; absences: string[]; pageQuestionCount: number; pagePickCount: number; pageElapsedMs: number }[] = [];
    for (const ballot of ballots) {
      const zips = await allRelevantDivisions(state, ballot, edgeCapture.edge);
      const required = ballot.contests.filter(row => retentionCounts[state] ? row.type === "RETENTION" : ["SC", "AS", "GU"].includes(state));
      const remaining = new Set(required.map(row => row.id));
      const ordered = [...zips].sort((a, b) => b[1].filter(id => required.some(row => row.ocdId === id)).length - a[1].filter(id => required.some(row => row.ocdId === id)).length);
      if (state === "GU") ordered.unshift(["96910", zips.get("96910") ?? ["ocd-division/country:us/territory:gu"]]);
      if (state === "PR") ordered.unshift(["00901", zips.get("00901") ?? ["ocd-division/country:us/territory:pr"]]);
      for (const [zip, divisions] of ordered) {
        if (!remaining.size && zipReadbacks.length) break;
        if (remaining.size && !required.some(row => remaining.has(row.id) && divisions.includes(row.ocdId))) continue;
        const actual = await readerSet(store, state, divisions, today);
        const page = await pageReplay(pageKey, zip);
        if (state === "AS") assert.doesNotMatch(page.text, /State House contests aren't shown/, "official village memberships establish the House electorates");
        for (const contest of actual.contests.filter(row => remaining.has(row.id))) {
          assert.ok(page.contests.has(contest.id), `${zip}: ${contest.id} appears on the actual page`);
          if (contest.type === "RETENTION") {
            assert.ok(contest.retentionQuestion?.questionText); questionCount++;
            assert.equal(page.questions.get(contest.id), contest.retentionQuestion.questionText, `${zip}: exact official question on actual card`);
            assert.deepEqual(page.picks.get(contest.id)?.options, ["Yes", "No"]);
          }
          assert.ok(contest.voteFor !== null && contest.voteFor > 0, contest.id); pickableCount++; remaining.delete(contest.id);
          assert.equal(page.picks.get(contest.id)?.voteFor, contest.voteFor, `${zip}: real PickControl renders sourced limit`);
        }
        if (state === "PR") {
          assert.match(actual.absences.map(row => row.statement).join(" "), /November 3, 2026.*November 7, 2028/);
          assert.match(page.text, /November 3, 2026.*November 7, 2028/);
        }
        zipReadbacks.push({ zip, contests: [...page.contests], absences: actual.absences.map(row => row.statement),
          pageQuestionCount: page.questions.size, pagePickCount: page.picks.size, pageElapsedMs: page.elapsedMs });
      }
      assert.deepEqual([...remaining], [], `${state}: every requested contest must reach a real held ZIP`);
    }
    if (retentionCounts[state]) assert.equal(questionCount, retentionCounts[state]);
    if (state === "SC") assert.equal(pickableCount, 298);
    if (state === "AS") assert.equal(pickableCount, 18);
    const task = AUTOMATIC_REFRESH_TASKS.find(row => row.id === `ballot-contests:${state}`); assert.ok(task);
    const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    assert.equal(ballotPublicationDue(task.id, first.report.inputStamp ?? null, first.report, clock), false, "tomorrow unchanged published input is retained");
    assert.equal(ballotPublicationDue(task.id, first.report.inputStamp ?? null, null, clockBefore), true, "a runner first seeing changed input tomorrow admits it");
    assert.equal(routineTaskDue(task, clock, Date.parse(tomorrow)), true, "the registered daily cadence is due tomorrow");
    const rerun = await publishIsolated(store, state, tomorrow);
    const next = await store.readPromotion<GenericBallotProjection>("BALLOT_CANDIDACY", scope); assert.ok(next);
    assert.deepEqual(next.payload, projection.payload, "tomorrow's ordinary publication preserves reader output");
    assert.equal(rerun.report.status, "PUBLISHED");
    const nextPageKey = await installPageReplay(store, state, edgeCapture.edge, tomorrow);
    for (const expected of zipReadbacks) {
      const actual = await pageReplay(nextPageKey, expected.zip);
      if (state === "AS") assert.doesNotMatch(actual.text, /State House contests aren't shown/);
      assert.equal(actual.questions.size, expected.pageQuestionCount);
      assert.equal(actual.picks.size, expected.pagePickCount);
      for (const id of expected.contests) assert.ok(actual.contests.has(id), `${state}/${expected.zip}: tomorrow page retains ${id}`);
      for (const statement of expected.absences) assert.ok(actual.text.includes(statement));
    }
    states.push({ state, capture, geographyCapture: { capturedAt: edgeCapture.capturedAt, sha256: sha256(edgeBody), versionId: edgeCapture.edge.versionId },
      productionPublication, publishedInputStamp: first.report.inputStamp, inputSha256: sha256(inputBody),
      priorClock: clockBefore, priorIdsLost: lostIds, publishedVersion: projection.versionId, questionCount, pickableCount, zipReadbacks,
      tomorrow: { at: tomorrow, registeredCadenceDue: true, unchangedInputAdmission: "SKIP_RETAINING_PUBLISHED_VALUE", changedInputAdmission: true,
        forcedOrdinaryRerun: rerun.report.status, sameReaderPayload: true, sameVersion: next.versionId === projection.versionId } });
    console.log(`${state}: ordinary publisher + real-ZIP reader verified; tomorrow retained and ordinary rerun identical`);
    await mkdir("data/ballot/reports", { recursive: true });
    await writeFile(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), proofMode: "STRICT_AUTOMATIC_ADMISSION", upstream: "BA-01 official source acquisition and state ballot inputs", downstream: "ordinary /ballot reader and pick controls", production,
      productionWrites: 0, memoryOnlyPublications: true, publicationHistoryCapture: { capturedAt: publicationHistory.capturedAt,
        sha256: sha256(historyBody), production: publicationHistory.production }, scenario: { today, tomorrow }, states }, null, 2) + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
