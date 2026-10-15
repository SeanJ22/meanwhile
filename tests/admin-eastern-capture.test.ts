import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { easternSources } from "../lib/control-plane/data-business/eastern-sources.ts";
import { eventsOfBatch } from "../lib/control-plane/data-business/live.ts";
import { captureWindow, readCaptureHealth } from "../lib/control-plane/admin-view/v6-capture-health.ts";

const batch = (reader: string, times: string[]) => JSON.stringify({ reader, events: times.map(occurredAt => ({ type: "ASK", occurredAt, topic: "education" })) });
test("Eastern day boundaries include daylight saving transitions before removing the time", () => {
  assert.deepEqual(eventsOfBatch(batch("r", ["2026-07-02T03:59:00Z", "2026-07-02T04:00:00Z"]), "America/New_York").map(e=>e.day), ["2026-07-01", "2026-07-02"]);
  assert.deepEqual(eventsOfBatch(batch("r", ["2026-01-02T04:59:00Z", "2026-01-02T05:00:00Z"]), "America/New_York").map(e=>e.day), ["2026-01-01", "2026-01-02"]);
  assert.equal(captureWindow(new Date("2026-07-02T02:00:00Z")).to, "2026-07-01");
});
test("Eastern capture totals and first-ever readers use actual days across UTC midnight", async () => {
  const data = new Map([
    ["events/2026-07-01/new.gz", batch("new", ["2026-07-02T03:50:00Z", "2026-07-02T04:10:00Z"])],
    ["events/2026-07-02/old.gz", batch("old", ["2026-07-03T02:00:00Z"])],
  ]);
  const sources = easternSources({ history: { list: async prefix => [...data.keys()].filter(k=>k.startsWith(prefix)), get: async key => gzipSync(data.get(key)!) },
    query: async () => [{reader_hash:"new",first_day:"2026-07-02"},{reader_hash:"old",first_day:"2026-06-01"}] });
  const view = await readCaptureHealth({sources, switchOn:()=>true}, null, null, new Date("2026-07-03T02:30:00Z"));
  assert.equal(view.to,"2026-07-02");
  assert.equal(view.byType.kind,"READ");
  if (view.byType.kind === "READ") assert.equal(view.byType.rows[0].total,3);
  assert.equal(view.readers.kind,"READ");
  if (view.readers.kind === "READ") {
    assert.deepEqual(view.readers.rows.find(r=>r.day==="2026-07-01"),{day:"2026-07-01",readers:1,newReaders:1,returning:0});
    assert.deepEqual(view.readers.rows.find(r=>r.day==="2026-07-02"),{day:"2026-07-02",readers:2,newReaders:0,returning:2});
  }
  assert.equal(JSON.stringify(view).includes('reader_hash'),false);
  assert.equal(JSON.stringify(view).includes('03:50'),false);
});
