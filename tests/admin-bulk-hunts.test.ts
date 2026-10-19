import assert from "node:assert/strict";
import test from "node:test";

import { parseZips } from "@/lib/control-plane/bulk-hunts/parse.ts";
import { planBudgets } from "@/lib/control-plane/bulk-hunts/plan.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ActionRequest } from "@/lib/control-plane/gateway/contract.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { expansionScopesOf } from "@/lib/control-plane/expansion/scopes.ts";
import type { GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";


const COOK = [
  "district,state,cd,incumbent,map_status,zip,zip_type,active,city,county,other_cd119_touching,evidence,confidence,note",
  'AZ-06,AZ,06,"Ciscomani, Juan",UNCHANGED,85635,STANDARD,True,Sierra Vista,Cochise,,ZCTA overlap,HIGH,',
  'AZ-06,AZ,06,"Ciscomani, Juan",UNCHANGED,85641,STANDARD,True,Vail,Pima,,ZCTA overlap,HIGH,',
  'AZ-06,AZ,06,"Ciscomani, Juan",UNCHANGED,85641,STANDARD,True,Vail,Pima,,ZCTA overlap,HIGH,',
  'CA-22,CA,22,"Valadao, David",REDRAWN_2026,93301,STANDARD,True,Bakersfield,Kern,,REMOVED_2026 left the district,N/A,',
  'CA-22,CA,22,"Valadao, David",REDRAWN_2026,,STANDARD,True,,,,PROP 50 AREA — ZIPs UNRESOLVED,N/A,',
  "MA-01,MA,01,X,UNCHANGED,2135,STANDARD,True,Brighton,Suffolk,,ZCTA overlap,HIGH,",
  "NJ-07,NJ,07,Y,UNCHANGED,07901,PO BOX,False,Summit,Union,,ZCTA overlap,LOW,",
].join("\n");

test("a file with a ZIP column is read by its header; removed, inactive and blank rows are named, never hunted", () => {
  const r = parseZips(COOK);
  assert.deepEqual(r.zips.map((z) => z.zip), ["85635", "85641", "02135"]);
  assert.deepEqual(r.zips.map((z) => z.group), ["AZ-06", "AZ-06", "MA-01"]);
  assert.equal(r.paddedZeros, 1, "the New England ZIP that lost its zero is padded and counted");
  assert.equal(r.duplicates, 1);
  const why = Object.fromEntries(r.skipped.map((s) => [s.why, s.count]));
  assert.equal(why["the file marks it as removed from the district"], 1);
  assert.equal(why["the file marks it as not active"], 1);
  assert.equal(why["no ZIP in the row"], 1);
  assert.deepEqual(r.columns, { zip: "zip", group: "district" });
});

test("a pasted list takes five-digit ZIPs however they are separated and names everything else", () => {
  const r = parseZips("85635 85641, 85901\n85635; 12345-6789 abc 2026 1234");
  assert.deepEqual(r.zips.map((z) => z.zip), ["85635", "85641", "85901", "12345", "02026", "01234"], "a four-digit token is padded; the preview then drops any that are not real ZIP areas");
  assert.equal(r.duplicates, 1);
  assert.equal(r.paddedZeros, 2, "2026 and 1234 are both four digits and are padded, and both are counted so the owner can see it");
  assert.equal(r.skipped[0].why, "not a five-digit ZIP");
  assert.deepEqual(r.skipped[0].examples, ["abc"]);
});

test("one budget for all is split evenly and can never add up to more than the total", () => {
  const split = planBudgets(["85635", "85641", "85901"], { mode: "split", totalUsd: 100 });
  assert.ok(split.ok);
  if (!split.ok) return;
  assert.deepEqual(split.items.map((i) => i.budgetUsd), [33.33, 33.33, 33.33]);
  assert.ok(split.totalUsd <= 100, "rounded down, so three shares of a hundred dollars never reach a hundred and one cents");
  assert.match(split.words, /\$100\.00 shared evenly/);
  const same = planBudgets(["85635", "85641"], { mode: "same", eachUsd: 25 });
  assert.ok(same.ok && same.totalUsd === 50);
  const each = planBudgets(["85635", "85641"], { mode: "each", defaultUsd: 10, byZip: { "85635": 40 } });
  assert.ok(each.ok);
  if (each.ok) assert.deepEqual(each.items.map((i) => i.budgetUsd), [40, 10]);
  assert.equal(planBudgets([], { mode: "same", eachUsd: 1 }).ok, false);
  assert.equal(planBudgets(["85635"], { mode: "same", eachUsd: -1 }).ok, false);
  assert.equal(planBudgets(["85635"], { mode: "same", eachUsd: 20_000 }).ok, false, "above the per-hunt maximum");
});

const NOW = "2026-09-30T18:00:00.000Z";
const deps = (repos: ReturnType<typeof createMemoryRepositories>): GatewayDeps => ({ repos, now: () => NOW, currentStateVersion: null, codeSha: null });
const ask = (type: string, key: string, input: Record<string, unknown>): ActionRequest => ({ type, subject: "", input, stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "adm_test" });

test("send many writes every hunt in ONE config write, with its own budget and group", async () => {
  const repos = createMemoryRepositories();
  let writes = 0;
  const realSave = repos.adminConfig.save.bind(repos.adminConfig);
  repos.adminConfig.save = async (...args) => { writes += 1; return realSave(...args); };
  const out = await submit(ask("expansion.scope.setMany", "many-key-00000001", {
    items: [
      { zip: "85635", stateAbbr: "AZ", budgetUsd: 25, group: "AZ-06" },
      { zip: "85641", stateAbbr: "AZ", budgetUsd: 10, group: "AZ-06" },
      { zip: "02135", stateAbbr: "MA", budgetUsd: 5, group: null },
    ],
    priority: 2,
    note: "toss-ups",
  }), deps(repos));
  assert.equal(out.ok, true, out.receipt.says);
  assert.equal(writes, 1, "one write for the whole list");
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true});
  assert.ok(row && isAdminConfig(row.value));
  const scopes = expansionScopesOf(row.value as never).scopes;
  assert.equal(scopes.length, 3);
  const a = scopes.find((s) => s.key === "zcta:2020/85635")!;
  assert.equal(a.budgetUsd, 25);
  assert.equal(a.priority, 2);
  assert.equal(a.note, "toss-ups · AZ-06");
  assert.ok(a.budgetStartedAt, "a lifetime hunt, so edits keep its accounting start");
  assert.equal(scopes.find((s) => s.key === "zcta:2020/02135")!.geography.stateAbbr, "MA");
  assert.match(out.receipt.says, /3 hunts across 1 group \(3 new, 0 already on the list\), \$40\.00/);
});

