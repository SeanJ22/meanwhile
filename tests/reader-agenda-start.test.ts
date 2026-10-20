import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { beginReaderAgenda, discardReaderAgendaStart, fetchReaderAgendaResponse } from "../lib/reader/bootstrap.ts";

const agenda = { meetingId: "meeting:one/a?b", bodyId: "ocd-division/country:us/state:az/place:tucson#governing" };
type FetchCall = { url: string; signal: AbortSignal | null | undefined };

function browser(t: TestContext, respond: (request: number) => Response | Promise<Response> = request => Response.json({ request })) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  t.after(() => {
    discardReaderAgendaStart();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const calls: FetchCall[] = [];
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal });
    return respond(calls.length);
  });
  return calls;
}

test("a meeting selection starts the exact GET before the card and hands its response over once", async t => {
  const calls = browser(t);
  assert.equal(calls.length, 0, "importing the helper starts no agenda read");
  beginReaderAgenda(agenda);
  assert.equal(calls.length, 1, "the selection starts its read before the card consumes it");
  const url = new URL(calls[0].url, "http://localhost");
  assert.equal(url.pathname, "/api/agenda");
  assert.equal(url.searchParams.get("meetingId"), agenda.meetingId);
  assert.equal(url.searchParams.get("bodyId"), agenda.bodyId);
  beginReaderAgenda(agenda);
  assert.equal(calls.length, 1, "the same unconsumed selection does not duplicate its read");
  const response = await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal);
  assert.deepEqual(await response.json(), { request: 1 });
  assert.equal(calls.length, 1);
  const next = await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal);
  assert.deepEqual(await next.json(), { request: 2 }, "a later consumer never receives an already consumed response");
});

test("a response is matched by both meeting and body without consuming another card's intent", async t => {
  const calls = browser(t);
  beginReaderAgenda(agenda);
  const other = await fetchReaderAgendaResponse(agenda.meetingId, "another-body", new AbortController().signal);
  assert.deepEqual(await other.json(), { request: 2 });
  const original = await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal);
  assert.deepEqual(await original.json(), { request: 1 });
  assert.equal(calls.length, 2);
});

test("replacement and dismissal abort unclaimed reads, while the mounted card keeps abort control", async t => {
  const calls = browser(t);
  beginReaderAgenda(agenda);
  const next = { ...agenda, meetingId: "meeting:two" };
  beginReaderAgenda(next);
  assert.equal(calls[0].signal?.aborted, true);
  assert.equal(calls[1].signal?.aborted, false);
  discardReaderAgendaStart();
  assert.equal(calls[1].signal?.aborted, true);
  beginReaderAgenda(next);
  const card = new AbortController();
  const response = await fetchReaderAgendaResponse(next.meetingId, next.bodyId, card.signal);
  assert.equal(response.status, 200);
  card.abort();
  assert.equal(calls[2].signal?.aborted, true, "closing still aborts the original request after its headers arrive");
  assert.equal(calls.length, 3);
});

test("an already dismissed consumer cancels its pending response without starting another request", async t => {
  const calls = browser(t);
  beginReaderAgenda(agenda);
  const card = new AbortController();
  card.abort();
  await assert.rejects(fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, card.signal), { name: "AbortError" });
  assert.equal(calls[0].signal?.aborted, true);
  assert.equal(calls.length, 1);
});

test("a failed selection reaches the card once and a later selection can retry", async t => {
  const failure = new Error("network failed");
  const calls = browser(t, request => request === 1 ? Promise.reject(failure) : Response.json({ request }));
  beginReaderAgenda(agenda);
  await assert.rejects(fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal), error => error === failure);
  assert.equal(calls.length, 1, "failure is exposed rather than automatically retried");
  beginReaderAgenda(agenda);
  const retry = await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal);
  assert.deepEqual(await retry.json(), { request: 2 });
  assert.equal(calls.length, 2);
});

test("a synchronous fetch failure cannot stop opening the card and is consumed without a retry", async t => {
  browser(t);
  const failure = new Error("fetch threw");
  const fetch = t.mock.method(globalThis, "fetch", () => { throw failure; });
  assert.doesNotThrow(() => beginReaderAgenda(agenda));
  await assert.rejects(fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal), error => error === failure);
  assert.equal(fetch.mock.callCount(), 1);
});

test("invalid URL encoding leaves opening and the card's existing error handling intact", async t => {
  const calls = browser(t);
  const invalid = { ...agenda, meetingId: "\uD800" };
  assert.doesNotThrow(() => beginReaderAgenda(invalid));
  assert.equal(calls.length, 0);
  await assert.rejects(async () => fetchReaderAgendaResponse(invalid.meetingId, invalid.bodyId, new AbortController().signal), URIError);
});

test("HTTP errors are handed to the card unchanged and a new selection reads again", async t => {
  const calls = browser(t, request => new Response("", { status: request === 1 ? 503 : 200 }));
  beginReaderAgenda(agenda);
  const failed = await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal);
  assert.equal(failed.status, 503);
  assert.equal(calls.length, 1);
  beginReaderAgenda(agenda);
  assert.equal((await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal)).status, 200);
  assert.equal(calls.length, 2);
});

test("unclaimed intents expire; a claimed response keeps the card's lifecycle", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 5000 });
  const calls = browser(t);
  beginReaderAgenda(agenda);
  t.mock.timers.tick(30_000);
  assert.equal(calls[0].signal?.aborted, true);
  const fresh = await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, new AbortController().signal);
  assert.deepEqual(await fresh.json(), { request: 2 });
  beginReaderAgenda(agenda);
  const card = new AbortController();
  await fetchReaderAgendaResponse(agenda.meetingId, agenda.bodyId, card.signal);
  t.mock.timers.tick(30_001);
  assert.equal(calls[2].signal?.aborted, false, "the handoff removes the unclaimed-intent timer");
  card.abort();
  assert.equal(calls[2].signal?.aborted, true);
});

test("server rendering starts no agenda request", t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Reflect.deleteProperty(globalThis, "window");
  t.after(() => { if (previous) Object.defineProperty(globalThis, "window", previous); });
  const fetch = t.mock.method(globalThis, "fetch");
  beginReaderAgenda(agenda);
  assert.equal(fetch.mock.callCount(), 0);
});
