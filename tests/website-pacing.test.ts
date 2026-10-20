import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { admitWebsiteRequest, createWebsitePacing, memoryWebsitePacing, WEBSITE_HELD_SQL, WEBSITE_PACING_DDL, WEBSITE_WINDOW_MS } from "../lib/control-plane/website-pacing.ts";

const NOW = Date.parse("2026-10-20T12:00:00Z");

test("shared pacing reads one exact site's hold while preserving cross-reader hourly counts and reserved sends", async () => {
  const pg = new PGlite(), reads: {sql: string; params: readonly unknown[]; rows: unknown[]}[] = [];
  const query = async (sql: string, params: readonly unknown[]) => {
    const rows = (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
    if (sql === WEBSITE_HELD_SQL) reads.push({sql, params, rows});
    return rows;
  };
  try {
    for (const ddl of WEBSITE_PACING_DDL) await pg.exec(ddl);
    const first = createWebsitePacing(query), second = createWebsitePacing(query);
    await pg.query(`INSERT INTO cp_website_pacing(site,hold_until,updated_at)
      SELECT 'other-'||n||'.gov',$1::timestamptz,$2::timestamptz FROM generate_series(1,2000) n`,
    [new Date(NOW + 600_000).toISOString(), new Date(NOW).toISOString()]);
    await first.hold("own.gov", NOW + 60_000, NOW);
    await second.hold("own.gov", NOW + 30_000, NOW);
    assert.equal(await second.heldUntil("own.gov", NOW), NOW + 60_000);
    assert.equal(await second.heldUntil("missing.gov", NOW), null);
    assert.equal(await second.heldUntil("own.gov", NOW + 60_000), null);
    assert.deepEqual(reads.map(row => row.params[0]), ["own.gov", "missing.gov", "own.gov"]);
    assert.ok(reads.every(row => row.rows.length <= 1 && JSON.stringify(row.rows).length < 100));
    assert.match(WEBSITE_HELD_SQL, /WHERE site=\$1 AND hold_until>\$2/);
    assert.ok(!JSON.stringify(reads).includes("other-"));
    for (let n = 0; n < 10; n++) assert.deepEqual(await (n % 2 ? first : second).take("tiny.gov", 10, NOW), {ok: true});
    assert.deepEqual(await second.take("tiny.gov", 10, NOW), {ok: false, until: NOW + WEBSITE_WINDOW_MS});
    assert.deepEqual(await first.take("tiny.gov", 10, NOW + WEBSITE_WINDOW_MS), {ok: true});
    assert.equal(await first.reserve("pace:provider", 100, NOW), NOW);
    assert.equal(await second.reserve("pace:provider", 100, NOW), NOW + 100);
  } finally { await pg.close(); }
});

test("local pacing retains an early site's allowance, Retry-After and reservation across a national host walk without evicting live state", async () => {
  const pacing = memoryWebsitePacing(), independent = memoryWebsitePacing();
  assert.deepEqual(await pacing.take("first.gov", 1, NOW), {ok: true});
  await pacing.hold("first.gov", NOW + 60_000, NOW);
  await pacing.hold("first.gov", NOW + 30_000, NOW);
  assert.equal(await pacing.reserve("pace:first.gov", 100, NOW), NOW);
  for (let n = 0; n < 20_000; n++) {
    const site = `other-${n}.gov`;
    assert.deepEqual(await pacing.take(site, 1, NOW), {ok: true});
    await pacing.hold(site, NOW + 60_000, NOW);
    await pacing.reserve(`pace:${site}`, 100, NOW);
  }
  assert.deepEqual(await pacing.take("first.gov", 1, NOW), {ok: false, until: NOW + WEBSITE_WINDOW_MS});
  assert.equal(await pacing.heldUntil("first.gov", NOW), NOW + 60_000);
  assert.equal(await pacing.heldUntil("first.gov", NOW + 60_000), null);
  assert.equal(await pacing.reserve("pace:first.gov", 100, NOW), NOW + 100);
  assert.deepEqual(await independent.take("first.gov", 1, NOW), {ok: true}, "separate process-local readers retain their own fallback state");
  assert.equal(await independent.heldUntil("first.gov", NOW), null);
  assert.equal(await independent.reserve("pace:first.gov", 100, NOW), NOW);
  assert.deepEqual(await admitWebsiteRequest(pacing, "https://first.gov/read", 1, NOW + WEBSITE_WINDOW_MS), {ok: true});
});

test("Fleet caches only its current site's point read and remembers an observed hold through other sites and a reader outage", async () => {
  const shared = memoryWebsitePacing(), reads: string[] = [];
  let now = NOW, unavailable = false, sent = 0;
  const controller = new FleetSafetyController({now: new Date(NOW).toISOString(), charges: [], clock: () => now,
    websitePacing: {...shared, async heldUntil(site, at) {
      reads.push(site);
      if (unavailable) throw new Error("Reader unavailable");
      return shared.heldUntil(site, at);
    }}});
  const open = controller.guardedOpenOne("public-web", "point-held-site", async () => {sent++; return new Response("ok");});
  const request = (site: string) => open({url: `https://${site}/read`, method: "GET", headers: {}, timeoutMs: 1000});
  assert.equal((await request("one.gov")).status, 200);
  assert.equal((await request("one.gov")).status, 200);
  assert.equal((await request("two.gov")).status, 200);
  assert.equal((await request("one.gov")).status, 200);
  assert.deepEqual(reads, ["one.gov", "two.gov", "one.gov"]);
  await shared.hold("one.gov", NOW + 90_000, now);
  now += 30_000;
  assert.match((await request("one.gov")).transportError ?? "", /^WEBSITE_ASKED_TO_WAIT:/);
  assert.equal((await request("two.gov")).status, 200);
  unavailable = true;
  assert.match((await request("one.gov")).transportError ?? "", /^WEBSITE_ASKED_TO_WAIT:/);
  assert.equal(sent, 5);
  now = NOW + 90_000;
  assert.equal((await request("one.gov")).status, 200, "the saved hold expires normally even while the reader is unavailable");
});
