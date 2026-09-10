/**
 * **THE SOURCE / API CAPABILITY REGISTRY'S SEEDED FAILURES.** (ADM-C11, §6 and
 * §7 of the Admin C brief, 2026-09-06.)
 *
 * Each of these is a defect that would be invisible in normal use — the page
 * would look right and be wrong:
 *
 * ```
 *   1  a credential VALUE or a variable NAME reaching a built row, and from
 *      there the browser
 *   2  a key that lives with an off-host acquisition process being reported as "not
 *      configured" because this process cannot see that store — a falsehood
 *      with a tick beside it
 *   3  a routine-data GitHub clock coming back while the page reports the
 *      terminal software-CI-only boundary
 *   4  a disposition vocabulary the owner cannot tell apart, because a member
 *      is unreachable or two members mean the same thing
 *   5  a NOT_APPLICABLE with no justification behind it
 *   6  a "named in the handoff, absent from this repository" claim that is
 *      typed rather than measured, and goes stale the day somebody wires it
 *   7  the page burning an API call to draw itself
 *   8  a stated N over a list of a different length, or a number with no
 *      denominator
 * ```
 *
 * Every detector that could look at nothing has a positive control beside it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { auditRenderedNumbers, checkStatedEqualsRendered } from "@/lib/control-plane/owner-surface.ts";
import { isEnvVarName, plainCode } from "@/lib/control-plane/plain-words.ts";
import {
  DISPOSITIONS,
  DISPOSITION_MEANS,
  DISPOSITION_TONE,
  HEALTH_WORDS,
  HOLDER_SAYS,
  GITHUB_ROUTINE_DATA_ROUTE_IDS,
  PRODUCTION_EXECUTION_BOUNDARY,
  ROUTE_CREDENTIAL_VARS,
  buildSourceRegistry,
  readCredentialPresence,
  registerDisagreements,
  sourceRegistryCountClaims,
  sourceRegistryRenderedNumbers,
  type SourceRegistryInput,
} from "@/lib/control-plane/source-registry.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "@/lib/civic-data/manual-contracts.ts";
import {
  meetingPartitionsForSource,
  observableRoutineContracts,
} from "@/lib/civic-data/meeting-partitions.ts";
import { UNHANDLED_PLATFORMS } from "@/lib/hunt/platform-tenancy.ts";
import {
  CREDENTIAL_STORES,
  CREDENTIAL_STORE_SAYS,
  checkCredentialReport,
  readCredentialStores,
} from "@/lib/ops/credential-report.ts";
import { SOURCE_WIRING } from "@/lib/registry/source-wiring.ts";
import { CAPABILITIES } from "@/lib/sources/composite/wiring.ts";

const ROOT = join(import.meta.dirname, "..");
const PAGE = join(ROOT, "app", "(admin)", "admin", "sources", "page.tsx");
const MODULE = join(ROOT, "lib", "control-plane", "source-registry.ts");
const WORKFLOWS = join(ROOT, ".github", "workflows");

const EVERY_VAR: Record<string, string> = {};
for (const names of Object.values(ROUTE_CREDENTIAL_VARS)) {
  for (const name of names) EVERY_VAR[name] = "a value this test never looks at";
}

function input(overrides: Partial<SourceRegistryInput> = {}): SourceRegistryInput {
  return {
    nowIso: "2026-09-06T18:00:00.000Z",
    credentialPresence: readCredentialPresence({}),
    credentialReadIn: "this website's own server settings",
    ...overrides,
  };
}

const VIEW = buildSourceRegistry(input());
const ALL_VAR_NAMES = Object.values(ROUTE_CREDENTIAL_VARS).flat();

/** One row by id, or a failure that names the id rather than a null dereference. */
function rowOf(view: ReturnType<typeof buildSourceRegistry>, id: string) {
  const row = view.rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`the registry has no row for ${id}, so this guard is testing nothing`);
  return row;
}

/* ================================================================== *
 * 1. NO CREDENTIAL VALUE AND NO VARIABLE NAME LEAVES THIS MODULE
 * ================================================================== */

/** Every screaming-snake token inside a serialised row, wherever it sits. */
function snakeTokensIn(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)].map((m) => m[0]);
}

