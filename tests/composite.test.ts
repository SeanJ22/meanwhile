import assert from "node:assert/strict";
import { test } from "node:test";

import { CompositeSource } from "../lib/sources/composite/index.ts";
import { accountedNormalize } from "../lib/sources/normalize-account.ts";
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
      if (behave.failFetch) throw new Error(`${name} upstream broke`);
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
      // Two different sittings. Two listings identical in every detail would
      // be one sitting listed twice, which the composite now shows once.
      meetings: (raw) => raw.map((_, i) => ({ ...meetingOf(`good:m${i}`), startsAt: `2026-09-0${i + 1}T19:00:00.000-07:00` })),
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

  // A different place is a different cache entry.
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

/* ---- F22: a wall and a broken job are not the same kind of nothing ------- */

/**
 * **F22 item 2 (2026-08-20).**
 *
 * `ok: false` used to carry a vendor timeout and a violated id-namespace
 * contract in the same flag, so `scripts/ingest.ts` treated a WALL and a
 * defect in our own code identically: name it, skip it, carry its rows, exit
 * 0. A broken adapter therefore rendered as a walled vendor and kept the run
 * green — the failed-operation-as-empty-success shape, wearing the other
 * face. And the converse cost more: because everything was a wall, nothing
 * could be a job failure, so the run's exit status said nothing at all.
 *
 * The contract now: the retrieval not landing is a `WALL`; our own code
 * breaking on bytes we did hold is a `JOB` failure. `scripts/ingest.ts` reads
 * this to decide the exit status, which is why it is pinned here rather than
 * left as a comment.
 */
test("F22: a failed FETCH is a WALL — named, skipped, and the run continues", async () => {
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

test("F22: a broken NAMESPACE is a JOB failure — the run must go red", async () => {
  // The child fetches fine and returns rows under someone else's namespace.
  // Nothing about the ladder fixes this and no wall fell; it is our bug.
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

test("F22: a normalize that THROWS is a JOB failure, not a wall", async () => {
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

test("F22: a walled child records the ladder rung it stopped at", async () => {
  // The shared client attaches `rung` to the error it throws; the composite
  // forwards it verbatim and records ABSENT as absent — a rung is never
  // filled in with a plausible number.
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
