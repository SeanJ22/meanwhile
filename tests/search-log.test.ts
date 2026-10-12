import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertDetailIsAnonymous,
  isValidEventType,
  logSearchEvent,
  prepareSearchLogEvent,
} from "../lib/db/search-log.ts";
import { askKeyHash } from "../lib/db/ask-signal.ts";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { searchLog } from "../lib/db/schema.ts";

test("the transparency page is linked from the welcome overlay and from the map shell", () => {
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
  assert.ok(isValidEventType("ADDRESS_ENTERED"));
  assert.ok(isValidEventType("BALLOT_VIEWED"));
  assert.ok(!isValidEventType("PAGE_VIEW"));
  assert.ok(!isValidEventType(""));
  assert.ok(!isValidEventType(undefined));
});

test("location entries and ballot views retain every district and count the same browser as Ask", () => {
  const districts = ["cd:7", "sldu:20", "sldl:20", "county:pima", "place:tucson", "school_district:unified:tucson", "special:water"]
    .map(id => `ocd-division/country:us/state:az/${id}`);
  const key = "a-reader-browser-key-128-bits";
  for (const eventType of ["ADDRESS_ENTERED", "BALLOT_VIEWED"] as const) {
    const row = prepareSearchLogEvent({ eventType, approximateLocation: "85701", ocdIds: districts,
      continuityKey: key, detail: { page: "BALLOT" } });
    assert.deepEqual(row.ocdIds, districts);
    assert.equal(row.approximateLocation, "85701");
    assert.equal(row.continuityHash, askKeyHash(key));
    assert.notEqual(row.continuityHash, key);
    assert.equal(row.detail?.page, "BALLOT");
    assert.ok(Number.isFinite(Date.parse(row.occurredAt as string)));
    assert.equal(JSON.stringify(row).includes(key), false);
  }
  assert.equal(prepareSearchLogEvent({ eventType: "SEARCH", ocdIds: [] }).continuityHash, null);
});

test("search log Ask questions retain addresses, dates, spaces and long text character for character", () => {
  for (const question of ["Who represents 412 elm st phoenix?", "What happened at the 2026 Budget Hearing?", `  ${"q".repeat(900)}\n`]) {
    const row = prepareSearchLogEvent({ eventType: "QUESTION_ASKED", approximateLocation: "85701",
      ocdIds: [], detail: { page: "ASK", question } });
    assert.equal(row.detail?.question, question);
  }
});

test("search log rejects address and coordinate fields and schema permits both location event types", () => {
  const privateDetails: Record<string, string | number>[] = [{ street: "412 elm st" }, { houseNumber: 412 }, { lat: 32.222 }, { lng: -110.974 }];
  for (const detail of privateDetails) {
    assert.throws(() => prepareSearchLogEvent({ eventType: "ADDRESS_ENTERED", ocdIds: [], detail }), /private address|forbidden fragment/);
  }
  const config = getTableConfig(searchLog);
  const hashColumn = config.columns.find(column => column.name === "continuity_hash")!;
  assert.ok(hashColumn);
  assert.equal(hashColumn.notNull, false);
  const eventCheck = config.checks.find(check => check.name === "search_log_event_type_known")!;
  const checkSql = new PgDialect().sqlToQuery(eventCheck.value).sql;
  assert.match(checkSql, /'ADDRESS_ENTERED'/);
  assert.match(checkSql, /'BALLOT_VIEWED'/);
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
