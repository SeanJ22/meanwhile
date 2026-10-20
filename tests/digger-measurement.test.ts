import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { diggerMeasurement } from "../scripts/lib/digger-measurement.ts";
import { withRetainedSourceResponse } from "../scripts/lib/retained-source-replay.ts";
import { withFetch } from "./helpers/with-fetch.ts";

const URL = "https://council.example.gov/calendar", bytes = new TextEncoder().encode("saved calendar bytes ".repeat(20));
const initial = { source: "ical", requestedUrl: URL, finalUrl: URL, retrievedAt: "2026-10-20T07:00:00.000Z",
  httpStatus: 200, contentType: "text/calendar", bytes, byteCount: bytes.length, rawHash: createHash("sha256").update(bytes).digest("hex") };

test("an unread saved response cannot subtract bytes from fresh successful or failed source reads", async () => {
  const meter = diggerMeasurement("one-body", true), sent: string[] = [];
  const replay = await withFetch(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input); sent.push(url);
    if (url.endsWith("/transport-failure")) throw Error("source connection failed");
    return new Response(url.endsWith("/failed-response") ? "failed" : "new", { status: url.endsWith("/failed-response") ? 503 : 200 });
  }, () => withRetainedSourceResponse(initial, () => meter.read(async () => {
    const saved = await fetch(URL);
    // A reader may decide from headers and leave retained bytes unread.
    assert.equal(saved.headers.get("content-type"), "text/calendar");
    assert.equal(await (await fetch(`${URL}/new`)).text(), "new");
    assert.equal(await (await fetch(`${URL}/failed-response`)).text(), "failed");
    await assert.rejects(fetch(`${URL}/transport-failure`), /source connection failed/);
  })));
  assert.equal(replay.reused, true);
  assert.equal(sent.length, 3);
  assert.equal(meter.result().requests, sent.length);
  assert.equal(meter.result().bytesRead, Buffer.byteLength("newfailed"));
});

test("only the one actual replay is excluded when the same URL is read again", async () => {
  const meter = diggerMeasurement("one-body", true);
  let sent = 0;
  await withFetch(async () => { sent++; return new Response("fresh bytes"); }, () => withRetainedSourceResponse(initial, () => meter.read(async () => {
    assert.equal(await (await fetch(URL)).text(), new TextDecoder().decode(bytes));
    assert.equal(await (await fetch(URL)).text(), "fresh bytes");
  })));
  assert.equal(sent, 1);
  assert.equal(meter.result().requests, 1);
  assert.equal(meter.result().bytesRead, Buffer.byteLength("fresh bytes"));
});

test("a source stream that fails after a consumed chunk retains those bytes in failed-attempt accounting", async () => {
  const meter = diggerMeasurement("one-body", true);
  await withFetch(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("part")); setTimeout(() => controller.error(Error("source disconnected")), 0); },
  })), () => meter.read(async () => { await assert.rejects((await fetch(URL)).text(), /source disconnected/); }));
  assert.equal(meter.result().requests, 1);
  assert.equal(meter.result().bytesRead, 4);
});
