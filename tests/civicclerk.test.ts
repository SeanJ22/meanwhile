import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeCivicClerkSource, readCivicClerkPages, type CivicClerkEvent } from "../lib/sources/civicclerk/index.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";

const text = (path: string) => readFileSync(new URL(`./fixtures/civicclerk/${path}`, import.meta.url), "utf8");
const json = (path: string) => JSON.parse(text(path));
const tenants = [["avondaleaz", "AZ", "America/Phoenix"], ["mandannd", "ND", "America/Chicago"], ["franklintn", "TN", "America/Chicago"]] as const;
const wiring = (tenant: string, state: string, zone: string, categoryId: number): BodySourceWiring => ({
  bodyId: `ocd-division/country:us/state:${state.toLowerCase()}/place:${tenant}#body:${categoryId}`,
  ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/place:${tenant}`, agendaSourceType: "CIVICCLERK",
  jurisdiction: tenant, publishingOrg: tenant, timeZone: zone, verifiedAt: "2026-10-13T19:00:00Z",
  config: { slug: tenant, apiBase: `https://${tenant}.api.civicclerk.com`, portalBase: `https://${tenant}.portal.civicclerk.com`, categoryId: String(categoryId) },
});

for (const [tenant, state, zone] of tenants) test(`${state}: real ${tenant} categories publish their own meetings and documents`, () => {
  const sourceText = text(`${tenant}/Events.json`), meta = json(`${tenant}/Events.meta.json`);
  assert.equal(createHash("sha256").update(sourceText).digest("hex"), meta.sha256);
  assert.equal(meta.state, state);
  const events: CivicClerkEvent[] = JSON.parse(sourceText).value;
  const categories = new Set(json(`${tenant}/EventCategories.json`).value.map((row: { id: number }) => row.id));
  const now = new Date("2026-10-13T19:00:00Z");
  for (const categoryId of new Set(events.map(event => event.categoryId!))) {
    assert.ok(categories.has(categoryId));
    const row = wiring(tenant, state, zone, categoryId);
    const output = makeCivicClerkSource([row]).normalizeWithDrops([{ wiring: row, events, collectedAt: meta.retrievedAt }], now);
    assert.equal(output.meetings.length, events.filter(event => event.categoryId === categoryId && !event.isDeleted && event.isPublished === "Published").length);
    for (const meeting of output.meetings) {
      assert.equal(meeting.bodyId, row.bodyId);
      const event = events.find(event => meeting.id.endsWith(`:${event.id}`))!;
      assert.equal(meeting.publishedLinks?.length, event.publishedFiles?.filter(file => file.fileId > 0).length ?? 0);
      if (/cancelled/i.test(event.eventName ?? "")) assert.equal(meeting.status, "CANCELED");
      for (const link of meeting.publishedLinks ?? []) assert.match(link.href, /^https:\/\//);
    }
  }
});

test("the recorded Franklin continuation chain retains all 215 events beyond 200", async () => {
  const manifest = json("franklintn/paging/manifest.json");
  const replies = new Map<string, string>(manifest.pages.map((page: { sourceUrl: string; file: string; sha256: string }) => {
    const body = text(`franklintn/paging/${page.file}`);
    assert.equal(createHash("sha256").update(body).digest("hex"), page.sha256);
    return [new URL(page.sourceUrl).href, body];
  }));
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input); seen.push(url);
    assert.ok(replies.has(url), url);
    return new Response(replies.get(url), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const rows = await readCivicClerkPages(manifest.pages[0].sourceUrl, fetchImpl);
  assert.equal(rows.length, 215); assert.equal(new Set(rows.map(row => row.id)).size, 215);
  assert.equal(seen.length, 15);
});

test("offset paging handles a full 200-row page and refuses repeated or external continuations", async () => {
  const template = json("franklintn/Events.json").value[0];
  const base = "https://franklintn.api.civicclerk.com/v1/Events?$top=200";
  const fetchImpl = (async (input: string | URL | Request) => {
    const skip = Number(new URL(String(input)).searchParams.get("$skip"));
    return Response.json({ value: Array.from({ length: skip === 0 ? 200 : 3 }, (_, i) => ({ ...template, id: skip + i + 1 })) });
  }) as typeof fetch;
  assert.equal((await readCivicClerkPages(base, fetchImpl)).length, 203);
  for (const next of [base, "https://other.example/Events"]) {
    await assert.rejects(readCivicClerkPages(base, (async () => Response.json({ value: [template], "@odata.nextLink": next })) as typeof fetch), /PAGING/);
  }
  await assert.rejects(readCivicClerkPages(base, (async () => Response.json({ value: Array.from({ length: 200 }, () => template) })) as typeof fetch), /NOT_ADVANCING/);
});

test("composite transport checks change first and shares one category feed across its bodies", async () => {
  const events: CivicClerkEvent[] = json("avondaleaz/Events.json").value;
  const ids = [...new Set(events.map(event => event.categoryId!))].slice(0, 2);
  const rows = ids.map(id => wiring("avondaleaz", "AZ", "America/Phoenix", id));
  const seen: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input)); seen.push(url);
    const body = url.pathname.endsWith("EventCategories") ? json("avondaleaz/EventCategories.json")
      : url.searchParams.get("$top") === "1" ? { value: [{ id: events[0].id }] } : { value: events };
    return Response.json(body);
  }) as typeof fetch;
  const source = buildCompositeSource({ derivedRows: rows, fetchImpl, sourceNames: ["civicclerk"] });
  const result = await source.fetch({ lat: 33.4, lng: -112.3, radiusKm: 100, startsAfter: "2026-06-15T00:00:00Z", startsBefore: "2027-02-10T00:00:00Z" });
  assert.equal(seen[0].searchParams.get("$top"), "1");
  assert.equal(seen.filter(url => url.searchParams.get("$top") === "200").length, 1);
  const meetings = source.normalize(result, new Date("2026-10-13T19:00:00Z"));
  assert.ok(meetings.length > 0);
  assert.ok(meetings.every(meeting => rows.some(row => row.bodyId === meeting.bodyId)));
});

