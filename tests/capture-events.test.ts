import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_EVENTS_PER_BATCH,
  readEventBatch,
  type ClientEvent,
} from "../lib/events/wire.ts";

const KEY = "a".repeat(32);
const event = (n: number, extra: Partial<ClientEvent> = {}): ClientEvent => ({
  id: `evt-${String(n).padStart(6, "0")}`,
  type: "CARD_OPEN",
  occurredAt: "2026-10-01T21:00:00.000Z",
  ...extra,
});
const batch = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  batchId: "batch-000001",
  continuityKey: KEY,
  events,
  ...extra,
});

test("S2.4 events: a well-formed batch of every event type is accepted", () => {
  const parsed = readEventBatch(
    batch([
      event(1, { type: "ZIP_VIEW", zip: "85701", locationOrigin: "TYPED_ZIP" }),
      event(2, { cardId: "MEETING:abc", cardKind: "MEETING" }),
      event(3, { type: "CARD_VISIBLE", cardId: "OFFICIAL:x", cardKind: "OFFICIAL", durationMs: 4200.4 }),
      event(4, { type: "ACTIVE_SCROLL", cardId: "MAP", cardKind: "PAGE", durationMs: 10000 }),
      event(5, { type: "AGENDA_VIEW", cardId: "MEETING:abc" }),
      event(6, { type: "REACTION", cardId: "CANDIDATE:x", reaction: "YES" }),
      event(7, { type: "BALLOT_PICK", ballotPick: { contestId: "c1", candidateIds: ["a"], choice: "PICKED" } }),
      event(8, { type: "BALLOT_PICK", ballotPick: { contestId: "c1", candidateIds: [], choice: "UNSURE" } }),
    ]),
  );
  assert.ok(parsed);
  assert.equal(parsed.events.length, 8);
  assert.equal(parsed.events[2].durationMs, 4200);
});

test("S2.4 events: a malformed batch is refused whole, never partly accepted", () => {
  const bad: unknown[] = [
    null,
    batch([]),
    batch([event(1, { type: "SOMETHING_ELSE" as never })]),
    batch([event(1, { zip: "8570" })]),
    batch([event(1, { durationMs: -5 })]),
    batch([event(1, { occurredAt: "yesterday" })]),
    batch([event(1), event(1)]),
    batch([event(1, { ballotPick: { contestId: "c", candidateIds: [], choice: "MAYBE" as never } })]),
    batch([event(1), { ...event(2), name: undefined, id: "x" }]),
    { ...batch([event(1)]), continuityKey: "short" },
    { ...batch([event(1)]), batchId: "!!" },
  ];
  for (const candidate of bad) assert.equal(readEventBatch(candidate), null, JSON.stringify(candidate)?.slice(0, 80));
});

test("S2.4 events: the batch carries nothing a reader typed except through the Ask path", () => {
  const parsed = readEventBatch(batch([{ ...event(1), question: "who is my senator", email: "a@b.co" }]));
  assert.ok(parsed);
  const keys = Object.keys(parsed.events[0]);
  assert.ok(!keys.includes("question") && !keys.includes("email"));
});

test("S2.4 events: the browser batcher retains a refused batch until a later save succeeds", async () => {
  const sent: { batchId: string; events: unknown[] }[] = [];
  let respond: number | "throw" = 503;
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    addEventListener() {},
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
  g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  g.fetch = async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    if (respond === "throw") throw new Error("offline");
    return { ok: respond < 300, status: respond };
  };
  const { captureEvent, flushEvents, resetEventClientForTests } = await import("../lib/events/client.ts");
  resetEventClientForTests();

  for (let i = 0; i < 20; i++) captureEvent({ type: "CARD_OPEN", cardId: `MEETING:${i}`, cardKind: "MEETING" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].events.length, 20);

  flushEvents();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].batchId, sent[0].batchId);

  flushEvents();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 3);
  flushEvents();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 4, "a stalled batch is still waiting after three failures");
  assert.equal(sent[3].batchId, sent[0].batchId);

  respond = 204;
  captureEvent({ type: "ZIP_VIEW", zip: "85701" });
  flushEvents();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 5);
  assert.equal(sent[4].batchId, sent[0].batchId, "the refused batch lands before the new event");
  assert.equal((sent[4] as unknown as { continuityKey: string }).continuityKey, (sent[0] as unknown as { continuityKey: string }).continuityKey);
  flushEvents();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 6);
  assert.equal(sent[5].events.length, 1);
  resetEventClientForTests();
});

test("S2.4 events: an id the event store would refuse is refused here, and card titles are made storable", async () => {
  const { storeSafeId } = await import("../lib/events/wire.ts");
  assert.equal(readEventBatch(batch([event(1, { cardId: "POPUP:official:Jane Roe" })])), null);
  assert.equal(storeSafeId("POPUP:official:Jane Roe"), "POPUP:official:Jane_Roe");
  assert.ok(readEventBatch(batch([event(1, { cardId: storeSafeId("POPUP:official:Jane Roe") })])));
  assert.equal(storeSafeId("x".repeat(500)), "x".repeat(500));
});

test("events retain all candidates, long card ids, long visits and batches beyond the transport split size", () => {
  const cardId = "OFFICIAL:" + "a".repeat(1000);
  const candidateIds = Array.from({ length: 20 }, (_, index) => `candidate:${index}`);
  const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, (_, index) => event(index));
  events[0] = event(0, { cardId, durationMs: 7 * 60 * 60 * 1000, ballotPick: { contestId: "contest", candidateIds, choice: "PICKED" } });
  const parsed = readEventBatch(batch(events));
  assert.ok(parsed);
  assert.equal(parsed.events.length, events.length);
  assert.equal(parsed.events[0].cardId, cardId);
  assert.deepEqual(parsed.events[0].ballotPick?.candidateIds, candidateIds);
  assert.equal(parsed.events[0].durationMs, events[0].durationMs);
});

test("a stalled send retains every queued reader event", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const store = new Map<string, string>();
  g.window = {
    addEventListener() {},
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
  };
  g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  const sent: ClientEvent[] = [];
  let release: (() => void) | undefined;
  let first = true;
  g.fetch = async (_url: string, init: { body: string }) => {
    sent.push(...JSON.parse(init.body).events);
    if (first) {
      first = false;
      await new Promise<void>(resolve => { release = resolve; });
    }
    return { ok: true, status: 204 };
  };
  const { captureEvent, flushEvents, resetEventClientForTests } = await import("../lib/events/client.ts");
  resetEventClientForTests();
  for (let index = 0; index < 700; index++) captureEvent({ type: "CARD_OPEN", cardId: `MEETING:${index}` });
  assert.equal(sent.length, 20, "the first request is still waiting");
  release!();
  await new Promise(resolve => setImmediate(resolve));
  for (let batch = 0; batch < 6; batch++) {
    flushEvents();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(sent.length, 700);
  assert.equal(new Set(sent.map(event => event.id)).size, 700);
  assert.deepEqual(sent.map(event => event.cardId), Array.from({ length: 700 }, (_, index) => `MEETING:${index}`));
  resetEventClientForTests();
});
