import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { appendReaderEvents, eventWeek, prepareReaderEventBatch, type ReaderEventBatchInput } from "../lib/db/reader-events.ts";

const batch: ReaderEventBatchInput = { batchId: "batch-1", continuityKey: "anonymous-browser-random-value", events: [
  { id: "event-1", type: "ASK", occurredAt: "2026-09-27T23:59:00-07:00", zip: "85635", district: "ocd-division/country:us/state:az/county:cochise", topic: "water", question: "My name is Jane Smith. Email jane@example.com about water." },
  { id: "event-2", type: "REACTION", occurredAt: "2026-09-28T06:59:00Z", zip: "85635", topic: "water", cardId: "funding:committee:1", reaction: "agree" },
] };

test("each pick, clear and unsure event is filed under its race and elections topic", () => {
  for (const choice of ["PICKED", "UNSURE", "BLANK"] as const) {
    const prepared = prepareReaderEventBatch({ ...batch, events: [{ id: "pick-1", type: "BALLOT_PICK", occurredAt: "2026-10-23T12:00:00Z",
      ballotPick: { contestId: "ca-sos-retention-evans", candidateIds: choice === "PICKED" ? ["YES"] : [], choice } }] });
    assert.equal(prepared.body.events[0].cardId, "ca-sos-retention-evans");
    assert.equal(prepared.body.events[0].cardKind, "CONTEST");
    assert.equal(prepared.body.events[0].topic, "elections-voting");
    assert.ok(prepared.aggregates.some(row => row.topic === "elections-voting" && row.type === "BALLOT_PICK"));
  }
});

test("history preserves exact event time and card context, scrubs text and rolls counts by UTC day/week", () => {
  const prepared = prepareReaderEventBatch(batch);
  assert.equal(prepared.body.events[0]!.occurredAt, "2026-09-28T06:59:00.000Z");
  assert.equal(eventWeek("2026-09-27"), "2026-09-21");
  assert.equal(eventWeek("2026-09-28"), "2026-09-28");
  assert.ok(!prepared.json.includes(batch.continuityKey));
  assert.ok(!prepared.json.includes("jane@example.com") && !prepared.json.includes("Jane Smith"));
  assert.ok(prepared.body.events[0]!.selfDisclosureFlags.includes("EMAIL"));
  const day = prepared.aggregates.find(row => row.period === "DAY" && row.zip === "85635" && row.district === "" && row.topic === "water" && row.type === "*");
  assert.equal(day?.events, 2);
  assert.equal(day?.start, "2026-09-28");
  assert.equal(prepareReaderEventBatch(structuredClone(batch)).sha256, prepared.sha256);
  const meeting = prepareReaderEventBatch({ ...batch, events: [{ ...batch.events[0]!, topic: null, question: "When is the next council meeting?" }] });
  assert.equal(meeting.body.events[0]!.topic, "meetings-agendas");
  assert.throws(() => prepareReaderEventBatch({ ...batch, events: [batch.events[0]!, batch.events[0]!] }), /DUPLICATE_ID/);
});

test("archive failure prevents database totals; retries reuse the archive and existing aggregate batch", async () => {
  const original = process.env.WTP_DB_ROLE;
  process.env.WTP_DB_ROLE = "local";
  try {
    let queried = 0;
    await assert.rejects(() => appendReaderEvents(batch, {
      archive: { put: async () => { throw new Error("archive down"); } },
      query: async () => { queried++; return []; },
    }), /archive down/);
    assert.equal(queried, 0);
    const saved = new Map<string, { bytes: Uint8Array; hash: string }>();
    let recorded = false;
    const options = {
      archive: { put: async (key: string, bytes: Uint8Array, hash: string) => {
        if (saved.has(key)) assert.equal(saved.get(key)!.hash, hash);
        else saved.set(key, { bytes, hash });
      } },
      query: async (statement: string, params: readonly unknown[]) => {
        assert.ok(statement.includes("ON CONFLICT (batch_id) DO NOTHING"));
        assert.ok(!JSON.stringify(params).includes("jane@example.com"));
        const first = !recorded; recorded = true;
        return [{ recorded: first, previous_hash: params[2] }];
      },
    };
    assert.equal((await appendReaderEvents(batch, options)).duplicate, false);
    assert.equal((await appendReaderEvents(batch, options)).duplicate, true);
    assert.equal(saved.size, 1);
    const history = JSON.parse(gunzipSync([...saved.values()][0]!.bytes).toString());
    assert.equal(history.events[1].cardId, "funding:committee:1");
    assert.equal(history.events.length, 2);
    const unmatched = { ...batch, events: [{ ...batch.events[0]!, topic: null, question: "The place is damp from a burst pipe." }] };
    let label = "water-sewer";
    const derived = { ...options, classifyTopic: async () => label };
    recorded = false; saved.clear();
    assert.equal((await appendReaderEvents(unmatched, derived)).duplicate, false);
    label = "free-form";
    assert.equal((await appendReaderEvents(unmatched, derived)).duplicate, true);
    assert.equal(saved.size, 1, "derived labels never change the captured batch's retry digest");
  } finally {
    if (original === undefined) delete process.env.WTP_DB_ROLE; else process.env.WTP_DB_ROLE = original;
  }
});
