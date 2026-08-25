import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertDetailIsAnonymous,
  isValidEventType,
  logSearchEvent,
} from "../lib/db/search-log.ts";

/**
 * The search log's write-path guarantees, and the coupling rule: logging and
 * the transparency page ship together or not at all. Collecting silently and
 * disclosing later is the failure this product cannot survive, and an
 * unlisted URL does not change it.
 */

test("logging and the transparency page exist together", () => {
  // If this file's imports resolved, the logging half exists — so the
  // disclosure half must too, and must actually disclose.
  const page = join(process.cwd(), "app", "transparency", "page.tsx");
  assert.ok(
    existsSync(page),
    "lib/db/search-log.ts exists but app/transparency/page.tsx does not — 5a shipped without 5b",
  );
  const source = readFileSync(page, "utf8");
  for (const claim of ["collected", "aggregate", "zip"]) {
    assert.ok(
      source.toLowerCase().includes(claim),
      `the transparency page never mentions "${claim}"`,
    );
  }

  const logRoute = join(process.cwd(), "app", "api", "log", "route.ts");
  assert.ok(existsSync(logRoute), "the client log route is missing");
});

test("the transparency page is linked from the welcome overlay and from the map shell", () => {
  /*
   * **THE CLAIM IS REACHABILITY, NOT A FILE PATH.** This named
   * `components/shell/sidebar.tsx` and went red on 2026-08-25 when LAY-8 moved
   * the footnote block out of the rail to the foot of the page — the link was
   * never removed, and the guard could not see that because it was asserting
   * where the link lives rather than that a reader can reach it.
   *
   * That is the predicate-too-narrow shape the reconciliation of the same day
   * named in three separate defects, so the fix is to widen the predicate
   * rather than to repoint it at the new file and wait for the next move.
   *
   * The welcome overlay is asserted on its own because it is a different
   * moment: the first screen, before any zip. The shell is asserted as a SET —
   * at least one of the components that make up the persistent map furniture
   * carries the link, whichever one currently owns the footnote.
   */
  const overlay = readFileSync(
    join(process.cwd(), "components", "map", "welcome-overlay.tsx"),
    "utf8",
  );
  assert.ok(
    overlay.includes('"/transparency"'),
    "the welcome overlay does not link /transparency",
  );

  const shell = [
    join(process.cwd(), "components", "shell", "sidebar.tsx"),
    join(process.cwd(), "components", "map", "site-footnote.tsx"),
    join(process.cwd(), "components", "map", "map-entry.tsx"),
  ];
  const linking = shell.filter(
    (file) => existsSync(file) && readFileSync(file, "utf8").includes('"/transparency"'),
  );
  assert.ok(
    linking.length > 0,
    `no component of the map shell links /transparency — checked ${shell.length}: ${shell.join(", ")}`,
  );
});

test("detail bags that could name a person are rejected, not laundered", () => {
  assert.throws(
    () => assertDetailIsAnonymous({ userId: "abc" }),
    /forbidden fragment/,
  );
  assert.throws(
    () => assertDetailIsAnonymous({ ip_address: "1.2.3.4" }),
    /forbidden fragment/,
  );
  assert.throws(
    () => assertDetailIsAnonymous({ sessionKey: "s" }),
    /forbidden fragment/,
  );
  // Non-scalars could smuggle structure past the schema's jsonb.
  assert.throws(
    () =>
      assertDetailIsAnonymous({
        nested: { deep: true } as unknown as string,
      }),
    /scalar/,
  );
  // The event-shaped facts the routes actually send are fine.
  assertDetailIsAnonymous({ tier: "exact", radiusKm: 25, meetingCount: 5 });
});

test("event types are a closed set", () => {
  assert.ok(isValidEventType("SEARCH"));
  assert.ok(isValidEventType("MEETING_OPENED"));
  assert.ok(isValidEventType("OFFICIAL_OPENED"));
  assert.ok(!isValidEventType("PAGE_VIEW"));
  assert.ok(!isValidEventType(""));
  assert.ok(!isValidEventType(undefined));
});

test("a malformed event throws; a missing database is a quiet false", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(
      logSearchEvent({
        eventType: "SEARCH",
        approximateLocation: "255 W Alameda St",
        ocdIds: [],
      }),
      /five-digit zip/,
      "a street address must never reach the log",
    );

    await assert.rejects(
      logSearchEvent({
        // @ts-expect-error deliberately wrong
        eventType: "PAGE_VIEW",
        ocdIds: [],
      }),
      /unknown search log event type/,
    );

    const stored = await logSearchEvent({
      eventType: "SEARCH",
      approximateLocation: "85701",
      ocdIds: ["ocd-division/country:us/state:az/place:tucson"],
      detail: { tier: "exact", radiusKm: 25 },
    });
    assert.equal(stored, false, "no DATABASE_URL must mean no write and no throw");
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});