test("send many refuses a bad item by number and writes nothing", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("expansion.scope.setMany", "many-key-00000002", { items: [{ zip: "85635", stateAbbr: "AZ", budgetUsd: 1 }, { zip: "8563", stateAbbr: "AZ", budgetUsd: 1 }] }), deps(repos));
  assert.equal(out.ok, false);
  assert.match(out.receipt.says, /item 2 \(8563\)/);
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null);
  const dup = await submit(ask("expansion.scope.setMany", "many-key-00000003", { items: [{ zip: "85635", stateAbbr: "AZ", budgetUsd: 1 }, { zip: "85635", stateAbbr: "AZ", budgetUsd: 1 }] }), deps(repos));
  assert.match(dup.receipt.says, /in the send twice/);
  const none = await submit(ask("expansion.scope.setMany", "many-key-00000004", { items: [] }), deps(repos));
  assert.equal(none.ok, false);
});

test("a hunt's budget can be changed, paused at zero and resumed at what it had", async () => {
  const repos = createMemoryRepositories();
  await submit(ask("expansion.scope.setMany", "many-key-00000005", { items: [{ zip: "85635", stateAbbr: "AZ", budgetUsd: 25 }] }), deps(repos));
  const key = "zcta:2020/85635";
  const at = async () => expansionScopesOf((await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:{ids:[key]}}))!.value as never).scopes.find((s) => s.key === key)!;
  const cut = await submit(ask("expansion.scope.budget", "budget-key-0000001", { key, change: "set", budgetUsd: 40 }), deps(repos));
  assert.equal(cut.ok, true, cut.receipt.says);
  assert.equal((await at()).budgetUsd, 40);
  const paused = await submit(ask("expansion.scope.budget", "budget-key-0000002", { key, change: "pause" }), deps(repos));
  assert.equal(paused.ok, true);
  assert.equal((await at()).budgetUsd, 0);
  assert.match(paused.receipt.says, /paused: its budget is now \$0\.00 \(was \$40\.00\)/);
  const back = await submit(ask("expansion.scope.budget", "budget-key-0000003", { key, change: "resume" }), deps(repos));
  assert.equal(back.ok, true, back.receipt.says);
  assert.equal((await at()).budgetUsd, 40, "resumed at the budget it had before the pause");
  assert.ok((await at()).budgetStartedAt, "the accounting start is kept");
  const again = await submit(ask("expansion.scope.budget", "budget-key-0000004", { key, change: "resume" }), deps(repos));
  assert.equal(again.ok, false, "a hunt that is not paused has nothing to resume");
  const missing = await submit(ask("expansion.scope.budget", "budget-key-0000005", { key: "zcta:2020/99999", change: "pause" }), deps(repos));
  assert.equal(missing.ok, false);
});

