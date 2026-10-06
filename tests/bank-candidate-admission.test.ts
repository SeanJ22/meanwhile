import test from "node:test";
import assert from "node:assert/strict";
import { admitValidatedBankCandidates } from "../lib/control-plane/bank-candidate-admission.ts";
import { emptyCandidateStore, proposeCandidate, markValidated } from "../lib/method/candidate.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ConcurrentModification } from "../lib/control-plane/repository/types.ts";
import { writeFieldManual, readFieldManual } from "../lib/control-plane/field-manual.ts";
import { readMethodKnowledge } from "../lib/method/manual-bridge.ts";
import { knowledgeEntries, methodFixture, methodVersionEntry } from "./method-store-fixture.ts";
import type { LearnedRoute } from "../lib/method/learn-batch.ts";
const stamp = "2026-10-06T05:00:00Z";
async function setup(count = 3) {
  const repos = createMemoryRepositories(); const fixture = methodFixture();
  await writeFieldManual(repos, [...knowledgeEntries(fixture), methodVersionEntry(fixture)], stamp);
  let store = emptyCandidateStore();
  for (let i = 0; i < count; i++) {
    const proposal: LearnedRoute = { id: "backlog-meetings", title: "Grounded saved route", tier: "A1", fields: ["meetings"],
      note: "GET saved official feed", origin: "SCOUT durable artifact provenance",
      claims: [{ id: "backlog-meetings#exists", class: "ROUTE_EXISTENCE", statement: "https://city.gov/meetings answered under ALLOWED permission; durable artifact", restsOn: [] }],
      outcome: { jurisdiction: `ocd-division/country:us/state:az/place:body${i}`, rows: 1, outcome: "YIELDED", note: `saved evidence ${i}` } };
    const offered = proposeCandidate(store, { attemptId: `old-${i}`, proposal, submittedAt: "2026-10-01", observedMethodVersion: fixture.version });
    store = markValidated(offered.store, offered.candidate.id, { at: "2026-10-01", againstMethodVersion: fixture.version, introduced: [], preExisting: 0, ok: true }).store;
  }
  await repos.methodCandidates.put("live", store, stamp); return repos;
}
test("all old validated offers on one route admit without a new offer, in one Bank write", async () => {
  const repos = await setup(757); const original = repos.fieldManual.compareAndSet; let writes = 0;
  repos.fieldManual.compareAndSet = async (...args) => { writes++; return original(...args); };
  const report = await admitValidatedBankCandidates({ repos, stamp });
  assert.equal(report.before.VALIDATED, 757); assert.equal(report.after.ADMITTED, 757); assert.equal(writes, 1);
  const route = (await readMethodKnowledge(repos)).routes.find(r => r.id === "backlog-meetings")!;
  assert.equal(route.outcomes.length, 757); assert(route.outcomes.every(r => r.walkedOn === "2026-10-01"));
  const manual = await readFieldManual(repos); assert.equal(manual.store.entries.filter(e => e.source === "scout-candidate").length, 1);
  const again = await admitValidatedBankCandidates({ repos, stamp }); assert.equal(again.decisions.length, 0); assert.equal(writes, 1);
});
test("a Bank outage leaves validated offers resumable; retry finishes them", async () => {
  const repos = await setup(); const original = repos.fieldManual.compareAndSet;
  repos.fieldManual.compareAndSet = async () => { throw Error("store unavailable"); };
  const failed = await admitValidatedBankCandidates({ repos, stamp }); assert.equal(failed.after.ADMITTED, 0); assert.equal(failed.after.VALIDATED, 3);
  repos.fieldManual.compareAndSet = original;
  const retried = await admitValidatedBankCandidates({ repos, stamp }); assert.equal(retried.after.ADMITTED, 3);
});
test("candidate CAS conflict retries idempotently after the Bank write", async () => {
  const repos = await setup(); const original = repos.methodCandidates.compareAndSet; let calls = 0;
  repos.methodCandidates.compareAndSet = async (...args) => { if (++calls === 1) throw new ConcurrentModification("candidate", "live", args[1], args[1]+1); return original(...args); };
  const report = await admitValidatedBankCandidates({ repos, stamp }); assert.equal(report.after.ADMITTED, 3);
  assert.equal((await readMethodKnowledge(repos)).routes.find(r=>r.id === "backlog-meetings")!.outcomes.length, 3);
});
test("missing saved proof is reported and is never admitted or fabricated", async () => {
  const repos = await setup(); const row = (await repos.methodCandidates.read("live"))!;
  await repos.methodCandidates.compareAndSet("live", row.revision, { ...row.value, candidates: row.value.candidates.map(c=>({ ...c, validation: null })) }, stamp);
  const report = await admitValidatedBankCandidates({ repos, stamp }); assert.equal(report.after.VALIDATED, 3); assert(report.decisions.every(d=>d.why.includes("evidence")));
});
