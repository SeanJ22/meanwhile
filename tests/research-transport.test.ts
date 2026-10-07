/**
 * The research transport: Node first, and a 403 asked once more through curl identifying the project by name,
 * purpose and contact. No test here touches the network.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { identifiedResearchGet, parseCurlIncluded } from "../lib/hunt/research-transport.ts";
import type { ResearchGet } from "../lib/hunt/robots-first-fetch.ts";

const REQUEST = { url: "https://www.newbury.nh.gov/calendar/ical/export.ics", headers: { "user-agent": "we-the-people-freshness/1.0 (civic records refresh; public data; contact via repository)", accept: "*/*" }, timeoutMs: 20_000 };
const CHALLENGE = new TextEncoder().encode("<html><head><title>Just a moment...</title></head></html>");

const answering = (status: number, body: Uint8Array = new Uint8Array(0), location: string | null = null): ResearchGet =>
  async () => ({ status, body, contentType: "text/html", location, transportError: null });

test("an answered read is returned as it came, and curl is never run", async () => {
  let ran = 0;
  const get = identifiedResearchGet({ first: answering(200, new TextEncoder().encode("BEGIN:VCALENDAR")), curl: async () => { ran += 1; return Buffer.from(""); } });
  const got = await get(REQUEST);
  assert.equal(got.status, 200);
  assert.equal(ran, 0);
});

test("a 403 is asked once more through curl, with the same User-Agent and our purpose and contact, never following a redirect", async () => {
  const seen: string[][] = [];
  const get = identifiedResearchGet({
    first: answering(403, CHALLENGE),
    curl: async (args) => {
      seen.push([...args]);
      return Buffer.concat([Buffer.from("HTTP/2 200\r\ncontent-type: text/calendar; charset=utf-8\r\nserver: cloudflare\r\n\r\n"), Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")]);
    },
  });
  const got = await get(REQUEST);
  assert.equal(got.status, 200);
  assert.equal(got.contentType, "text/calendar; charset=utf-8");
  assert.equal(new TextDecoder().decode(got.body), "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  assert.equal(seen.length, 1, "one more request, not a retry storm");
  const args = seen[0];
  assert.ok(!args.includes("-L"), "the caller asks robots.txt of every new origin; curl follows nothing");
  assert.ok(args.includes(`user-agent: ${REQUEST.headers["user-agent"]}`), "the research read's own name");
  assert.ok(args.some((a) => a.startsWith("X-Purpose: we-the-people")));
  assert.ok(args.some((a) => a.startsWith("X-Contact: ")));
  assert.equal(args.at(-1), REQUEST.url);
});

test("a host that refuses the second client too is recorded as refusing, and a curl that cannot run leaves the first answer", async () => {
  const refused = await identifiedResearchGet({ first: answering(403, CHALLENGE), curl: async () => Buffer.from("HTTP/2 403\r\ncf-mitigated: challenge\r\n\r\n<html>Just a moment...</html>") })(REQUEST);
  assert.equal(refused.status, 403);
  const broken = await identifiedResearchGet({ first: answering(403, CHALLENGE), curl: async () => { throw new Error("spawn curl ENOENT"); } })(REQUEST);
  assert.equal(broken.status, 403);
  assert.deepEqual(broken.body, CHALLENGE);
});

test("curl's included headers are read for the status, the type and a redirect's target", () => {
  const moved = parseCurlIncluded(Buffer.from("HTTP/1.1 301 Moved Permanently\r\nLocation: https://www.newbury.nh.gov/\r\nContent-Type: text/html\r\n\r\n"));
  assert.deepEqual({ status: moved.status, location: moved.location, contentType: moved.contentType, bytes: moved.body.byteLength }, { status: 301, location: "https://www.newbury.nh.gov/", contentType: "text/html", bytes: 0 });
  assert.equal(parseCurlIncluded(Buffer.from("garbage")).status, null);
});