test("discovery walks every public category even when the first event sample names only one body", async () => {
  const categories = json("avondaleaz/EventCategories.json").value;
  const events: CivicClerkEvent[] = json("avondaleaz/Events.json").value;
  const seen: number[] = [];
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: "az:city:avondale", stateCode: "AZ", name: "Avondale", govClass: "MUNICIPALITY",
    ownWebAddress: "https://www.avondaleaz.gov/", basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "GAP_LEDGER", versionId: "fixture" } }, {
    open: async input => {
      const url = new URL(input.url);
      let body = "";
      if (url.pathname === "/robots.txt") body = "User-agent: *\nAllow: /\n";
      else if (url.hostname === "www.avondaleaz.gov" && url.pathname === "/") body = '<a href="https://avondaleaz.portal.civicclerk.com">Meetings</a>';
      else if (url.pathname === "/v1/EventCategories") body = text("avondaleaz/EventCategories.json");
      else if (url.pathname === "/v1/Events") {
        const match = /categoryId eq (\d+)/.exec(url.searchParams.get("$filter") ?? "");
        if (match) seen.push(Number(match[1]));
        body = JSON.stringify({ value: match ? events.filter(event => event.categoryId === Number(match[1])).slice(0, Number(url.searchParams.get("$top"))) : events.slice(0, 1) });
      }
      return { status: body ? 200 : 404, body, bytes: body.length, contentType: url.hostname.endsWith(".api.civicclerk.com") ? "application/json" : "text/html", location: null, transportError: null };
    }, maxRequestsPerWalk: 100, now: () => "2026-10-13T19:00:00Z", spaceOut: async () => {}, budget: { spent: () => false },
    vault: async artifact => ({ stored: true, where: `fixture/${artifact.id}`, why: "Recorded category and event bytes; isolated homepage transport" }),
  });
  assert.deepEqual(new Set(seen), new Set(categories.filter((category: { isPublic?: boolean }) => category.isPublic !== false).map((category: { id: number }) => category.id)));
  assert.ok(attempt.found.some(found => found.url.includes("categoryId")));
});

test("Mandan's shared General category keeps the wellness committee separate from the loan committees", () => {
  const events: CivicClerkEvent[] = json("mandannd/Events.json").value;
  const row = wiring("mandannd", "ND", "America/Chicago", 24);
  row.config = { ...row.config, bodyName: "Safety and Wellness Committee", titleMatch: "Safety and Wellness Committee" };
  const meetings = makeCivicClerkSource([row]).normalizeWithDrops([{ wiring: row, events, collectedAt: json("mandannd/Events.meta.json").retrievedAt }], new Date("2026-10-13T19:00:00Z")).meetings;
  assert.equal(meetings.length, events.filter(event => event.categoryId === 24 && event.eventName?.includes("Safety and Wellness Committee")).length);
  assert.ok(meetings.length > 0);
  assert.ok(meetings.every(meeting => meeting.bodyName === row.config.bodyName && !/loan committee/i.test(meeting.title)));
});

test("the reader advances $skip after fifteen-row continuations exhaust the 200-row query cap", async () => {
  const manifest = json("franklintn/paging/manifest.json");
  const events: CivicClerkEvent[] = manifest.pages.flatMap((page: { file: string }) => json(`franklintn/paging/${page.file}`).value);
  const seen: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input)); seen.push(url);
    const skip = Number(url.searchParams.get("$skip") ?? 0), remaining = Number(url.searchParams.get("$top") ?? 200);
    const count = Math.min(15, remaining, events.length - skip);
    const value = events.slice(skip, skip + count);
    const next = new URL(url);
    next.searchParams.set("$skip", String(skip + count)); next.searchParams.set("$top", String(remaining - count));
    return Response.json({ value, ...(count === 15 && remaining > count ? { "@odata.nextLink": next.href } : {}) });
  }) as typeof fetch;
  const rows = await readCivicClerkPages("https://franklintn.api.civicclerk.com/v1/Events?$top=200&$orderby=id%20desc", fetchImpl);
  assert.equal(rows.length, 215);
  assert.ok(seen.some(url => url.searchParams.get("$skip") === "200" && url.searchParams.get("$top") === "200"));
});
