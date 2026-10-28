import assert from "node:assert/strict";
import test from "node:test";
import { refreshOfficialStateLegislators } from "../scripts/state-legislators.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { officialStateLegislatorTargetByState } from "../lib/state-rollcalls/authority.ts";
import { azFixture, njFixture } from "./helpers/official-state-rosters.ts";

const AT = "2026-09-09T12:00:00.000Z", LATER = "2026-09-09T13:00:00.000Z";
async function receipt(run: () => Promise<void>) {
  const lines: string[] = [], log = console.log, error = console.error, exitCode = process.exitCode;
  try {
    console.log = (...values: unknown[]) => { lines.push(values.join(" ")); };
    console.error = (...values: unknown[]) => { lines.push(values.join(" ")); };
    await run();
  } finally { console.log = log; console.error = error; process.exitCode = exitCode; }
  const parsed = parseRoutineRunnerReceipt(lines.join("\n"));
  assert.ok(parsed.ok, JSON.stringify(parsed)); return parsed.receipt;
}

for (const state of ["AZ", "NJ"] as const) {
  function fixture() {
    const store = new MemoryRoutineDataStore(), target = officialStateLegislatorTargetByState(state)!;
    let body = state === "AZ" ? azFixture() : njFixture(), now = AT, requests = 0, officeWrites = 0;
    const run = () => receipt(() => refreshOfficialStateLegislators({ state, store, now: () => now,
      fetch: (async input => { assert.equal(String(input), target.probeUrl); requests++; return new Response(body); }) as typeof fetch,
      officePoints: async roster => { officeWrites++; return roster; } }));
    return { store, target, run, bytes: () => body, setBody: (value: string) => { body = value; }, setNow: (value: string) => { now = value; },
      requests: () => requests, officeWrites: () => officeWrites };
  }

  test(`${state} dispatched roster checks actual unchanged bytes without opening held people or office publication`, async () => {
    const f = fixture(), first = await f.run(); assert.equal(first.decision, "GOOD");
    const head = await f.store.readSourceHead("STATE_LEGISLATOR", f.target.jurisdiction); assert.ok(head);
    assert.equal(head.rawHashBasis, "SOURCE_CONTENT_V1");
    const officeWrites = f.officeWrites();
    for (const key of ["readPromotion", "readPromotions", "readCandidate", "readCandidates", "readCandidateProof", "readCandidatePath",
      "readCandidateField", "readPromotionPayloadFields", "readPublishedCandidateMetadata", "events"] as const)
      Object.assign(f.store, { [key]: async () => { throw Error(`same ${state} source opened ${key}`); } });
    f.setNow(LATER); const again = await f.run();
    assert.equal(again.candidateId, first.candidateId); assert.ok(again.confirmedAt);
    assert.equal(f.requests(), 2, "the actual publisher is still checked");
    assert.equal(f.officeWrites(), officeWrites, "an unchanged roster does not republish office points");
  });

  test(`${state} changed transport bytes enter ordinary candidate validation even when roster facts are identical`, async () => {
    const f = fixture(), first = await f.run();
    const original = await f.store.readSourceHead("STATE_LEGISLATOR", f.target.jurisdiction); assert.ok(original);
    const before = await readOfficialStateLegislatorsProjection(f.target.jurisdiction, { store: f.store, now: AT }); assert.equal(before.kind, "PROMOTED");
    let created = 0; const create = f.store.create.bind(f.store);
    f.store.create = async (record, event) => { created++; return create(record, event); };
    f.setBody(f.bytes() + "\n<!-- publisher transport revision -->"); f.setNow(LATER);
    const changed = await f.run();
    assert.equal(changed.decision, "GOOD"); assert.equal(changed.state, "PROMOTED"); assert.equal(changed.confirmedAt, undefined);
    assert.notEqual(changed.candidateId, first.candidateId); assert.equal(created, 1);
    assert.notEqual((await f.store.readSourceHead("STATE_LEGISLATOR", f.target.jurisdiction))?.rawHash, original.rawHash);
    const after = await readOfficialStateLegislatorsProjection(f.target.jurisdiction, { store: f.store, now: LATER }); assert.equal(after.kind, "PROMOTED");
    if (before.kind === "PROMOTED" && after.kind === "PROMOTED")
      assert.deepEqual(after.value.roster.officeholders.map(row => [row.id, row.name]), before.value.roster.officeholders.map(row => [row.id, row.name]));
  });

  test(`${state} identical prior-term bytes cannot use the unchanged gate after the supported term changes`, async () => {
    const f = fixture(), first = await f.run();
    f.setNow(state === "AZ" ? "2027-02-01T12:00:00.000Z" : "2028-02-01T12:00:00.000Z");
    const refused = await f.run();
    assert.equal(refused.state, "SOURCE_BLOCKED"); assert.equal(refused.confirmedAt, undefined);
    assert.equal(refused.lastKnownGoodVersion, first.candidateId);
    assert.equal((await f.store.readSourceHead("STATE_LEGISLATOR", f.target.jurisdiction))?.versionId, first.candidateId);
  });
}
