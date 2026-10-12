/**
 * A pause, ceiling, budget or switch record that cannot be read keeps paid work closed, while plain-code work,
 * routine publication and free discovery carry on. The two long-running scripts' wiring is pinned as source text
 * with positive controls.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  adminConfigForPaidWork,
  defaultAdminConfig,
  discoverySearchEnabled,
  fleetSpendCeilingOverrideUsd,
  withDiscoverySearch,
  withFleetSpendCeiling,
  type AdminConfig,
} from "../lib/control-plane/gateway/admin-config.ts";
import { FLEET_SAFETY_BOUNDS, resolveRollingCeiling } from "../lib/control-plane/fleet-safety.ts";

const ROOT = process.cwd();
const source = (rel: string): string => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const NOW = "2026-09-25T16:00:00.000Z";

function fails(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

/* ------------------------------------------------ the config row, by value */

const LIVE_DIAL = withFleetSpendCeiling(defaultAdminConfig(), { rollingCeilingUsd: 105, previousUsd: 100, decidedAt: NOW, decidedBy: "adm_x", receiptId: "c1" });

test("the config row for paid work: a clean read honors the owner's dial, and only a clean read with no override falls back", () => {
  const live = adminConfigForPaidWork({ row: { value: LIVE_DIAL } });
  assert.equal(live.holdPaidWork, null);
  assert.equal(resolveRollingCeiling(fleetSpendCeilingOverrideUsd(live.config)).rollingCeilingUsd, 105, "the live $105 dial governs");

  for (const clean of [adminConfigForPaidWork({ row: null }), adminConfigForPaidWork({ row: { value: defaultAdminConfig() } })]) {
    assert.equal(clean.holdPaidWork, null, "a never-written row, or one with no override, holds nothing");
    const ceiling = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(clean.config));
    assert.equal(ceiling.source, "FALLBACK");
    assert.equal(ceiling.rollingCeilingUsd, FLEET_SAFETY_BOUNDS.rolling24HourModelUsd);
  }
});

