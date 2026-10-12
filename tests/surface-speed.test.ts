/** Per-surface share over three seconds, errors and dead links on the Scoreboard row; a surface over its limit leads the stuck list and opens one fix item. */
import assert from "node:assert/strict";
import test from "node:test";

import { speedRow } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import { readSurfaceItems } from "../lib/control-plane/admin-view/v6-stuck-surfaces.ts";
import { stuckViews } from "../lib/control-plane/admin-view/v6-stuck-read.ts";
import { fixItems } from "../lib/control-plane/fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { openSurfaceFixes } from "../lib/health/surface-fixes.ts";
import { deadLinkItems, deadLinkReadings, slowSurfaceItems, surfaceSpeeds } from "../lib/health/surface-speed.ts";
import { judgeSpeed, type SpeedRun } from "../lib/health/worst-case-speed.ts";
import { upsertSystemDoor } from "../lib/doors/link-sweep-store.ts";

const AT = "2026-10-05T11:00:00.000Z";
const NOW = "2026-10-05T12:00:00.000Z";
const run = (surface: string, ms: number | null, zip = "00001", profile: "phone" | "desktop" = "phone"): SpeedRun => ({ surface, zip, profile, ms });
const pass = judgeSpeed([
  run("ballot", 900), run("ballot", 900, "00002"), run("ballot", 1200, "00001", "desktop"), run("ballot", 800, "00002", "desktop"),
  run("meetings", 4200), run("meetings", 900, "00002"), run("meetings", null, "00001", "desktop"), run("meetings", 800, "00002", "desktop"),
], AT);

test("each surface's visits, slow visits and errors are counted separately", () => {
  const by = new Map(surfaceSpeeds(pass).map((s) => [s.surface, s]));
  assert.deepEqual([by.get("ballot")!.visits, by.get("ballot")!.over, by.get("ballot")!.errors], [4, 0, 0]);
  assert.deepEqual([by.get("meetings")!.visits, by.get("meetings")!.slow, by.get("meetings")!.errors, by.get("meetings")!.over], [4, 1, 1, 2]);
});

test("the row shows the share per surface, errors and dead links, labeled as our own visits", () => {
  const dead = [{ surface: "agenda PDFs", links: 40, dead: 3, sweptAt: AT }];
  const row = speedRow(pass, dead);
  assert.match(row.counts ?? "", /1 errors|1 error/);
  assert.match(row.counts ?? "", /3 dead links/);
  assert.match(row.says ?? "", /our own test visits, not readers'/);
  assert.ok(row.items?.includes("The meetings page: 2 of 4 visits over 3 seconds, 1 never finished"));
  assert.ok(row.items?.includes("Links, agenda PDFs: 3 dead of 40"));
  assert.match(row.says ?? "", /meetings page is over the limit/i);
  assert.match(speedRow(pass, null).items?.join("|") ?? "", /dead-link check could not be read/);
});

test("a surface over its limit is at the top of the stuck list, ahead of ordinary work and beside shut doors; one under it is not listed", () => {
  const items = slowSurfaceItems(pass, 0.2, NOW);
  assert.deepEqual(items.map((i) => i.id), ["surface:meetings"]);
  assert.equal(slowSurfaceItems(pass, 0.6, NOW).length, 0, "2 of 4 is under a 60% limit");
  assert.equal(slowSurfaceItems(null, 0.2, NOW).length, 0);
  const view = stuckViews([], "us", NOW, [...items, ...deadLinkItems([{ surface: "agenda PDFs", links: 40, dead: 3, sweptAt: AT }], 1, NOW)]);
  assert.deepEqual(view.items.map((i) => i.id), ["surface:meetings", "links:agenda PDFs"]);
  assert.equal(view.items[0].readersAffected, true);
});

test("the pass opens one fix item per surface over its limit, and the same gap seen again is the same item", async () => {
  const repos = createMemoryRepositories();
  await upsertSystemDoor(repos.doors, { doorId: "links:agenda-PDFs", kind: "link-sweep", holds: ["links"], config: { surface: "agenda PDFs", links: 40, ok: 30, dead: 3, later: 0, waiting: 7, sweptAt: AT, deadAddresses: [] }, notes: "n" }, AT);
  const first = await openSurfaceFixes(repos, pass, NOW);
  const again = await openSurfaceFixes(repos, pass, "2026-10-05T13:00:00.000Z");
  assert.equal(first.opened.length, 2);
  assert.deepEqual(again.opened, first.opened);
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config = held && isAdminConfig(held.value) ? held.value : null;
  const items = config ? fixItems(config) : [];
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.where).sort(), ["Links: agenda PDFs", "The meetings page"]);
  assert.ok(items.every((i) => i.state === "OPEN"));
  assert.deepEqual(deadLinkReadings([]), []);
  assert.deepEqual((await readSurfaceItems(NOW)).items, [], "no control plane here: nothing is invented");
});
