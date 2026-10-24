import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandCenter } from "../app/(admin)/_mw/admin-v6/command-center.tsx";
import { SECTION_IDS } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { liveExecutor } from "../app/(admin)/_mw/admin-v6/executor.ts";
import { buildLiveBundle } from "../app/(admin)/_mw/admin-v6/live-data.ts";
import type { SectionState } from "../app/(admin)/_mw/admin-v6/live-sync.ts";
import { workerStatusFromPulse } from "../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { liveReference } from "../app/(admin)/_mw/admin-v6/reference.ts";
import { withSamQuota } from "../lib/control-plane/admin-view/v6-reliability-read.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { readSavedSamQuota, type SamQuotaHold } from "../lib/federal-money/sam-quota.ts";

function admin(hold: SamQuotaHold, now: string) {
  const snapshot = Object.fromEntries(SECTION_IDS.map(id => [id, {
    phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0,
  }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;
  snapshot.reliability = { phase: "live", data: withSamQuota([], hold, now), asOf: now, revision: "quota", missingParts: [], attempts: 1 };
  return renderToStaticMarkup(createElement(CommandCenter, {
    data: buildLiveBundle(snapshot, liveReference({ scope: { kind: "all" }, observedAt: now }), workerStatusFromPulse(null)),
    mode: "live", executor: liveExecutor({ capabilities: () => null }), scopeKey: "us", onScopeChange: () => {},
    connection: "live", lastGoodAt: now, recovered: false,
    access: { role: "owner", canSpend: true, outreachAuthorized: false }, initialView: "workers",
  }));
}

test("a daily quota answer stops all remaining states and later runs and reaches Admin with its Eastern reset time", async t => {
  let now = "2026-10-23T08:00:00.000Z", calls = 0;
  t.mock.method(Date, "now", () => Date.parse(now));
  const evidenceStore = new MemoryEvidenceStore(), store = new MemoryRoutineDataStore();
  const input = { source: "sam-gov-entities" as const, store, states: ["CT", "DE", "FL"], now: () => now, maxRounds: 1,
    identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquireOptions: { evidenceStore, samGovApiKey: "synthetic-key", retries: 4,
      sleep: async () => { assert.fail("A daily quota answer must not start a retry timer"); },
      fetch: async () => { calls++; return Response.json({ code: "900804", message: "Message throttled out",
        description: "You have exceeded your quota .You can access API after 2026-Oct-24 00:00:00+0000 UTC",
        nextAccessTime: "2026-Oct-24 00:00:00+0000 UTC" }, { status: 429, headers: { "Retry-After": "Sat, 24 Oct 2026 00:00:00 GMT" } }); } },
  };
  const first = await refreshFederalMoney(input);
  assert.equal(calls, 1, "DE and FL make zero requests after CT's quota answer");
  assert.equal(first.outcome.promoted, null);
  assert.equal(first.projection.states.length, 3);
  for (const state of first.projection.states) {
    assert.equal(state.status, "OUTAGE");
    assert.match(state.reason ?? "", /2026-10-24T00:00:00.000Z/);
  }
  now = "2026-10-23T23:59:59.999Z";
  await refreshFederalMoney(input);
  assert.equal(calls, 1, "a later scheduled invocation also makes zero requests before reset");
  const hold = await readSavedSamQuota(evidenceStore);
  assert.ok(hold);
  const rows = withSamQuota([], hold, now);
  assert.equal(rows[0].state, "waiting");
  assert.equal(rows[0].successes, null, "missing Scout history is unknown, not zero");
  const html = admin(hold, now);
  assert.match(html, /SAM.gov entities/);
  assert.match(html, /Waiting for daily reset/);
  assert.match(html, /reset Oct 23, 8:00 PM ET/);
  assert.match(html, /Requests are paused until then/);
  assert.doesNotMatch(html, /900804|synthetic-key/);
  const afterReset = admin(hold, "2026-10-24T00:00:00.000Z");
  assert.match(afterReset, /Reset time passed/);
  assert.match(afterReset, /The next scheduled run can try again/);
  assert.doesNotMatch(afterReset, /Requests are paused until then/);
});