test("an Excel workbook is read through the repository's own reader, and a ZIP that lost its zero is fixed", async () => {
  const { buildWorkbook, readWorkbook, toCsv } = await import("../scripts/xlsx.mjs");
  const book = buildWorkbook(
    [{ name: "Toss-ups", header: ["district", "zip", "evidence"], rows: [["MA-01", "2135", ""], ["AZ-06", "85635", ""], ["AZ-06", "85641", "REMOVED_2026 left the district"]], widths: [10, 10, 20] }],
    "2026-09-30",
  ) as Buffer;
  const sheet = (readWorkbook(book) as { name: string; rows: string[][] }[])[0];
  const parsed = parseZips(toCsv(sheet.rows[0], sheet.rows.slice(1)) as string);
  assert.deepEqual(parsed.zips.map((z) => `${z.zip}:${z.group}`), ["02135:MA-01", "85635:AZ-06"]);
  assert.equal(parsed.paddedZeros, 1);
  assert.equal(parsed.skipped.find((s) => /removed/.test(s.why))?.count, 1);
});

import { resolveStateScope } from "@/lib/control-plane/expansion/runner-load.ts";
import { scopeKeyOf, validateScopeGeography, validateScopeKey, withScopeSet } from "@/lib/control-plane/expansion/scopes.ts";
import { huntPlaceKey, huntRelation, parseV6PlaceKey } from "@/lib/control-plane/admin-view/v6-hunts-read.ts";
import { loadBootstrapLookup } from "@/lib/census-geography/reader.ts";

const STATE_AZ = { type: "state", geoid: "04", version: "state:2020", label: "Arizona", stateAbbr: "AZ" } as const;

test("a whole state is a scope like any other: it validates, keys and places under the state's own key", () => {
  const geography = validateScopeGeography(STATE_AZ);
  assert.ok(geography.ok, geography.ok ? "" : geography.why);
  assert.equal(scopeKeyOf(STATE_AZ), "state:2020/04");
  assert.ok(validateScopeKey("state:2020/04").ok);
  assert.equal(validateScopeGeography({ ...STATE_AZ, version: "county:2020" }).ok, false, "a state needs a state plan version");
  const decision = withScopeSet([], { geography: STATE_AZ, priority: 1, budgetUsd: 20, huntBudget: true, note: null, decidedAt: NOW, decidedBy: "adm_test", receiptId: "r1" }).scopes[0];
  assert.equal(huntPlaceKey(decision), "st:az", "the mission is one row on the state's own place, where its score is read");
  assert.equal(huntRelation(parseV6PlaceKey("st:az")!, decision), "member");
  assert.equal(huntRelation(parseV6PlaceKey("st:nm")!, decision), "outside");
  assert.equal(huntRelation({ kind: "country" }, decision), "member");
});

test("one pick is one mission: a state is sent as one scope with its own budget, not as a pile of ZIPs", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("expansion.scope.setMany", "many-key-00000009", { items: [
    { geography: STATE_AZ, budgetUsd: 40, group: null },
    { geography: { type: "county", geoid: "04019", version: "county:2020", label: "Pima County, AZ", stateAbbr: "AZ" }, budgetUsd: 10, group: null },
  ], priority: 1 }), deps(repos));
  assert.equal(out.ok, true, out.receipt.says);
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true});
  const scopes = expansionScopesOf(row!.value as never).scopes;
  assert.deepEqual(scopes.map(s => s.key).sort(), ["county:2020/04019", "state:2020/04"]);
  assert.equal(scopes.find(s => s.key === "state:2020/04")?.budgetUsd, 40);
  const twice = await submit(ask("expansion.scope.setMany", "many-key-00000010", { items: [{ geography: STATE_AZ, budgetUsd: 1 }, { geography: STATE_AZ, budgetUsd: 2 }] }), deps(createMemoryRepositories()));
  assert.match(twice.receipt.says, /Arizona is in the send twice/);
});

test("the runner resolves a state mission to the ZIPs of its counties, once", async () => {
  const lookup = loadBootstrapLookup();
  const counties = await lookup.enumerateGroupings("county");
  const year = counties.version.key.split(":")[1];
  const decision = withScopeSet([], { geography: { ...STATE_AZ, version: `state:${year}` }, priority: 1, budgetUsd: 20, huntBudget: true, note: null, decidedAt: NOW, decidedBy: "adm_test", receiptId: "r1" }).scopes[0];
  const resolved = await resolveStateScope(decision, lookup);
  assert.equal(resolved.kind, "RESOLVED");
  if (resolved.kind === "RESOLVED") {
    assert.ok(resolved.zctas.size > 0);
    const union = new Set<string>();
    for (const county of counties.instances.filter(c => c.stateAbbr === "AZ")) for (const o of (await lookup.zctasForGrouping({ type: "county", geoid: county.geoid, version: county.version })).overlaps) union.add(o.zcta5);
    assert.deepEqual([...resolved.zctas].sort(), [...union].sort(), "the state is exactly the union of its counties' ZIP areas");
    assert.deepEqual([...resolved.states], ["AZ"]);
  }
  const wrongPlan = await resolveStateScope({ ...decision, geography: { ...decision.geography, version: "state:1999" } }, lookup);
  assert.equal(wrongPlan.kind, "UNRESOLVED");
  const none = await resolveStateScope({ ...decision, geography: { ...decision.geography, stateAbbr: "ZZ" } }, lookup);
  assert.equal(none.kind, "UNRESOLVED", "a state with no counties says so; it never resolves to an empty set");
});
