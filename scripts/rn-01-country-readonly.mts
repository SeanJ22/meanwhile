import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { PLANNING_STATES, PLANNING_FINISHED_TIMES_SQL, planningStateOrder } from "../lib/control-plane/scheduler/state-planning.ts";
import { RUNNER_PAUSE_INTENTS_SQL, SOURCE_WORK_STATES_SQL } from "../lib/control-plane/repository/pg-store.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { REGISTRY_STATES, stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { routineTaskDue, routineBaselineOwed, routineFailureDomainFrontier, routinePassLaunchOrder, type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { readStateReaderPromotion } from "../lib/civic-data/state-reader-store.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import type { VotingSitesFile, VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { renderCardWithSources } from "../tests/helpers/render-card.ts";

// Exact production read doors, forced read-only independently of the read-only credentials. No writes or source requests.
const [readerFile, cpFile, output = "/tmp/rn01-country.json"] = process.argv.slice(2);
if (!readerFile || !cpFile) throw Error("usage: reader-url-file cp-url-file [output-json]");
process.env.DATABASE_URL = readFileSync(readerFile, "utf8").trim();
const reader = neon(process.env.DATABASE_URL), cp = neon(readFileSync(cpFile, "utf8").trim());
const query = (client: typeof reader) => async (text: string, params: readonly unknown[] = []) => {
  if (!/^\s*(?:SELECT|WITH|EXPLAIN)\b/i.test(text)) throw Error("READ_ONLY_REQUIRED");
  const rows = await client.transaction([client.query("SET TRANSACTION READ ONLY"), client.query("SET LOCAL statement_timeout='5s'"), client.query(text, [...params])]);
  return rows[2] as Record<string, unknown>[];
};
const rq = query(reader), cq = query(cp), store = new PostgresRoutineDataStore();
const plans = await cq(PLANNING_FINISHED_TIMES_SQL, [PLANNING_STATES]);
const order = planningStateOrder(PLANNING_STATES, new Map(plans.map(row => [String(row.state), row.finished_at as string | null])));
const huntStart = performance.now();
const hunt = await Promise.all([cq(RUNNER_PAUSE_INTENTS_SQL, ["level-1", ["PAUSE_RUNNER", "RESUME_RUNNER"]]), cq(SOURCE_WORK_STATES_SQL, ["current"])]);
const huntMs = performance.now() - huntStart;
assert.ok(huntMs < 5000, `production hunt scope took ${huntMs} ms`);
const tasks = AUTOMATIC_REFRESH_TASKS.filter(task => task.recordClass === "VOTING_SITE");
const clocks = new Map<string, RoutineTaskClock>();
for (const task of tasks) clocks.set(task.id, await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion));
const originalClocks = [...clocks];
const start = Date.parse("2026-10-23T08:30:00.000Z"), launches: string[][] = [[], []];
let now = start, day = 0, callbacks = 0;
const scheduler = new IndependentRuntimeLaneScheduler([{ id: "routine", everyMs: 300000, budgetMs: 1800000, run: async () => {
  callbacks++;
  const due = tasks.filter(task => routineTaskDue(task, clocks.get(task.id), now));
  const admitted = routinePassLaunchOrder(routineFailureDomainFrontier(due.map(task => ({ task,
    lastConsideredAt: clocks.get(task.id)?.lastAttemptedAt ?? null, baselineOwed: routineBaselineOwed(task, clocks.get(task.id)) }))), now);
  for (const { task } of admitted.slice(0, 3)) {
    launches[day].push(task.id); clocks.set(task.id, { ...clocks.get(task.id), lastAttemptedAt: new Date(now).toISOString() });
  }
} }]);
for (day = 0; day < 2; day++) for (let pass = 0; pass < 19; pass++) {
  now = start + day * 86400000 + pass * 300000; scheduler.tick(now); await scheduler.waitForIdle();
}
const rows: Record<string, unknown>[] = [];
for (const state of REGISTRY_STATES) {
  const row: Record<string, unknown> = { state, planningTurn: order.indexOf(state.toLowerCase()) + 1,
    today: launches[0].filter(id => id === `voting-sites:${state}`).length, tomorrow: launches[1].filter(id => id === `voting-sites:${state}`).length,
    registryBodies: null, congressMembers: null, jurisdictions: 0, heldSites: 0, readerSites: 0, browserPasses: 0, issues: [] as string[] };
  const issues = row.issues as string[];
  for (const kind of ["registry", "congress"] as const) try {
    const recordClass = kind === "registry" ? "REGISTRY_RUNTIME_BINDING" : "FEDERAL_DIRECTORY";
    const scope = kind === "registry" ? stateRegistryRuntimeScope(state) : `US-${state}:current-congress-directory`;
    const read = await readStateReaderPromotion<{ registry: { bodies: unknown[] } } | FederalDirectoryReadModel>(rq, recordClass, scope);
    if (!read) issues.push(`${kind}:NOT_RECORDED`);
    else if ("registry" in read.projection.payload) row.registryBodies = read.projection.payload.registry.bodies.length;
    else row.congressMembers = read.projection.payload.roster.officeholders.length;
  } catch (error) { issues.push(`${kind}:${error instanceof Error ? error.message : String(error)}`); }
  for (let run = 0; run < 2; run++) try {
    const read = await readStateReaderPromotion<VotingSitesFile>(rq, "VOTING_SITE", `US-${state}:voting-sites`);
    if (!read) { if (run === 0) issues.push("voting:NOT_RECORDED"); continue; }
    const file = read.projection.payload, jurisdictions = new Map<string, VotingSitesAnswer["jurisdictions"][number]>();
    for (const jurisdiction of file.jurisdictions) {
      const sites = jurisdiction.sites, town = /\/(?:place|cousub):([^/]+)$/.exec(jurisdiction.ocdId)?.[1]?.replaceAll("_", " ");
      const county = /\/county:([^/]+)/.exec(jurisdiction.ocdId)?.[1]?.replaceAll("_", " ");
      const place: VotingReaderPlace = { precision: "ZIP", point: null, states: [state], divisionIds: [jurisdiction.ocdId, ...sites.flatMap(site => site.districtOcdIds ?? [])],
        countyFips: [jurisdiction.countyFips, ...sites.map(site => site.countyFips)].filter((value): value is string => Boolean(value)),
        countyNames: [county, ...sites.map(site => site.countyName)].filter((value): value is string => Boolean(value)),
        countySubdivisionGeoids: [jurisdiction.countySubdivisionGeoid, ...sites.map(site => site.countySubdivisionGeoid)].filter((value): value is string => Boolean(value)),
        towns: [town, ...sites.map(site => site.town)].filter((value): value is string => Boolean(value)),
        wards: sites.flatMap(site => site.ward ?? []), aiannhGeoids: sites.flatMap(site => site.aiannhGeoid ?? []), precincts: [] };
      const answer = await answerVotingSites(file, place);
      assert.ok(answer.jurisdictions.some(row => row.ocdId === jurisdiction.ocdId), `${state}:${jurisdiction.ocdId}:consumer omitted jurisdiction`);
      for (const row of answer.jurisdictions) jurisdictions.set(row.ocdId, row);
    }
    const answer = { match: true, point: null, precision: "ZIP" as const, jurisdictions: [...jurisdictions.values()], outsideCoverage: false, pollingPlaceLinks: [] };
    row.jurisdictions = jurisdictions.size; row.heldSites = file.jurisdictions.reduce((n, j) => n + j.sites.length, 0);
    row.readerSites = answer.jurisdictions.reduce((n, j) => n + j.sites.length, 0);
    if (run === 0 && Number(row.readerSites) < Number(row.heldSites)) issues.push(`voting:${Number(row.heldSites) - Number(row.readerSites)}_HELD_SITES_WITHOUT_MATCHING_READER_GEOGRAPHY`);
    if (!answer.jurisdictions.length) { if (run === 0) issues.push("voting:EMPTY_PUBLISHED_JURISDICTIONS"); continue; }
    const sources = [...new Set(answer.jurisdictions.map(j => j.sourceUrl))];
    const markup = await renderCardWithSources({ modulePath: "./components/map/voting-sites-panel.tsx", exportName: "VotingJurisdictionRecords",
      props: { answer, selectedSiteId: null }, sourceUrls: sources });
    for (const jurisdiction of answer.jurisdictions) {
      assert.ok(markup.includes(jurisdiction.sourceUrl.replaceAll("&", "&amp;")), `${state}:source absent`);
      for (const site of jurisdiction.sites) assert.ok(markup.includes(`data-voting-site="${site.id}"`), `${state}:site ${site.id} missing from rendered page`);
    }
    row.browserPasses = Number(row.browserPasses) + 1;
    if (["TX", "NY", "PA", "MA"].includes(state)) writeFileSync(`/tmp/rn01-country-${state}-${run}.html`, markup);
  } catch (error) { issues.push(`voting:day${run + 1}:${error instanceof Error ? error.message : String(error)}`); }
  rows.push(row); console.log(JSON.stringify(row));
  writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), huntMs, huntRows: hunt.map(rows => rows.length), callbacks, launches, originalClocks, plans, order, rows }, null, 2));
  global.gc?.();
}
assert.equal(rows.length, 56);
assert.equal(new Set(launches[1].slice(0, 56)).size, 56, "tomorrow all 56 states before a repeat");
console.log(JSON.stringify({ summary: true, states: rows.length, callbacks, huntMs, failures: rows.filter(row => (row.issues as string[]).length), output }));
