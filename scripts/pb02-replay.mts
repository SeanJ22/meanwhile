/** Read-only PB-02 replay. Inputs are bounded production SELECT snapshots and captured government pages; every write stays in PGlite or memory. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { factDb } from "../tests/helpers/fact-db.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { indexBoxFinding, type BoxFinding } from "../lib/control-plane/box.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishBoxFindings } from "../lib/facts/box-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { withFactRegistry } from "../lib/facts/registry-overlay.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import type { RegistryRuntimeCarton } from "../lib/registry/runtime-data-plane.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import { Representation } from "../components/map/popup/entity-modal.tsx";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { publishNowLane } from "../lib/civic-data/publish-now.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

interface EntitySnapshot {
  entities: { id: string; kind: string; name: string; state: string | null; parent_id: string | null }[];
  hosts: { entity_id: string; host: string }[];
  externalIds: { entity_id: string; scheme: string; value: string }[];
  places: { entity_id: string; place_id: string }[];
}
interface CaptureRow { ok: boolean; value?: { url: string; capture?: WorkerPublicationCapture } }

const arg = (name: string) => {
  const value = process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  assert.ok(value, `--${name}=path is required`);
  return value;
};
const read = async <T,>(name: string): Promise<T> => JSON.parse(await readFile(arg(name), "utf8")) as T;
type FindingRow = { id: string; value: BoxFinding };
const rows = await read<FindingRow[]>("findings");
const snapshot = await read<EntitySnapshot>("entities"), pages = await read<CaptureRow[]>("captures");
const out = arg("out"), facts = await factDb(), repos = createMemoryRepositories(), vault = new MemoryEvidenceStore();
try {
  let pending = [...snapshot.entities];
  const held = new Set<string>();
  while (pending.length) {
    const ready = pending.filter(row => row.parent_id === null || held.has(row.parent_id));
    assert.ok(ready.length, "Production entity ancestors must be present");
    for (const row of ready) {
      await facts.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES ($1,$2,$3,$4,$5)", [row.id,row.kind,row.name,row.state,row.parent_id]);
      held.add(row.id);
    }
    pending = pending.filter(row => !held.has(row.id));
  }
  for (const row of snapshot.hosts ?? []) await facts.query("INSERT INTO entity_host(entity_id,host) VALUES ($1,$2)", [row.entity_id,row.host]);
  for (const row of snapshot.externalIds ?? []) await facts.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES ($1,$2,$3)", [row.entity_id,row.scheme,row.value]);
  for (const row of snapshot.places ?? []) await facts.query("INSERT INTO entity_place(entity_id,place_id) VALUES ($1,$2)", [row.entity_id,row.place_id]);
  const captured = new Map(pages.flatMap(row => row.ok && row.value?.capture ? [[row.value.url, row.value.capture] as const] : []));
  const updatedPath = process.argv.find(arg => arg.startsWith("--updated-pages="))?.slice("--updated-pages=".length);
  const updated = updatedPath ? JSON.parse(await readFile(updatedPath, "utf8")) as { findingId: string; capture: WorkerPublicationCapture }[] : [];
  for (const { capture } of updated) captured.set(capture.evidence.canonicalUrl, capture);
  const now = [...captured.values()].map(capture => capture.observedAt).sort().at(-1)!;
  const tomorrow = new Date(Date.parse(now) + 86_400_000).toISOString();
  const late = process.argv.some(arg => arg.startsWith("--late=")) ? (await read<FindingRow[]>("late"))[0]! : null;
  const replayIds = new Map<string, string>();
  for (const row of rows) {
    if (process.argv.includes("--fresh")) {
      const origin = row.value.origins.find(origin => !origin.source) ?? row.value.origins[0]!;
      const indexed = await indexBoxFinding(repos.boxFindings, { subjectId: row.value.subjectId, fact: row.value.fact,
        exactQuote: row.value.exactQuote, sourceUrl: row.value.sourceUrl, origin }, now);
      replayIds.set(row.id, indexed.id);
    } else {
      await repos.boxFindings.put(row.id, { ...row.value, state: "refused", claim: null, refusal: "SEAT_NOT_IN_QUOTE",
        waitingFor: { class: "rosters", reason: "SEAT_NOT_IN_QUOTE", slots: "1" },
        attempts: row.value.attempts.filter(attempt => attempt.detail === "SEAT_NOT_IN_QUOTE").slice(-1) }, now);
      replayIds.set(row.id, row.id);
    }
  }
  // A saved archive page can link to a current roster. Feed that actual new government-page capture through normal hunt intake.
  for (const { findingId, capture } of updated) {
    const row = rows.find(row => row.id === findingId)!;
    assert.ok(row?.value.fact);
    const origin = row.value.origins.find(origin => !origin.source) ?? row.value.origins[0]!;
    await indexBoxFinding(repos.boxFindings, { subjectId: row.value.subjectId, fact: row.value.fact, exactQuote: String(row.value.fact.value),
      sourceUrl: capture.evidence.canonicalUrl, origin: { ...origin, resultId: `pb02-current-${origin.resultId}`, recordedAt: now, artifactIds: [] } }, now);
  }
  const fetch: ProbeFetch = async url => {
    const capture = captured.get(String(url));
    if (!capture) throw new Error("REPLAY_SOURCE_UNAVAILABLE");
    assert.ok(capture.httpStatus);
    return { status: capture.httpStatus, headers: new Headers({ "content-type": "text/html" }), bytes: async () => new TextEncoder().encode(capture.evidence.text) };
  };
  const runs: unknown[] = [], failures: unknown[] = [];
  let runAt = now;
  const scheduler = new IndependentRuntimeLaneScheduler([publishNowLane(async () => {
    runs.push(await publishBoxFindings({ repos, facts, vault, fetch, store: new MemoryRoutineDataStore(), clocks: factClocks(null),
      now: runAt, limit: 1000, audit: false, purge: async () => ({ purged: true }) }));
  })], outcome => { if (outcome.state === "FAILED") failures.push(outcome); });
  assert.deepEqual(scheduler.tick(Date.parse(now)), ["publish-now"]);
  await scheduler.waitForIdle();
  assert.deepEqual(failures, []);
  const first = (await repos.boxFindings.list()).map(row => row.value);
  const renderer = async () => {
    const bodies = (await facts.query("SELECT id,name,state FROM entity WHERE kind='body'")).map(row => ({ id: String(row.id), name: String(row.name), fieldSources: {} }));
    const carton = { formatVersion: 1, registry: { generatedAt: runAt, bodies }, rosterPhotos: {}, statewideExecutives: [],
      officialCandidacies: { rows: [] }, officialPhotos: { photos: [] } } as unknown as RegistryRuntimeCarton;
    const model = await withFactRegistry(carton, facts.query);
    return withRegistryRuntimeProjection(model, [...new Set(snapshot.entities.map(row => row.state).filter(Boolean))] as string[], () => {
      const shown = bodies.map(body => ({ ...body, holders: rosterHoldersForBody(body.id) })).filter(body => body.holders.length);
      return { names: shown.flatMap(body => body.holders.map(holder => holder.name)),
        bodies: shown.map(body => ({ id: body.id, names: body.holders.map(holder => holder.name) })),
        html: renderToStaticMarkup(createElement("main", {}, ...shown.map(body => createElement("section", { key: body.id, "data-body": body.id },
          createElement("h2", {}, body.name), createElement(Representation, { holders: body.holders, note: "" }))))) };
    });
  };
  const todayReader = await renderer();
  if (late) assert.ok(!todayReader.names.includes(String(late.value.fact?.value)));
  // Tomorrow's new hunt reports the same saved values and quotes through the real intake function.
  for (const row of [...rows, ...(late ? [late] : [])]) {
    const origin = row.value.origins.find(origin => !origin.source) ?? row.value.origins[0]!;
    const input = { subjectId: row.value.subjectId, fact: row.value.fact, exactQuote: row.value.exactQuote, sourceUrl: row.value.sourceUrl,
      origin: { ...origin, resultId: `pb02-tomorrow-${origin.resultId}`, recordedAt: tomorrow } };
    await indexBoxFinding(repos.boxFindings, input, tomorrow);
  }
  const afterIntake = (await repos.boxFindings.list()).map(row => row.value);
  for (const row of first.filter(row => row.state === "built" || row.state === "refused")) {
    assert.equal(afterIntake.find(next => next.id === row.id)?.state, row.state, `${row.id}: an unchanged re-report cannot reopen it`);
  }
  runAt = tomorrow;
  assert.deepEqual(scheduler.tick(Date.parse(tomorrow)), ["publish-now"]);
  await scheduler.waitForIdle();
  assert.deepEqual(failures, []);
  const tomorrowReader = await renderer();
  if (late) {
    assert.ok(tomorrowReader.names.includes(String(late.value.fact?.value)), "Tomorrow's new intake reaches the actual reader component on its scheduled tick");
    assert.ok(tomorrowReader.html.includes(String(late.value.fact?.value)));
  }
  for (const name of todayReader.names) assert.ok(tomorrowReader.names.includes(name), `${name} survives the next scheduled run`);
  await writeFile(`${out}.html`, tomorrowReader.html);
  const final = (await repos.boxFindings.list()).map(row => row.value);
  const report = { productionWrites: 0, findingCount: rows.length, capturedPages: captured.size, now, tomorrow, scheduler: "IndependentRuntimeLaneScheduler / publishNowLane",
    recoveredFromCurrentGovernmentPages: updated.map(row => ({ findingId: row.findingId, sourceUrl: row.capture.evidence.canonicalUrl })),
    runs, reader: { today: todayReader.names, tomorrow: tomorrowReader.names, bodies: tomorrowReader.bodies, component: "components/map/popup/entity-modal.tsx#Representation" },
    lateArrival: late?.value.fact ?? null,
    facts: await facts.query("SELECT f.entity_id, f.field, f.value_text, f.quote, s.url, s.sha256 FROM fact f JOIN source_copy s ON s.id=f.source_copy_id WHERE f.status='live'"),
    findings: rows.map(row => { const next = final.find(next => next.id === replayIds.get(row.id))!; return { id: row.id, subject: row.value.subjectId,
      field: row.value.fact?.field, value: row.value.fact?.value, sourceUrl: row.value.sourceUrl,
      before: row.value.state, captureAvailable: row.value.sourceUrl !== null && captured.has(row.value.sourceUrl), state: next.state, reason: next.refusal }; }) };
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ out, findings: rows.length, readerToday: todayReader.names, readerTomorrow: tomorrowReader.names,
    runs, unavailable: report.findings.filter(row => !row.captureAvailable).length }));
} finally { await facts.pg.close(); }
