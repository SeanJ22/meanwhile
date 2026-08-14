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

test("the transparency page is linked from the welcome overlay and the sidebar footer", () => {
  for (const file of [
    join(process.cwd(), "components", "map", "welcome-overlay.tsx"),
    join(process.cwd(), "components", "shell", "sidebar.tsx"),
  ]) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      source.includes('"/transparency"'),
      `${file} does not link /transparency`,
    );
  }
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
