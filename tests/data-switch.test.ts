import assert from "node:assert/strict";
import test from "node:test";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import { ADMIN_CONFIG_ID, dataSwitchOf, defaultAdminConfig, withDataSwitch, withPlaceTarget } from "../lib/control-plane/gateway/admin-config.ts";
import { RECIPES } from "../lib/control-plane/data-business/recipes.ts";
import { customersOf, defaultOn, switchOn, switchTable } from "../lib/control-plane/data-business/switches.ts";
import { readRecipe } from "../lib/control-plane/data-business/read.ts";
import { placeIndex } from "../lib/control-plane/data-business/places.ts";

const at = "2026-10-01T22:00:00.000Z";
const flip = (c: ReturnType<typeof defaultAdminConfig>, recipe: string, audience: string, on: boolean, receiptId = "r1") => withDataSwitch(c, { recipe, audience, on, decidedAt: at, decidedBy: "owner", receiptId });

test("THE DEFAULT: Admin sees every number, the dashboard and every customer see none, until the owner flips a switch", () => {
  const fresh = defaultAdminConfig(at);
  for (const r of RECIPES) {
    assert.equal(switchOn(fresh, r.id, "admin"), true);
    assert.equal(switchOn(fresh, r.id, "dashboard"), false);
    assert.equal(switchOn(fresh, r.id, "customer:acme"), false);
  }
  assert.equal(switchOn(null, "word-cloud", "admin"), true, "a config that cannot be read still leaves Admin its own tool");
  assert.equal(switchOn(null, "word-cloud", "dashboard"), false, "and is never ON for anyone outside Admin");
  assert.equal(switchOn(fresh, "word-cloud", "someone-else"), false, "an audience that is not one of the three is never on");
  assert.equal(defaultOn("admin"), true);
});

test("A FLIP IS ONE ENTRY: the later flip wins, other switches and other decisions are carried through, a malformed entry reads as none", () => {
  let c = withPlaceTarget(defaultAdminConfig(at), { key: "st:az", goalPercent: 80, decidedAt: at, decidedBy: "o", receiptId: "p1" });
  c = flip(c, "word-cloud", "dashboard", true, "r1");
  c = flip(c, "word-cloud", "customer:acme", true, "r2");
  c = flip(c, "topic-share", "dashboard", true, "r3");
  assert.equal(switchOn(c, "word-cloud", "dashboard"), true);
  c = flip(c, "word-cloud", "dashboard", false, "r4");
  assert.equal(switchOn(c, "word-cloud", "dashboard"), false, "the later flip wins");
  assert.deepEqual(c.dataSwitches?.map((d) => [d.recipe, d.audience, d.on, d.receiptId]), [["topic-share", "dashboard", true, "r3"], ["word-cloud", "customer:acme", true, "r2"], ["word-cloud", "dashboard", false, "r4"]]);
  assert.equal(c.placeTargets?.[0]?.goalPercent, 80, "flipping a switch keeps the place target");
  const bad = { ...c, dataSwitches: [{ recipe: "word-cloud", audience: "dashboard", on: "yes" as unknown as boolean, setAt: at, decidedBy: "o", receiptId: "x" }] };
  assert.equal(dataSwitchOf(bad, "word-cloud", "dashboard"), null);
  assert.equal(switchOn(bad, "word-cloud", "dashboard"), false, "a malformed entry is never ON");
});

test("THE TABLE: every recipe by Admin, the dashboard and each customer the owner has set a switch for", () => {
  const c = flip(flip(defaultAdminConfig(at), "word-cloud", "customer:zeta", true), "topic-share", "customer:acme", true);
  assert.deepEqual(customersOf(c), ["customer:acme", "customer:zeta"]);
  const table = switchTable(c);
  assert.equal(table.length, RECIPES.length);
  const cloud = table.find((r) => r.recipe === "word-cloud")!;
  assert.deepEqual(cloud.cells.map((x) => [x.audience, x.on, x.decided]), [["admin", true, false], ["dashboard", false, false], ["customer:acme", false, false], ["customer:zeta", true, true]]);
});

test("A SWITCH GATES THE READ: flipping it on opens the door, flipping it off closes it, with no data read while it is off", async () => {
  let reads = 0;
  const sources = { places: placeIndex(async () => null, async () => { throw new Error("Map unavailable"); }), totals: async () => { reads += 1; return { kind: "ROWS" as const, rows: [] }; }, cohorts: async () => ({ kind: "ROWS" as const, rows: [] }), events: async () => ({ kind: "ROWS" as const, rows: [] }) };
  let config = defaultAdminConfig(at);
  const ask = () => readRecipe({ recipe: "topic-share", slice: { from: "2026-10-01", to: "2026-10-01" }, audience: "customer:acme" }, { sources, switchOn: (recipe, audience) => switchOn(config, recipe, audience) });
  assert.equal((await ask()).kind, "REFUSED");
  assert.equal(reads, 0);
  config = flip(config, "topic-share", "customer:acme", true);
  assert.equal((await ask()).kind, "READ");
  config = flip(config, "topic-share", "customer:acme", false);
  assert.equal((await ask()).kind, "REFUSED");
  assert.equal(reads, 1);
});

test("THE CONSOLE CONTROL carries the switch to the gateway: target is recipe@audience", () => {
  const src = (target: string) => ({ target, scopeKey: "us", amount: "", words: "", option: "", selected: [] as string[] });
  assert.deepEqual(actionInput("data-switch-on", src("word-cloud@customer:acme")), { recipe: "word-cloud", audience: "customer:acme", on: true });
  assert.deepEqual(actionInput("data-switch-off", src("topic-share@dashboard")), { recipe: "topic-share", audience: "dashboard", on: false });
  const preview = actionDef("data-switch-on").preview({ target: "word-cloud@dashboard", targetName: "word-cloud@dashboard", scopeName: "United States", scopeIsCountry: true, outreachAuthorized: true });
  assert.equal(preview.title, "Switch “Word cloud of what readers ask” on for the dashboard");
  assert.ok(preview.rows.some(([k]) => k === "Undo"));
  assert.equal(ADMIN_CONFIG_ID, "current");
});