test("an unreadable, invalid, or malformed-ceiling row holds paid work by name and never reaches the fallback", () => {
  const unreadable = adminConfigForPaidWork({ unreadable: "fetch failed" });
  assert.equal(unreadable.config, null);
  assert.equal(unreadable.holdPaidWork, "the owner's config row (spend ceiling and paid-search switch) could not be read: fetch failed");

  const invalid = adminConfigForPaidWork({ row: { value: { nonsense: true } } });
  assert.equal(invalid.config, null);
  assert.match(invalid.holdPaidWork ?? "", /is not a valid config/);

  for (const bad of [0, -5, Number.NaN, "25", null]) {
    const row = { ...LIVE_DIAL, fleetSpendCeiling: { ...LIVE_DIAL.fleetSpendCeiling!, rollingCeilingUsd: bad } } as unknown as AdminConfig;
    const held = adminConfigForPaidWork({ row: { value: row } });
    assert.equal(held.config, null, `a ${String(bad)} ceiling is not trusted`);
    assert.match(held.holdPaidWork ?? "", /the owner's spend ceiling on the config row is malformed \(.* is not a positive dollar amount\)/);
  }

  /* A row that cannot be trusted turns its paid-search switch off too, even when the switch itself says on. */
  const searchOnOverCorruptCeiling = withDiscoverySearch(
    { ...LIVE_DIAL, fleetSpendCeiling: { ...LIVE_DIAL.fleetSpendCeiling!, rollingCeilingUsd: 0 } },
    { enabled: true, decidedAt: NOW, decidedBy: "adm_x", receiptId: "s1" },
  );
  assert.equal(discoverySearchEnabled(adminConfigForPaidWork({ row: { value: searchOnOverCorruptCeiling } }).config), false);
  assert.equal(discoverySearchEnabled(adminConfigForPaidWork({ row: { value: withDiscoverySearch(LIVE_DIAL, { enabled: true, decidedAt: NOW, decidedBy: "adm_x", receiptId: "s2" }) } }).config), true);
});

/* ------------------------------------------------ freshness-shadow.mts, as text */

function checkCycleFailsClosed(src: string): void {
  /* 1. An unreadable intent log is captured, never read as "not paused". */
  assert.match(
    src,
    /let intentLogUnreadable: string \| null = null;\s*try \{\s*intentLog = \[\.\.\.\(await repos\.researchIntents\.read\(RESEARCH_INTENT_LOG_KEY\)\)\];\s*\} catch \(error\) \{\s*intentLogUnreadable = /,
    "an unreadable intent log is not captured",
  );
  assert.doesNotMatch(src, /treats the owner as not paused/, "the cycle still treats an unreadable log as no pause");
  const controls = src.match(/const unreadableControls: string\[\] = \[[\s\S]*?\n\];/);
  assert.ok(controls, "no unreadableControls list");
  assert.match(controls[0], /intentLogUnreadable === null \? \[\] : \[/, "the unreadable log does not reach the lane");
  assert.match(controls[0], /ownerIntentsUnreadableByRunner\s*\?/, "the runner's failed read does not reach the lane");
  assert.match(controls[0], /configHold === null \? \[\] : \[configHold\]/, "an untrusted config row does not reach the lane");
  assert.match(src, /const ownerIntentsUnreadableByRunner = argv\.includes\("--owner-intents-unreadable"\);/);

  /* 3. Both owner pauses and every unreadable control decide the lane; FleetSafety holds on the same answer. */
  const closure = src.match(/const laneClosure = modelLaneClosure\(\{[\s\S]*?\n\}\);/);
  assert.ok(closure, "no laneClosure");
  assert.match(closure[0], /paused: intents\.paused,/);
  assert.match(closure[0], /runnerPaused: intents\.runnerPause\.paused,/, "the runner pause does not close the lane");
  assert.match(closure[0], /unreadableControls,/);
  assert.match(src, /paused: intents\.runnerPause\.paused,\s*\/\*[^*]*\*\/\s*modelHold: laneDisabledReason,/, "FleetSafety does not hold model requests on the lane's answer");

  assert.match(src, /admitScout: \(row\) => \{\s*if \(scoutFor\(row\)\.lane === "DETERMINISTIC"\) return \{ admit: true \};\s*if \(!modelLaneEnabled\)/,
    "a held route reopened by a later source failure must pass the existing paid admission gates");

  /* 4 & 5. The row is read through the trusted reading, before the lane is decided. */
  assert.match(src, /const \{ config, holdPaidWork: configHold \} = adminConfigForPaidWork\(configRead\);/);
  assert.doesNotMatch(src, /isAdminConfig\(cfg\.value\)/, "the old reading that let a corrupt row fall back is back");
  assert.doesNotMatch(src, /built-in fallback \$\$\{[^}]*\} governs this cycle/, "an unreadable row still falls back to the built-in ceiling");
  assert.ok(src.indexOf("adminConfigForPaidWork(configRead)") < src.indexOf("const laneClosure = modelLaneClosure({"), "the row is read after the lane was decided");

  /* 7. One switch, one budget: the Scout tool exists only under the switch and draws on the discovery walk's budget. */
  assert.match(src, /const searchBudget = !discoverySearchOn \? null : durableSearchBudget\(\{/);
  assert.equal(src.split("durableSearchBudget(").length - 1, 1, "a second paid-search budget was built");
  assert.match(src, /const scoutSearch = searchBudget === null \? null : makeScoutSearch\(\{[\s\S]{0,200}?budget: searchBudget,/, "the Scout tool is built outside the switch or its budget");
  assert.match(src, /const discoverySearch = searchBudget === null \? null : makeDiscoverySearch\(\{[\s\S]{0,200}?budget: searchBudget,/);
  assert.ok(src.indexOf("const scoutSearch =") < src.indexOf("const scoutFor ="), "the Scout tool is referenced before it is built");

  /* 8. The auditor admits against the ceiling in force. */
  assert.match(src, /autonomousStandingRuntime\(\{(?:(?!\}\);)[\s\S])*?auditCeilingUsd: effectiveCeilingUsd,\s*lifetimeHuntSubject:/,
    "the auditor is not given the ceiling in force");
}

/** Free work runs exactly as before: nothing paid, and nothing unreadable, gates it. */
function checkFreeWorkUntouched(src: string): void {
  assert.match(
    src,
    /\nif \(!dry && !canary && !intents\.runnerPause\.paused\) \{\s*try \{\s*const retained = await retainRecentRoutineMeetingEvidence\(/,
    "routine meeting intake is gated differently",
  );
  const walk = src.slice(src.indexOf('let meetingsDiscoveryState = "not run: the meetings discovery pass has not started";'), src.indexOf("meetingsDiscovery = await runMeetingsDiscovery(repos, {"));
  assert.ok(walk.length > 0, "the discovery walk anchors moved");
  assert.match(
    walk,
    /if \(!MEETINGS_DISCOVERY_ENABLED\) \{[\s\S]*?\} else if \(dry \|\| canary\) \{[\s\S]*?\} else if \(discoveryToWalk\.length === 0\) \{[\s\S]*?\} else \{/,
    "the free discovery walk is gated differently",
  );
  for (const paidFact of ["modelLaneEnabled", "laneClosure", "laneDisabledReason", "unreadableControls", "configHold", "intentLogUnreadable", "ownerIntentsUnreadableByRunner"]) {
    assert.ok(!walk.includes(paidFact), `the free discovery walk now depends on ${paidFact}`);
  }
  assert.match(src, /const MEETINGS_DISCOVERY_ENABLED = process\.env\.WTP_MEETINGS_DISCOVERY !== "off";/);
  assert.match(src, /const dispatchWorkWrites = !dry && !canary && ONLY === null && IDS === null && !intents\.runnerPause\.paused;/);
  assert.match(src, /const dispatchScopes = expansionPlan\?\.scopes \?\? \[\];/);
  assert.match(src, /for \(const \{ intent \} of dispatchDetails\)[\s\S]*?for \(const t of carriedDispatchTargets/);
  assert.match(src, /for \(const scope of dispatchScopes\) add\(scopeWorkTarget\(scope\)\)/);
  assert.match(src, /applyManualSourceGaps\(repos, dispatchScopes,/,
    "source gaps must use the selected scopes");
  assert.match(src, /for \(const \{ intent, detail \} of dispatchDetails\) \{/);
}

test("freshness-shadow.mts closes every paid path on an unreadable or ignored control (items 1, 3, 4, 5, 7, 8)", () => {
  checkCycleFailsClosed(source("scripts/freshness-shadow.mts"));
});

test("PRODUCTION TODAY: routine intake, the free discovery walk and dispatch-work writes are gated exactly as before", () => {
  checkFreeWorkUntouched(source("scripts/freshness-shadow.mts"));
});

test("POSITIVE CONTROL: a cycle that drops any fail-closed wire, or gates free work on paid facts, fails its checker", () => {
  const src = source("scripts/freshness-shadow.mts");
  const mutations: [string, string, string][] = [
    ["runnerPaused: intents.runnerPause.paused,\n", "", "a lane blind to the runner pause"],
    ["  unreadableControls,\n});", "});", "a lane blind to unreadable controls"],
    ["  intentLogUnreadable = error instanceof Error ? error.message : String(error);\n", "", "an unreadable log that is not captured"],
    ["modelHold: laneDisabledReason,", "", "a FleetSafety that reserves under a closed lane"],
    ["const scoutSearch = searchBudget === null ? null : makeScoutSearch({", "const scoutSearch = makeScoutSearch({", "a Scout search outside the switch"],
    ["auditCeilingUsd: effectiveCeilingUsd,", "", "an auditor on the static default"],
    ['if (scoutFor(row).lane === "DETERMINISTIC") return { admit: true };', 'if (heldScoutFor(row) !== null) return { admit: true };', "a paid investigation admitted from invalidated held discovery"],
  ];
  for (const [from, to, what] of mutations) {
    const mutated = src.replace(from, to);
    assert.notEqual(mutated, src, `the mutation for "${what}" did not apply; the test would prove nothing`);
    assert.ok(fails(() => checkCycleFailsClosed(mutated)), `${what} passed`);
  }
  const intakeOnLane = src.replace("if (!dry && !canary && !intents.runnerPause.paused) {\n  try {\n    const retained", "if (!dry && !canary && !intents.runnerPause.paused && modelLaneEnabled) {\n  try {\n    const retained");
  assert.notEqual(intakeOnLane, src);
  assert.ok(fails(() => checkFreeWorkUntouched(intakeOnLane)), "routine intake gated on the paid lane passed");
  const walkOnUnreadable = src.replace("} else if (discoveryToWalk.length === 0) {", "} else if (unreadableControls.length > 0 || discoveryToWalk.length === 0) {");
  assert.notEqual(walkOnUnreadable, src);
  assert.ok(fails(() => checkFreeWorkUntouched(walkOnUnreadable)), "a free walk stopped by an unreadable control passed");
});

/* ------------------------------------------------ pilot-runner.mts, as text */

function checkRunnerFailsClosed(src: string): void {
  assert.match(src, /type OwnerSays = "HOLD" \| "START_NOW" \| "NOTHING" \| "UNREADABLE";/);
  const says = src.match(/async function ownerSays\(\): Promise<OwnerSays> \{[\s\S]*?\n\}/);
  assert.ok(says, "no ownerSays()");
  const caught = says[0].slice(says[0].indexOf("} catch (error) {"), says[0].indexOf("const reading = readIntents(log);"));
  assert.ok(caught.length > 0, "the catch anchor moved");
  assert.match(caught, /return "UNREADABLE";/, "an unreadable log is not reported as unreadable");
  assert.doesNotMatch(caught, /return "NOTHING";/, "an unreadable log still reads as the owner saying nothing");
  assert.match(says[0], /if \(repos === null\) throw new Error\(/, "an unopened control plane still reads as silence");
  assert.match(says[0], /if \(provider !== "postgres"\) return "NOTHING";/, "the file provider (no owner intents) is not told apart");

  const hold = src.match(/async function holdWhilePaused\(\): Promise<\{ readonly ownerIntentsUnreadable: boolean \}> \{[\s\S]*?\n\}/);
  assert.ok(hold, "no holdWhilePaused() returning the unreadable fact");
  assert.match(hold[0], /while \(says === "HOLD"\)/, "the pause no longer holds");
  assert.match(hold[0], /return \{ ownerIntentsUnreadable: says === "UNREADABLE" \};/);
  assert.match(src, /const owner = await holdWhilePaused\(\);[\s\S]*?const wakeReleaseExit = await reconcileRuntimeReleaseAtBoundary\(\);[\s\S]*?if \(wakeReleaseExit !== null\) \{[\s\S]*?break;[\s\S]*?cycle \+= 1;[\s\S]*?const result = await runOneCycle\(owner\)/,
    "the owner pause is read before release reconciliation and the normal child inherits its unreadable state");
  assert.match(src, /\.\.\.\(owner\.ownerIntentsUnreadable \? \["--owner-intents-unreadable"\] : \[\]\),/, "the child is not told to hold its paid lane");
}

test("pilot-runner.mts never reads an unreadable intent log as 'not paused', and holds the next cycle's paid lane (item 2)", () => {
  checkRunnerFailsClosed(source("scripts/pilot-runner.mts"));
});

test("POSITIVE CONTROL: a runner that reads an unreadable log as silence, or never tells the child, fails its checker", () => {
  const src = source("scripts/pilot-runner.mts");
  const silent = src.replace('    return "UNREADABLE";\n  }', '    return "NOTHING";\n  }');
  assert.notEqual(silent, src);
  assert.ok(fails(() => checkRunnerFailsClosed(silent)), "an unreadable log read as silence passed");
  const untold = src.replace('    ...(owner.ownerIntentsUnreadable ? ["--owner-intents-unreadable"] : []),\n', "");
  assert.notEqual(untold, src);
  assert.ok(fails(() => checkRunnerFailsClosed(untold)), "a child never told to hold its paid lane passed");
});