test("ADM-C11: no built row carries an environment-variable name", () => {
  assert.ok(VIEW.rows.length > 20, `the registry built ${VIEW.rows.length} rows, which cannot be the whole inventory`);
  assert.ok(ALL_VAR_NAMES.length >= 13, `only ${ALL_VAR_NAMES.length} credential names are declared`);

  const offenders: string[] = [];
  for (const row of VIEW.rows) {
    for (const token of snakeTokensIn(row)) {
      if (isEnvVarName(token)) offenders.push(`${row.id}: ${token}`);
    }
    for (const name of ALL_VAR_NAMES) {
      if (JSON.stringify(row).includes(name)) offenders.push(`${row.id}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], `a variable name reached a row:\n${offenders.join("\n")}`);
});

test("ADM-C11: the name detector catches a planted one", () => {
  // Without this the test above passes on an empty sweep and proves nothing.
  const planted = { id: "planted", spendConcern: "set FEC_API_KEY and WTP_ADMIN_SECRET first" };
  const caught = snakeTokensIn(planted).filter((t) => isEnvVarName(t));
  assert.deepEqual(caught.sort(), ["FEC_API_KEY", "WTP_ADMIN_SECRET"], "the detector missed a planted name");
});

test("ADM-C11: the page never prints a variable name and reads the environment once", () => {
  const source = readFileSync(PAGE, "utf8");
  assert.ok(source.length > 4000, "the page source read collapsed");

  for (const name of ALL_VAR_NAMES) {
    assert.ok(!source.includes(name), `the page names the credential variable ${name}`);
  }
  // Comments first: the header explains what the one read is for, and a
  // sweep that counted the explanation would push the fix towards deleting it.
  const code = stripComments(source);
  const envReads = [...code.matchAll(/process\.env/g)].length;
  assert.equal(envReads, 1, `the page reads process.env ${envReads} times; it may read it once, for presence`);
  assert.match(
    source,
    /readCredentialPresence\(process\.env\)/,
    "the one environment read must go through readCredentialPresence, which returns booleans keyed by route",
  );
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export const revalidate = 0/);
  assert.match(source, /<QueueForm returnTo=\{HERE\}/, "every gap on this page needs the queue button's form");
});

/* ================================================================== *
 * 2. A KEY THIS PROCESS CANNOT SEE IS NOT REPORTED AS ABSENT
 * ================================================================== */

test("§6: a key held somewhere this page cannot see is a named gap, never a No", () => {
  const empty = buildSourceRegistry(input({ credentialPresence: readCredentialPresence({}) }));
  const keyed = empty.rows.filter((r) => r.credential.required);
  assert.ok(keyed.length >= 10, `only ${keyed.length} rows require a key, which cannot be the whole inventory`);

  let offsite = 0;
  let onsite = 0;
  for (const row of keyed) {
    if (row.credential.holder === "SITE_RUNTIME") {
      onsite += 1;
      assert.equal(row.credentialReading.held, true, `${row.id}: a site credential absent here IS a reading`);
      if (row.credentialReading.held) {
        assert.equal(row.credentialReading.value.configured, false, `${row.id}: nothing was set, so it reads not set`);
      }
      continue;
    }
    offsite += 1;
    assert.equal(
      row.credentialReading.held,
      false,
      `${row.id}: this key lives in ${HOLDER_SAYS[row.credential.holder]}, which this process cannot see — absence here is not a No`,
    );
    if (!row.credentialReading.held) {
      assert.equal(row.credentialReading.gap.whose, "UNKNOWABLE_NOW", `${row.id}: whose gap this is`);
      assert.match(row.credentialReading.gap.says, /cannot see|not evidence/i, `${row.id}: the gap must say why`);
    }
  }
  assert.ok(offsite > 0, "no route keeps its key off this host, so the scoping rule was never exercised");
  assert.ok(onsite > 0, "no route keeps its key on this host, so the on-host branch was never exercised");
});

test("§6: presence anywhere is presence, and it needs every part of a pair", () => {
  const all = buildSourceRegistry(input({ credentialPresence: readCredentialPresence(EVERY_VAR) }));
  for (const row of all.rows.filter((r) => r.credential.required)) {
    assert.equal(row.credentialReading.held, true, `${row.id}: a present key is a reading wherever it lives`);
    if (row.credentialReading.held) {
      assert.equal(row.credentialReading.value.configured, true, `${row.id}: it is set`);
    }
  }

  const pairs = Object.entries(ROUTE_CREDENTIAL_VARS).filter(([, names]) => names.length > 1);
  assert.ok(pairs.length > 0, "no route declares a credential pair, so the half-a-pair rule was never exercised");
  for (const [routeId, names] of pairs) {
    const half = readCredentialPresence({ [names[0]]: "set" });
    assert.equal(half[routeId], false, `${routeId}: half a credential pair is not a credential`);
  }
});

test("§6: a route that needs no key never claims a reading of one", () => {
  const keyless = VIEW.rows.filter((r) => !r.credential.required);
  assert.ok(keyless.length > 5, `only ${keyless.length} keyless routes, which cannot be right`);
  for (const row of keyless) {
    assert.equal(row.credential.holder, "NONE", `${row.id}: a keyless route holds its key nowhere`);
    assert.equal(row.credential.parts, 0, `${row.id}: a keyless route needs no parts`);
  }
});

/* ================================================================== *
 * 3. §7 — THE RETIRED EXECUTABLES STAY DELETED
 * ================================================================== */

/** Whether workflow text declares a cron. Comments do not count. */
function workflowHasSchedule(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
  const body = lines.join("\n");
  return /^\s{2}schedule:/m.test(body) && /cron:/.test(body);
}

test("§7: every obsolete refresh workflow definition is deleted", () => {
  const refreshFiles = readdirSync(WORKFLOWS).filter((file) => /^refresh-.*\.ya?ml$/.test(file));
  assert.deepEqual(refreshFiles, []);
});

test("§7: GitHub carries no routine data or operations clock", () => {
  const workflows = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
  const scheduled = workflows.filter((file) => workflowHasSchedule(readFileSync(join(WORKFLOWS, file), "utf8")));
  assert.deepEqual(scheduled, [], `scheduled GitHub workflow(s) survived PDC: ${scheduled.join(", ")}`);
});

test("§7: the terminal-zero workflow detector catches a planted cron", () => {
  assert.equal(workflowHasSchedule("name: planted\non:\n  schedule:\n    - cron: '0 0 * * *'\n"), true);
  assert.equal(workflowHasSchedule("#   schedule:\n#     - cron: '0 0 * * *'\non:\n  push:\n"), false);
});

test("§7: the wider capability registry never reconstructs a second routine clock", () => {
  assert.deepEqual(GITHUB_ROUTINE_DATA_ROUTE_IDS, []);
  assert.equal(PRODUCTION_EXECUTION_BOUNDARY.state, "SOFTWARE_CI_ONLY");
  assert.deepEqual(PRODUCTION_EXECUTION_BOUNDARY.githubRoutineDataRouteIds, []);
  assert.equal(VIEW.githubRoutineDataRoutes.value, 0);
  for (const row of VIEW.rows) {
    assert.ok(row.operation.says.trim() !== "", `${row.id}: production-operation disposition is silent`);
  }
});

test("§7: every capability-to-production-contract join names a permanent contract", () => {
  const known = new Set([
    ...observableRoutineContracts().map((contract) => contract.id),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => contract.id),
  ]);
  for (const row of VIEW.rows) {
    for (const contractId of row.operation.contractIds) {
      assert.ok(known.has(contractId), `${row.id}: ${contractId} is not a permanent production contract`);
    }
  }
  assert.deepEqual(rowOf(VIEW, "fec-api").operation.contractIds, ["fec-funding"]);
  assert.deepEqual(rowOf(VIEW, "census-acs-api").operation.contractIds, ["census-acs-population"]);
  assert.deepEqual(rowOf(VIEW, "congress-api").operation.contractIds, ["congress-rollcalls", "federal-key-votes"]);
  assert.deepEqual(rowOf(VIEW, "congress-bulk").operation.contractIds, ["congress-bulk-roster"]);
  assert.deepEqual(rowOf(VIEW, "nj-morris-clerk").operation.contractIds, ["nj-morris-filing"]);
  assert.deepEqual(rowOf(VIEW, "dotgov").operation.contractIds, ["dotgov"]);
  assert.deepEqual(
    rowOf(VIEW, "meeting-ical").operation.contractIds,
    meetingPartitionsForSource("ical").map((contract) => contract.id),
  );
});

/* ================================================================== *
 * 4. THE DISPOSITIONS ARE DISTINGUISHABLE — the ADM-C11 acceptance
 * ================================================================== */

test("ADM-C11: the owner can tell all seven standings apart, and each one is reachable", () => {
  assert.equal(DISPOSITIONS.length, 7, "the brief names seven dispositions");
  const means = new Set<string>();
  for (const d of DISPOSITIONS) {
    const sentence = DISPOSITION_MEANS[d];
    assert.ok(sentence !== undefined && sentence.length > 40, `${d} has no owner sentence`);
    assert.ok(!means.has(sentence), `${d} means the same thing as another standing, so they cannot be told apart`);
    means.add(sentence);
    assert.ok(DISPOSITION_TONE[d] !== undefined, `${d} has no colour`);
  }

  for (const d of DISPOSITIONS) {
    assert.ok(
      VIEW.byDisposition[d] >= 1,
      `no route is ${d}, so the owner has never seen what one looks like. An unreachable standing is a word, not a state.`,
    );
  }
  const counted = DISPOSITIONS.reduce((n, d) => n + VIEW.byDisposition[d], 0);
  assert.equal(counted, VIEW.rows.length, "every row has exactly one standing");
});

test("ADM-C11: every standing renders as words, and none of them leaks a constant", () => {
  for (const d of DISPOSITIONS) {
    const words = plainCode(d);
    assert.ok(!words.includes("_"), `${d} renders with an underscore in it: ${words}`);
    if (d.includes("_")) assert.notEqual(words, d, `${d} renders as itself`);
  }
  const page = readFileSync(PAGE, "utf8");
  for (const d of DISPOSITIONS) {
    const asText = new RegExp(`>\\s*${d}\\s*<`);
    assert.ok(!asText.test(page), `the page prints the raw constant ${d} as text`);
  }
  assert.match(page, /<Code raw=\{row\.disposition\}/, "the standing must reach the face through the one translator");
});

test("ADM-C11: a NOT_APPLICABLE row states its justification", () => {
  const rows = VIEW.rows.filter((r) => r.disposition === "NOT_APPLICABLE");
  assert.ok(rows.length > 0, "no row is NOT_APPLICABLE, so the justification rule was never exercised");
  for (const row of rows) {
    assert.ok(
      row.dispositionWhy.length > 60,
      `${row.id}: NOT_APPLICABLE with justification is the brief's own wording; "${row.dispositionWhy}" is not one`,
    );
  }
});

test("ADM-C11: a route nothing calls is never graded green, and never graded red either", () => {
  for (const row of VIEW.rows) {
    const dormant =
      row.disposition === "PRESERVE" ||
      row.disposition === "INTENTIONALLY_NOT_SPENT" ||
      row.disposition === "PENDING_PROVIDER" ||
      row.disposition === "NOT_APPLICABLE" ||
      row.disposition === "WIRE";
    if (!dormant) continue;
    assert.equal(
      row.health,
      "UNKNOWN",
      `${row.id}: nothing calls this route, so nothing has measured it. ${HEALTH_WORDS.GREEN} would be a tick nobody earned and ${HEALTH_WORDS.RED} would be a failure nobody observed.`,
    );
    assert.ok(row.healthWhy.length > 30, `${row.id}: an unmeasured grade still says why`);
  }
});

/* ================================================================== *
 * 5. LAST READ AND NEXT DUE — a run record is not a history
 * ================================================================== */

test("§6: routine route health and dates appear only in the canonical panel", () => {
  for (const id of ["fec-api", "census-acs-api", "nj-morris-clerk", "dotgov", "meeting-ical"]) {
    const row = rowOf(VIEW, id);
    assert.equal(row.lastSuccess.held, false, id);
    assert.equal(row.nextDue.held, false, id);
    assert.equal(row.health, "UNKNOWN", id);
    assert.ok(row.operation.contractIds.length > 0, `${id}: no canonical contract join`);
  }
});

test("§6: the capability registry has no tracked runtime-state input or fallback", () => {
  const source = readFileSync(MODULE, "utf8");
  assert.doesNotMatch(source, /HistoricalRefresh|lastRun|openDebt|refresh-run|refresh-debt/);
  assert.match(VIEW.productionOutcomeAuthority, /canonical candidates, events, and promotion pointers/);
  assert.match(VIEW.productionOutcomeAuthority, /accepts no run record or mutable operations file/);
});

/* ================================================================== *
 * 6. THE NAMED-ONLY CLAIM IS MEASURED, NOT TYPED
 * ================================================================== */

/** Does this literal appear anywhere the product actually runs? */
function appearsInCode(literal: string): boolean {
  try {
    const out = execFileSync(
      "git",
      [
        "grep",
        "-l",
        "--untracked",
        "--fixed-strings",
        literal,
        "--",
        "lib",
        "scripts",
        "app",
        ".github",
        // The registry's own lookup names every variable, so counting it would
        // make every route look wired to itself.
        ":!lib/control-plane/source-registry.ts",
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    return out.trim().length > 0;
  } catch (error) {
    // git grep exits 1 for "no match", which is an answer rather than a failure.
    const status = (error as { status?: number }).status;
    if (status === 1) return false;
    throw error;
  }
}

test("§6: a route called absent from this repository really is absent from it", () => {
  const namedOnly = VIEW.rows.filter((r) => r.namedOnly);
  assert.ok(namedOnly.length > 0, "no route is claimed named-only, so the sweep was never exercised");

  for (const row of namedOnly) {
    const names = ROUTE_CREDENTIAL_VARS[row.id];
    if (names === undefined) continue;
    for (const name of names) {
      assert.equal(
        appearsInCode(name),
        false,
        `${row.id} is shown as named in the handoff and absent here, and ${name} appears in the code. The row is stale.`,
      );
    }
  }
});

test("§6: a route NOT called absent is one the code really does name", () => {
  // The other half, and the positive control for the sweep: if `appearsInCode`
  // always answered false, the test above would pass on nothing.
  const present = VIEW.rows.filter((r) => !r.namedOnly && ROUTE_CREDENTIAL_VARS[r.id] !== undefined);
  assert.ok(present.length >= 8, `only ${present.length} keyed routes claim to be present in the code`);
  for (const row of present) {
    for (const name of ROUTE_CREDENTIAL_VARS[row.id]) {
      assert.equal(appearsInCode(name), true, `${row.id} is shown as wired here and nothing in the code names ${name}`);
    }
  }
});

/* ================================================================== *
 * 7. THE PAGE DOES NOT SPEND A KEY TO DRAW ITSELF
 * ================================================================== */

test("ADM-C11: neither the registry nor the page calls a source or reads a file", () => {
  // `registrySource` rather than `module`: assigning to `module` is a lint
  // error in this repository, and a test that cannot lint cannot ship.
  const registrySource = readFileSync(MODULE, "utf8");
  const page = readFileSync(PAGE, "utf8");
  const forbidden = [/\bfetch\s*\(/, /readFileSync\s*\(/, /existsSync\s*\(/, /\bawait\s+fetch\b/];

  for (const [label, source] of [["the registry module", registrySource], ["the page", page]] as const) {
    const code = stripComments(source);
    for (const shape of forbidden) {
      assert.ok(!shape.test(code), `${label} contains ${shape} — this page may not spend a key or read a file to draw itself`);
    }
  }
  assert.ok(
    !stripComments(registrySource).includes("process.env"),
    "the registry module must stay pure; the page hands it the reading",
  );
});

test("ADM-C11: the no-call detector catches a call", () => {
  const planted = "async function draw() { const r = await fetch('https://api.open.fec.gov/v1/candidates/'); return r; }";
  assert.ok(/\bfetch\s*\(/.test(stripComments(planted)), "the detector missed a plain fetch");
  assert.ok(!/\bfetch\s*\(/.test(stripComments("// await fetch(url) was removed here\n")), "a comment is not a call");
});

/** Block and line comments removed, so a comment about a defect is not the defect. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/* ================================================================== *
 * 8. THE PAGE'S NUMBERS CHECK OUT AGAINST THEMSELVES
 * ================================================================== */

test("ADM-C11: every stated N equals the rows beneath it", () => {
  const claims = sourceRegistryCountClaims(VIEW);
  assert.ok(claims.length >= 6, `only ${claims.length} count claims, which cannot cover this page`);
  const verdict = checkStatedEqualsRendered(claims);
  assert.equal(verdict.ok, true, verdict.detail);
});

test("ADM-C11: every number carries a denominator and an interpretation", () => {
  const numbers = sourceRegistryRenderedNumbers(VIEW);
  assert.ok(numbers.length >= 15, `only ${numbers.length} numbers declared, which cannot be the whole page`);
  const verdict = auditRenderedNumbers(numbers);
  assert.equal(verdict.ok, true, verdict.detail);
});

test("ADM-C11: the audit catches a number with no denominator", () => {
  const verdict = auditRenderedNumbers([{ label: "planted", value: 14, denominator: null, contract: "some contract" }]);
  assert.equal(verdict.ok, false, "the audit accepted a bare number");
});

test("ADM-C11: meeting coverage is counted in one unit on both sides", () => {
  const covered = VIEW.rows.filter((r) => r.coverage.held);
  assert.ok(covered.length >= CAPABILITIES.length, `only ${covered.length} rows carry a coverage figure`);
  for (const row of covered) {
    if (!row.coverage.held) continue;
    assert.equal(
      row.coverage.value.denominator,
      SOURCE_WIRING.length,
      `${row.id}: coverage is stated over the wiring table, so its denominator is every wiring row`,
    );
  }
  assert.equal(
    VIEW.meetingCoverage.denominator,
    SOURCE_WIRING.length,
    "the headline is stated over the same population as the rows",
  );
  assert.ok(
    VIEW.meetingCoverage.value <= VIEW.meetingCoverage.denominator,
    "a numerator over its denominator means the two were counted over different populations",
  );
});

/* ================================================================== *
 * 9. THE JOIN — derived, so it cannot go stale
 * ================================================================== */

test("ADM-C11: every adapter the composite registers gets a row, derived rather than typed", () => {
  for (const capability of CAPABILITIES) {
    const row = rowOf(VIEW, `meeting-${capability.name}`);
    assert.equal(row.adapter.active, true, `${capability.name}: the composite registers it, so an adapter reads it`);
    assert.equal(row.family, "Meeting portal");
  }
  const meetingRows = VIEW.rows.filter((r) => r.family === "Meeting portal");
  assert.ok(
    meetingRows.length > CAPABILITIES.length,
    "the recognised platforms with no adapter must be named too; a platform nobody can read is not an emptiness",
  );
});

test("ADM-C11: a disagreement between two registers is reported rather than settled quietly", () => {
  const found = registerDisagreements();
  // The live one at the time of writing: the tenancy sweep calls CivicClerk
  // unhandled and the composite has an adapter for it. If somebody fixes the
  // sweep this goes to zero, which is the right outcome and not a failure —
  // what must never happen is the page claiming agreement it did not check.
  for (const d of found) {
    assert.ok(d.about.length > 0 && d.says.length > 60, `a disagreement must say what each register claims: ${JSON.stringify(d)}`);
    assert.equal(d.where, "Sources · where the registers disagree");
  }
  const adapted = new Set(CAPABILITIES.map((c) => c.name));
  const expected = UNHANDLED_PLATFORMS.filter((p) => adapted.has(p.id));
  assert.equal(
    found.filter((d) => d.says.includes("with no adapter")).length,
    expected.length,
    "the finder must report exactly the platforms the two registers disagree about",
  );
});

test("ADM-C11: every row answers the owner's four questions", () => {
  for (const row of VIEW.rows) {
    assert.ok(row.source.trim() !== "", `${row.id}: a row names itself`);
    assert.ok(row.provider.trim() !== "", `${row.id}: a row names who publishes it`);
    assert.ok(row.capability.length > 20, `${row.id}: a row says what it can tell a reader`);
    assert.ok(row.productUsage.trim() !== "", `${row.id}: a row says what the product does with it`);
    assert.ok(row.dispositionWhy.length > 20, `${row.id}: a row says why it has its standing`);
    assert.ok(row.spendConcern.trim() !== "", `${row.id}: a row says what calling it costs`);
    assert.ok(row.evidence.length > 0, `${row.id}: a row names where its claim can be checked`);
    assert.ok(row.operation.says.trim() !== "", `${row.id}: a row says what happens to it next`);
    if (row.blocker !== null) {
      assert.ok(row.blocker.what.length > 20, `${row.id}: a blocker says what is blocked`);
      assert.ok(["OURS", "THEIRS", "UNKNOWABLE_NOW"].includes(row.blocker.whose), `${row.id}: a blocker says whose it is`);
    }
  }
});

/* ================================================================== *
 * 10. ONE CREDENTIAL-STORE VOCABULARY, OWNED BY THE CREDENTIAL MODULE
 * ================================================================== */

test("ADM-C11: the registry names every store the credential module declares, and one of its own", () => {
  for (const store of CREDENTIAL_STORES) {
    assert.ok(
      HOLDER_SAYS[store] !== undefined && HOLDER_SAYS[store].length > 10,
      `${store} is a declared credential store and the registry has no words for it`,
    );
    assert.equal(
      HOLDER_SAYS[store],
      CREDENTIAL_STORE_SAYS[store],
      `${store} is said two different ways; the words must come from the module that owns credentials`,
    );
  }
  assert.ok(HOLDER_SAYS.NONE.length > 10, "a keyless route still says where its key would live: nowhere");
  assert.equal(
    Object.keys(HOLDER_SAYS).length,
    CREDENTIAL_STORES.length + 1,
    "the registry adds exactly one member of its own — the keyless route — and invents no other store",
  );

  const holders = new Set(VIEW.rows.map((r) => r.credential.holder));
  for (const holder of holders) {
    assert.ok(HOLDER_SAYS[holder] !== undefined, `a row claims to hold its key in ${holder}, which nothing can say in words`);
  }
});

test("ADM-C11: a credential event may say which store it landed in, and a store nobody can name is refused", () => {
  const complete = {
    kind: "CREATED",
    reportedAt: "2026-09-06",
    name: "the standing data runner's state-vote key",
    provider: "LegiScan",
    context: "standing production acquisition",
    scope: "read the published dataset",
    actor: "the owner",
    ownerCopyLocation: "the private settings file, under the key's own name",
  };

  assert.deepEqual(checkCredentialReport(complete), { ok: true }, "the field is optional; an older event is not retroactively incomplete");
  assert.deepEqual(
    checkCredentialReport({ ...complete, stores: ["REFRESH_JOB", "WORKSTATION"] }),
    { ok: true },
    "a report naming real stores passes",
  );

  for (const bad of [[], ["EVERYWHERE"], "REFRESH_JOB", [7], null]) {
    const verdict = checkCredentialReport({ ...complete, stores: bad });
    assert.equal(verdict.ok, false, `stores ${JSON.stringify(bad)} should be refused`);
    if (!verdict.ok) {
      assert.deepEqual(verdict.missing, ["stores"], `stores ${JSON.stringify(bad)} names exactly that field`);
      assert.deepEqual(verdict.refused, [], "an unusable store list is not a leaked value");
    }
  }

  assert.deepEqual(readCredentialStores(["SITE_RUNTIME"]), { ok: true, stores: ["SITE_RUNTIME"] });
  assert.deepEqual(readCredentialStores(["site_runtime"]), { ok: false }, "the store list is case-exact");
});

test("ADM-C11: the page renders every field the brief asks for", () => {
  const page = readFileSync(PAGE, "utf8");
  const columns = ["Source", "Standing", "Key", "Adapter", "Production operation", "Last read", "Next due", "Health", "Coverage", "Needs you"];
  for (const column of columns) {
    assert.ok(page.includes(`<th scope="col">${column}</th>`), `the table has no ${column} column`);
  }
  for (const field of ["row.capability", "row.productUsage", "row.spendConcern", "row.evidence", "row.blocker"]) {
    assert.ok(page.includes(field), `the page never renders ${field}`);
  }
  assert.match(page, /<QueueButton/, "POS-16: every gap carries the queue button");
  assert.match(page, /HOLDER_SAYS\[row\.credential\.holder\]/, "a row says where its key would live, in words");
});
