import assert from "node:assert/strict";
import test from "node:test";

import { copiedReach, copyFieldManualPage, retagForRows } from "../lib/control-plane/field-manual-copy.ts";
import { type FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

const NOW = "2026-10-07T12:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const MORRIS = "ocd-division/country:us/state:nj/county:morris";

const old = (id: string, over: Partial<FieldManualEntry> = {}): FieldManualEntry => ({
  id, role: "SHARED", kind: "LESSON_NOTE", title: id, summary: id, states: [], recordClasses: [], platforms: [], outcome: "YIELDED",
  url: null, source: "old", observedAt: "2026-09-01", tier: null, payload: {}, ...over,
});

const SAMPLE = [
  old("investigation", { kind: "INVESTIGATION_RESULT", payload: { subjectId: `${PIMA}#governing` } }),
  old("door", { kind: "SCOUT_DISCOVERY", role: "SCOUT", url: "https://pima.gov/meetings", states: ["az"], payload: { subjectId: PIMA } }),
  old("reliability", { kind: "SOURCE_RELIABILITY", url: "https://pima.gov/meetings" }),
  old("playbook", { kind: "PLAYBOOK", role: "SCOUT", payload: { text: "walk" } }),
  old("fingerprint", { kind: "PLATFORM_FINGERPRINT", platforms: ["legistar"] }),
  old("tier", { kind: "TIER_VOCAB", states: ["nh"] }),
  old("orphan", { kind: "SOURCE_RELIABILITY", url: "https://somewhere.example/feed", title: "Somewhere" }),
  old("method", { kind: "METHOD", platforms: ["legistar"], states: ["az", "nj"], payload: { places: [PIMA, MORRIS], doorEntryIds: [] },
    placeResults: [{ place: "state:az", outcome: "YIELDED", observedAt: "2026-09-01" }] }),
  old("route", { kind: "ROUTE", payload: { id: "r", outcomes: [{ jurisdiction: PIMA, outcome: "FAILED", observedOn: "2026-09-02" }] } }),
];

test("re-tagging reads the place from the record, then from another entry with the same address, then class-wide kinds; the rest names no place", () => {
  const out = retagForRows(SAMPLE);
  const byId = new Map(out.entries.map((e) => [e.id, e] as const));
  assert.deepEqual(byId.get("investigation")!.reach!.places, [PIMA]);
  assert.deepEqual(byId.get("reliability")!.reach!.places, [PIMA], "the same address as Pima's own door");
  assert.equal(byId.get("playbook")!.reach!.everywhere, true);
  assert.equal(copiedReach(byId.get("fingerprint")!), "PLATFORM");
  assert.equal(copiedReach(byId.get("tier")!), "STATE");
  assert.equal(copiedReach(byId.get("orphan")!), "NOWHERE");
  assert.equal(copiedReach(byId.get("method")!), "METHOD");
  assert.deepEqual([out.fromRecord, out.fromSameAddress], [3, 1], "the investigation, the door's subject and the route's outcome; the reliability by address");
  assert.deepEqual(out.everywhereByKind, { PLAYBOOK: 1 });
});

test("a scoped page copies lessons and method evidence once, and a repeated page preserves a newer row",async()=>{
  const repos=createMemoryRepositories();
  assert.equal(await copyFieldManualPage(repos,SAMPLE,NOW),SAMPLE.length);
  const fix=new Map([...(await repos.fixMap.forPlace(PIMA)),...(await repos.fixMap.forPlace(MORRIS))].map(row=>[`${row.methodId}@${row.placeId}`,row.state]));
  assert.deepEqual(Object.fromEntries(fix),{[`method@${PIMA}`]:"WORKS",[`method@${MORRIS}`]:"WORKS",[`route@${PIMA}`]:"FAILS"});
  const held=await repos.fieldManual.mustRead("door");
  await repos.fieldManual.compareAndSet(held.id,held.revision,{...held.value,summary:"Current source"},NOW);
  assert.equal(await copyFieldManualPage(repos,SAMPLE,NOW),0);
  assert.equal((await repos.fieldManual.mustRead("door")).value.summary,"Current source");
});

test("a repeated manual page finishes method evidence after its note rows were already inserted",async()=>{
  const repos=createMemoryRepositories();
  const put=repos.fixMap.put.bind(repos.fixMap);let failed=true;
  repos.fixMap.put=async row=>{if(failed){failed=false;throw new Error("temporary write failure");}await put(row);};
  await assert.rejects(copyFieldManualPage(repos,SAMPLE,NOW),/remains pending/);
  assert.equal(await copyFieldManualPage(repos,SAMPLE,NOW),0);
  assert.equal((await repos.fixMap.forPlace(PIMA)).length,2);
});
