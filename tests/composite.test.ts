import assert from "node:assert/strict";
import { test } from "node:test";

import { CompositeSource } from "../lib/sources/composite/index.ts";
import type {
  Meeting,
  MeetingQuery,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../lib/sources/types.ts";

/**
 * The composite's own guarantees, against stub children — no adapters, no
 * network. What is pinned here is the *mechanism*: failure isolation, the
 * namespacing contract, the accounting, and the cache.
 */

const QUERY: MeetingQuery = { lat: 32.2, lng: -110.9, radiusKm: 150 };

const ZERO: NormalizeDropCounts = {
  placeless: 0,
  unknownVenue: 0,
  unplaceableInTime: 0,
  notConfigured: 0,
};

function meetingOf(id: string): Meeting {
  return {
    id,
    ocdId: "ocd-division/country:us/state:az/county:pima",
    bodyName: "Stub Board",
    title: "Stub Meeting",
    startsAt: "2026-09-01T19:00:00.000-07:00",
    timeZone: "America/Phoenix",
    location: { name: "Stub Hall", address: null, lat: 32.2, lng: -110.9 },
    agendaUrl: null,
    jurisdiction: "Stub, AZ",
    status: "SCHEDULED",
    provenance: {
      sourceUrl: null,
      sourceOrg: "Stub",
      collectedAt: "2026-08-13T00:00:00Z",
      verifiedAt: null,
    },
  };
}

function stubChild(
  name: string,
  behave: {
    rows?: unknown[];
    failFetch?: boolean;
    hangFetch?: boolean;
    meetings?: (raw: unknown[]) => Meeting[];
  },
): ReportingMeetingSource<unknown> {
  return {
    name,
    async fetch() {
      if (behave.hangFetch) return new Promise(() => {});
      if (behave.failFetch) throw new Error(`${name} upstream broke`);
      return behave.rows ?? [];
    },
    normalize(raw) {
      return behave.meetings?.(raw as unknown[]) ?? [];
    },
    normalizeWithDrops(raw) {
      return {
        meetings: behave.meetings?.(raw as unknown[]) ?? [],
        drops: { ...ZERO },
      };
    },
    async upsert(meetings) {
      return { inserted: 0, updated: meetings.length };
    },
  };
}

test("one child failing never blanks the map, and the failure is reported", async () => {
  const composite = new CompositeSource([
    stubChild("good", {
      rows: [1, 2],
      meetings: (raw) => raw.map((_, i) => meetingOf(`good:m${i}`)),
    }),
    stubChild("broken", { failFetch: true }),
  ]);

  const raw = await composite.fetch(QUERY);
  const meetings = composite.normalize(raw, new Date("2026-08-13T12:00:00Z"));

  assert.equal(meetings.length, 2, "the healthy child's meetings survive");

  const report = composite.lastReport;
  assert.ok(report);
  const broken = report.children.find((c) => c.source === "broken");
  assert.ok(broken);
  assert.equal(broken.ok, false);
  assert.match(broken.error ?? "", /upstream broke/);
  const good = report.children.find((c) => c.source === "good");
  assert.equal(good?.ok, true);
  assert.equal(good?.normalized, 2);
});

test("a hung child times out and the others still return", async () => {
  const composite = new CompositeSource(
    [
      stubChild("hung", { hangFetch: true }),
      stubChild("fast", {
        rows: [1],
        meetings: () => [meetingOf("fast:m0")],
      }),
    ],
    { timeoutMs: 50 },
  );

  const raw = await composite.fetch(QUERY);
  const meetings = composite.normalize(raw, new Date("2026-08-13T12:00:00Z"));

  assert.equal(meetings.length, 1);
  const hung = composite.lastReport?.children.find((c) => c.source === "hung");
  assert.equal(hung?.ok, false);
  assert.match(hung?.error ?? "", /timed out/);
});

test("a child violating the namespacing contract is excluded and reported", async () => {
  const composite = new CompositeSource([
    stubChild("sloppy", {
      rows: [1],
      // A "legistar:"-prefixed id from a child named "sloppy" would collide
      // with the real legistar's rows downstream.
      meetings: () => [meetingOf("legistar:pima:999")],
    }),
    stubChild("clean", { rows: [1], meetings: () => [meetingOf("clean:m0")] }),
  ]);

  const raw = await composite.fetch(QUERY);
  const meetings = composite.normalize(raw, new Date("2026-08-13T12:00:00Z"));

  assert.deepEqual(
    meetings.map((m) => m.id),
    ["clean:m0"],
    "only the namespaced child's meetings pass",
  );
  const sloppy = composite.lastReport?.children.find((c) => c.source === "sloppy");
  assert.equal(sloppy?.ok, false);
  assert.match(sloppy?.error ?? "", /not namespaced/);
});

test("the cache serves a repeat query without re-fetching, and reports so", async () => {
  let fetches = 0;
  const counting: ReportingMeetingSource<unknown> = {
    name: "counting",
    async fetch() {
      fetches++;
      return [1];
    },
    normalize: () => [meetingOf("counting:m0")],
    normalizeWithDrops: () => ({
      meetings: [meetingOf("counting:m0")],
      drops: { ...ZERO },
    }),
    upsert: async (m) => ({ inserted: 0, updated: m.length }),
  };

  const composite = new CompositeSource([counting], { ttlMs: 60_000 });

  composite.normalize(await composite.fetch(QUERY));
  composite.normalize(await composite.fetch(QUERY));

  assert.equal(fetches, 1, "second query served from cache");
  assert.equal(composite.lastReport?.fromCache, true);

  // A different place is a different cache entry.
  await composite.fetch({ lat: 40.9, lng: -74.5, radiusKm: 150 });
  assert.equal(fetches, 2);
});

test("drops from every child surface in the report, per source", async () => {
  const droppy: ReportingMeetingSource<unknown> = {
    name: "droppy",
    fetch: async () => [1, 2, 3],
    normalize: () => [],
    normalizeWithDrops: () => ({
      meetings: [],
      drops: { placeless: 2, unknownVenue: 1, unplaceableInTime: 0, notConfigured: 0 },
    }),
    upsert: async (m) => ({ inserted: 0, updated: m.length }),
  };

  const composite = new CompositeSource([droppy]);
  composite.normalize(await composite.fetch(QUERY));

  const report = composite.lastReport?.children[0];
  assert.equal(report?.fetched, 3);
  assert.equal(report?.drops.placeless, 2);
  assert.equal(report?.drops.unknownVenue, 1);
});
