import assert from "node:assert/strict";
import { test } from "node:test";

import { CompositeSource } from "../lib/sources/composite/index.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { accountedNormalize } from "../lib/sources/normalize-account.ts";
import type {
  Meeting,
  MeetingQuery,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../lib/sources/types.ts";

const QUERY: MeetingQuery = { lat: 32.2, lng: -110.9, radiusKm: 150 };

test("family members share a calendar response while each keeps its acquisition, and companion feeds share the site allowance", async () => {
  let calls = 0;
  const fetchImpl = meetingFetchPass({ websiteSize: () => ({kind: "local-government", population: 9_999}),
    fetchImpl: async () => { calls++; return new Response("saved calendar"); } });
  const url = "https://county.example.gov/calendar.ics";
  const captured = await captureSourceAcquisitions(async run => {
    for (const source of ["ical", "official-page-events"]) await run(source, async () => {
      assert.equal(await (await fetchImpl(url)).text(), "saved calendar");
    });
  });
  assert.equal(calls, 1);
  assert.deepEqual(captured.evidence.map(e => e.source), ["ical", "official-page-events"]);
  assert.equal(captured.evidence[0].rawHash, captured.evidence[1].rawHash);
  for (let i = 0; i < 9; i++) await fetchImpl(`https://www.county.example.gov/companion-${i}.ics`);
  await assert.rejects(fetchImpl("https://county.example.gov/eleventh.ics"), /shared website request bound/);
  assert.equal(calls, 10);
  assert.equal(await (await fetchImpl(url)).text(), "saved calendar", "held same-pass bytes remain usable after the allowance");
  await fetchImpl("https://another.example.gov/calendar.ics");
  assert.equal(calls, 11, "another site has its own allowance");
});

test("shared meeting reads retain the identified curl fallback, its destination and both request costs", async () => {
  let fetched = 0, curled = 0;
  const fetchImpl = meetingFetchPass({ websiteSize: () => ({kind: "school-district", students: 4_999}),
    fetchImpl: async () => { fetched++; return new Response("refused", { status: 403 }); },
    curl: async url => { curled++; return { status: 200, contentType: "text/calendar", text: "calendar",
      bytes: new TextEncoder().encode("calendar"), finalUrl: `${url}?final=1` }; } });
  const url = "https://county.example.gov/calendar.ics";
  for (let i = 0; i < 2; i++) {
    const response = await fetchImpl(url);
    assert.equal(response.url, `${url}?final=1`);
    assert.equal(await response.text(), "calendar");
  }
  assert.deepEqual([fetched, curled], [1, 1]);
  for (let i = 0; i < 4; i++) await fetchImpl(`https://county.example.gov/companion-${i}.ics`);
  await assert.rejects(fetchImpl("https://county.example.gov/next.ics"), /shared website request bound/);
  assert.deepEqual([fetched, curled], [5, 5]);
});

test("shared meeting reads do not cap unknown, large, state, federal or national publishers", async () => {
  for (const size of [undefined, {kind: "local-government", population: 10_000}, {kind: "school-district", students: 5_000},
    {kind: "state"}, {kind: "federal"}, {kind: "national"}] as const) {
    let calls = 0;
    const read = meetingFetchPass({websiteSize: () => size, fetchImpl: async () => { calls++; return new Response("calendar"); }});
    for (let i = 0; i < 12; i++) await read(`https://example.gov/calendar-${i}.ics`);
    assert.equal(calls, 12);
  }
});

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
    failWith?: unknown;
    hangFetch?: boolean;
    onAbort?: () => void;
    meetings?: (raw: unknown[]) => Meeting[];
  },
): ReportingMeetingSource<unknown> {
  return {
    name,
    async fetch(query) {
      if (behave.hangFetch) {
        return new Promise((_resolve, reject) => {
          const signal = query.signal;
          assert.ok(signal, "a composite child must receive its exact cancellation domain");
          const abort = () => {
            behave.onAbort?.();
            reject(signal.reason ?? new Error("source aborted"));
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      if (behave.failWith !== undefined) throw behave.failWith;
      if (behave.failFetch) throw new Error(`HTTP 503 for https://${name}.example.gov/calendar`);
      return behave.rows ?? [];
    },
    normalize(raw) {
      return behave.meetings?.(raw as unknown[]) ?? [];
    },
    normalizeWithDrops(raw) {
      return accountedNormalize(name, raw as unknown[], {
        meetings: behave.meetings?.(raw as unknown[]) ?? [],
        drops: { ...ZERO },
      });
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
  assert.match(broken.error ?? "", /HTTP 503 for https:\/\/broken\.example\.gov/);
  const good = report.children.find((c) => c.source === "good");
  assert.equal(good?.ok, true);
  assert.equal(good?.normalized, 2);
});

test("a hung child times out and the others still return", async () => {
  let activeHung = 1;
  const composite = new CompositeSource(
    [
      stubChild("hung", { hangFetch: true, onAbort: () => { activeHung -= 1; } }),
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
  assert.match(hung?.error ?? "", /acquisition deadline/);
  assert.equal(activeHung, 0, "the report waits for the timed-out child to abort; no orphan remains");
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
    normalizeWithDrops: (raw) =>
      accountedNormalize("counting", raw, {
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

  await composite.fetch({ lat: 40.9, lng: -74.5, radiusKm: 150 });
  assert.equal(fetches, 2);
});

test("drops from every child surface in the report, per source", async () => {
  const droppy: ReportingMeetingSource<unknown> = {
    name: "droppy",
    fetch: async () => [1, 2, 3],
    normalize: () => [],
    normalizeWithDrops: (raw) =>
      accountedNormalize("droppy", raw, {
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

test("a failed FETCH is a WALL — named, skipped, and the run continues", async () => {
  const composite = new CompositeSource([
    stubChild("walled", { failFetch: true }),
    stubChild("healthy", { rows: [1], meetings: () => [meetingOf("healthy:a")] }),
  ]);

  const meetings = composite.normalize(await composite.fetch(QUERY));
  const report = composite.lastReport;
  const walled = report?.children.find((c) => c.source === "walled");

  assert.equal(walled?.ok, false, "the planted fetch failure did not fail the child");
  assert.equal(walled?.failure, "WALL", "a retrieval that did not land is not a WALL");
  assert.equal(
    meetings.length,
    1,
    "the healthy child lost its rows to the other child's wall",
  );
});

test("2026-09-24: an exception OUR code throws before any request is a JOB, never the publisher's wall", async () => {
  const composite = new CompositeSource([
    stubChild("ours", { failWith: new Error("VENUE_RESOLUTIONS_MISSING:legistar:ocd-division/country:us/state:az/county:pima") }),
    stubChild("programming", { failWith: new TypeError("Cannot read properties of undefined (reading 'venues')") }),
    stubChild("network", { failWith: new TypeError("fetch failed") }),
    stubChild("healthy", { rows: [1], meetings: () => [meetingOf("healthy:a")] }),
  ]);
  const meetings = composite.normalize(await composite.fetch(QUERY));
  const kind = (source: string) => composite.lastReport?.children.find((c) => c.source === source)?.failure;
  assert.equal(kind("ours"), "JOB");
  assert.equal(kind("programming"), "JOB");
  assert.equal(kind("network"), "WALL", "a network failure is still the publisher's side");
  assert.equal(meetings.length, 1, "a JOB failure never costs a healthy sibling its rows");
});

test("a broken NAMESPACE is a JOB failure — the run must go red", async () => {
  const composite = new CompositeSource([
    stubChild("offender", { rows: [1], meetings: () => [meetingOf("somebodyelse:a")] }),
  ]);

  composite.normalize(await composite.fetch(QUERY));
  const child = composite.lastReport?.children.find((c) => c.source === "offender");

  assert.equal(child?.ok, false);
  assert.equal(
    child?.failure,
    "JOB",
    "a violated namespace contract still reads as a wall — a code defect would keep the run green",
  );
});

test("a normalize that THROWS is a JOB failure, not a wall", async () => {
  const composite = new CompositeSource([
    stubChild("parser", {
      rows: [1],
      meetings: () => {
        throw new Error("unexpected shape in the vendor payload");
      },
    }),
  ]);

  composite.normalize(await composite.fetch(QUERY));
  const child = composite.lastReport?.children.find((c) => c.source === "parser");

  assert.equal(child?.ok, false);
  assert.equal(
    child?.failure,
    "JOB",
    "the bytes were in hand and our parser threw — that is not a retrieval wall",
  );
});

test("a walled child records the ladder rung it stopped at", async () => {
  const withRung: ReportingMeetingSource<unknown> = {
    ...stubChild("rung4", {}),
    async fetch() {
      throw Object.assign(new Error("HTTP 200 carrying a challenge page"), { rung: 4 });
    },
  };
  const composite = new CompositeSource([withRung, stubChild("norung", { failFetch: true })]);

  composite.normalize(await composite.fetch(QUERY));
  const children = composite.lastReport?.children ?? [];

  assert.equal(children.find((c) => c.source === "rung4")?.walledAtRung, 4);
  assert.equal(
    children.find((c) => c.source === "norung")?.walledAtRung,
    undefined,
    "a rung the client could not name was invented",
  );
});
