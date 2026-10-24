import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { prepareReaderEventBatch } from "../lib/db/reader-events.ts";
import { liveSources } from "../lib/control-plane/data-business/live.ts";
import { readRecipe, leavable } from "../lib/control-plane/data-business/read.ts";
import { switchOn } from "../lib/control-plane/data-business/switches.ts";
import { readCaptureHealth } from "../lib/control-plane/admin-view/v6-capture-health.ts";

test("archive → candidate recipe preserves race, candidate and geography, excludes unsure, blanks and synthetic events", async () => {
  const events = [
    { id: "one", candidateIds: ["a", "b"], choice: "PICKED" as const },
    { id: "two", candidateIds: ["a"], choice: "PICKED" as const },
    { id: "three", candidateIds: [], choice: "UNSURE" as const },
    { id: "four", candidateIds: [], choice: "BLANK" as const },
  ].map(({ id, ...ballotPick }) => ({ id, type: "BALLOT_PICK" as const, occurredAt: "2026-10-23T12:00:00Z", zip: "85701", district: "ocd-division/country:us/state:az/cd:7", ballotPick: { contestId: "race", ...ballotPick } }));
  const prepared = prepareReaderEventBatch({ batchId: "archive-batch", continuityKey: "anonymous", events });
  const batches = new Map([[prepared.archiveKey, gzipSync(prepared.json)], ["events/2026-10-23/synthetic.json.gz", gzipSync(JSON.stringify({ ...prepared.body, tester: true }))]]);
  const sources = liveSources({ query: null, history: {
    list: async prefix => [...batches.keys()].filter(key => key.startsWith(prefix)), get: async key => batches.get(key) ?? null,
  } });
  const slice = { from: "2026-10-23", to: "2026-10-23", grain: "day", place: { kind: "zip", id: "85701" } };
  const read = () => readRecipe({ recipe: "candidate-pick-totals", audience: "admin", slice }, { sources, switchOn: (recipe, audience) => switchOn(null, recipe, audience) });
  const result = await read();
  assert.equal(result.kind, "READ");
  assert.ok(result.kind === "READ" && result.body.shape === "picks");
  assert.deepEqual(result.body.rows, [
    { period: "2026-10-23", race: "race", candidate: "a", zip: "85701", district: events[0]!.district, value: 2, readers: 1 },
    { period: "2026-10-23", race: "race", candidate: "b", zip: "85701", district: events[0]!.district, value: 1, readers: 1 },
  ]);
  assert.equal(prepared.aggregates.find(row => row.period === "DAY" && row.type === "BALLOT_PICK" && row.topic === "*" && row.zip === "" && row.district === "")?.events, 4, "candidate expansion never changes anonymous event totals");
  const again = await read();
  assert.ok(again.kind === "READ");
  assert.deepEqual(again.body, result.body, "reading the archive again cannot increment anything");
  const denied = await readRecipe({ recipe: "candidate-pick-totals", audience: "dashboard", slice }, { sources, switchOn: (recipe, audience) => switchOn(null, recipe, audience) });
  assert.ok(denied.kind === "REFUSED" && denied.why === "SWITCH_OFF");
  const extra = { ...result.body, rows: result.body.rows.map(row => ({ ...row, secret: "remove", reader: prepared.reader, occurredAt: "2026-10-23T12:00:00Z" })) };
  assert.deepEqual(leavable(extra, "picks"), result.body);
  const admin = await readCaptureHealth({ sources, switchOn: () => true }, null, null, new Date("2026-10-24T12:00:00Z"));
  assert.deepEqual(admin.candidatePicks, { kind: "READ", rows: result.body.rows }, "the next day's ordinary Admin read consumes the archive recipe");
});
