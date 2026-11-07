import assert from "node:assert/strict";
import http from "node:http";
import type net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { readSetting, settingDefinition } from "../lib/control-plane/settings.ts";
import { LIVE_VISITS_DEFAULT, LIVE_VISITS_SETTING, takeLiveVisit, type LiveVisitLedger } from "../lib/ops/live-visits.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { guardProxy, openSite, type LocalSite } from "../scripts/site.mts";

const MORNING = "2026-11-07T09:00:00.000Z";
const NEXT_MORNING = "2026-11-08T09:00:00.000Z";

describe("the daily live-site allowance", () => {
  it("lets each check open the live site only its allowance of times a day, and starts over the next day", () => {
    let ledger: LiveVisitLedger | null = null;
    const used: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      const taken = takeLiveVisit(ledger, "resident-tasks", MORNING, 3);
      ledger = taken.ledger;
      used.push(taken.live);
    }
    assert.deepEqual(used, [true, true, true, false, false]);
    assert.equal(takeLiveVisit(ledger, "look-pass", MORNING, 3).live, true, "another check has its own allowance");
    assert.equal(takeLiveVisit(ledger, "resident-tasks", NEXT_MORNING, 3).live, true, "a new day starts over");
  });

  it("keeps every visit on the runner's copy when the allowance is zero", () => {
    assert.equal(takeLiveVisit(null, "resident-tasks", MORNING, 0).live, false);
  });

  it("is an Admin setting that reads its default and refuses nonsense", () => {
    const definition = settingDefinition(LIVE_VISITS_SETTING);
    assert.ok(definition);
    assert.equal(readSetting(null, LIVE_VISITS_SETTING, LIVE_VISITS_DEFAULT), LIVE_VISITS_DEFAULT);
    assert.equal(definition.validate(0), true);
    assert.equal(definition.validate(-1), false);
    assert.equal(definition.validate(2.5), false);
    assert.equal(readSetting({ settings: { [LIVE_VISITS_SETTING]: 7 } }, LIVE_VISITS_SETTING, LIVE_VISITS_DEFAULT), 7);
  });
});

describe("where a check opens the site", () => {
  const dir = () => join(mkdtempSync(join(tmpdir(), "site-target-")), "live-visits.json");
  const stub = () => {
    const calls = { started: 0, stopped: 0, addresses: [] as { runId: string; writes: boolean }[] };
    const local: LocalSite = {
      sha: "abc",
      address: async (run) => { calls.addresses.push(run); return "http://127.0.0.1:4000"; },
      stop: async () => { calls.stopped += 1; },
    };
    return { calls, start: async () => { calls.started += 1; return local; } };
  };
  const run = { runId: "t@x", writes: false };

  it("sends only the allowance to the live site and everything after to the runner's own copy", async () => {
    const { calls, start } = stub();
    const site = openSite({ label: "look-pass", now: MORNING, perDay: 2, ledgerPath: dir(), start });
    const seen = [];
    for (let i = 0; i < 6; i += 1) seen.push(await site.next(run));
    assert.deepEqual(seen.map((v) => v.live), [true, true, false, false, false, false]);
    assert.deepEqual(seen.slice(0, 2).map((v) => v.origin), [PUBLIC_SITE_ORIGIN, PUBLIC_SITE_ORIGIN]);
    assert.equal(seen[5].origin, "http://127.0.0.1:4000");
    assert.equal(calls.started, 1, "the copy is started once, on first need");
    await site.stop();
    assert.equal(calls.stopped, 1, "and the check stops it");
  });

  it("counts across runs of the same check on the same day, so hourly runs cannot add up to more", async () => {
    const path = dir();
    const { start } = stub();
    const first = openSite({ label: "resident-tasks", now: MORNING, perDay: 1, ledgerPath: path, start });
    assert.equal((await first.next(run)).live, true);
    const second = openSite({ label: "resident-tasks", now: "2026-11-07T10:00:00.000Z", perDay: 1, ledgerPath: path, start });
    assert.equal((await second.next(run)).live, false);
  });

  it("never starts the copy when every visit is live, and stops nothing it never started", async () => {
    const { calls, start } = stub();
    const site = openSite({ label: "worst-case-speed", now: MORNING, perDay: 3, ledgerPath: dir(), start });
    assert.equal(site.nextLive()?.origin, PUBLIC_SITE_ORIGIN);
    assert.equal(site.nextLive()?.live, true);
    assert.equal(site.nextLive()?.live, true);
    assert.equal(site.nextLive(), null, "the speed pass stops when its live visits are used");
    await site.stop();
    assert.equal(calls.started, 0);
  });

  it("goes to a base URL someone asked for by hand and counts nothing", async () => {
    const { calls, start } = stub();
    const site = openSite({ label: "look-pass", now: MORNING, perDay: 0, ledgerPath: dir(), start, fixedOrigin: "http://localhost:3000" });
    assert.equal((await site.next(run)).origin, "http://localhost:3000");
    assert.equal(calls.started, 0);
  });
});

describe("the guard in front of the runner's copy", () => {
  async function fixture(writes: boolean) {
    const seen: { url: string; marker: string | undefined }[] = [];
    const upstream = http.createServer((req, res) => { seen.push({ url: req.url ?? "", marker: req.headers["x-wtp-synthetic-run"] as string | undefined }); res.end("ok"); });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await guardProxy((upstream.address() as net.AddressInfo).port, { runId: "look-pass@2026", writes });
    const base = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
    return { seen, base, close: () => { proxy.close(); upstream.close(); } };
  }

  it("passes page and data reads through with the run marker, refuses the map relay and the write routes", async () => {
    const f = await fixture(false);
    try {
      assert.equal(await (await fetch(`${f.base}/ballot?zip=85701`)).text(), "ok");
      await assert.rejects(fetch(`${f.base}/api/maptiler/maps/basic/style.json`));
      await assert.rejects(fetch(`${f.base}/api/log`, { method: "POST", body: "{}" }));
      await assert.rejects(fetch(`${f.base}/api/ask?q=hi`));
      assert.deepEqual(f.seen, [{ url: "/ballot?zip=85701", marker: "look-pass@2026" }]);
    } finally { f.close(); }
  });

  it("lets Ask through when the run is the one that asks, and still refuses the map relay", async () => {
    const f = await fixture(true);
    try {
      assert.equal(await (await fetch(`${f.base}/api/ask`, { method: "POST", body: "{}" })).text(), "ok");
      await assert.rejects(fetch(`${f.base}/api/maptiler/tiles/v3/1/1/1.pbf`));
      assert.equal(f.seen.length, 1);
    } finally { f.close(); }
  });
});
