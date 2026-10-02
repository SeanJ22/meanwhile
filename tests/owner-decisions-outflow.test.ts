/**
 * **A DASHBOARD DECISION FLOWS OUT TO THE TRACKER.**
 * (ADM-4, the 9.4.26 admin feedback. Lane C. RULING 271.)
 *
 * The owner decides on the control centre; the button appends an intent to
 * the control plane. These tests cover the whole way out from there:
 *
 *   intent log  -> collapseDecisionLog   (lib/control-plane/decision-log.ts)
 *               -> owner-decisions-pull  (docs/tracker-owner-decisions.json)
 *               -> planOwnerDecisions    (scripts/tracker-core.mjs, pure)
 *               -> planMoves on the "sean" path, with NO bypass
 *
 * The pure half runs on synthetic stores, deliberately: `tests/tracker-stores.test.ts`
 * guards the committed stores and this file guards the RULE, which has to be
 * right on data nobody has yet. The scripted half runs the real scripts
 * against a file-backed control plane in a temp directory — never production,
 * never the committed tracker CSVs (`pnpm tracker:move` is not run here: it
 * imports the owner's workbook and rewrites the stores).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appendDecisionIntent } from "../lib/control-plane/admin-data.ts";
import {
  baseIntentId,
  collapseDecisionLog,
  latestDecisionFor,
  resolvedIntentId,
} from "../lib/control-plane/decision-log.ts";
import {
  ANSWERED_IN_OWN_WORDS,
  OWNER_SURFACE_FORMAT_VERSION,
  type OwnerDecisionIntent,
} from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  ANSWERED_IN_OWN_WORDS as CORE_OWN_WORDS,
  COLUMNS,
  DASHBOARD_OPENER,
  DECIDED_SECTION,
  FOLLOW_UP_PREFIX,
  OWNER_DECISIONS_JSON,
  dashboardCloser,
  planMoves,
  planOwnerDecisions,
  readSections,
} from "../scripts/tracker-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------- fixtures --- */

/** A past instant, so nothing here reads as a stamp about today. */
const T0 = "2026-08-28T10:00:00.000Z";
const T1 = "2026-08-28T10:05:00.000Z";
const T2 = "2026-08-28T10:30:00.000Z";

function intent(
  over: Partial<OwnerDecisionIntent> & { subjectId: string; decidedAt: string },
): OwnerDecisionIntent {
  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    intentId: `${over.subjectId}:${over.decidedAt}`,
    chosenOption: "Approve the export",
    consequenceShown: "",
    state: "PENDING_CANONICALIZATION",
    canonicalRef: null,
    refusedReason: null,
    adminSessionRef: "sid-outflow-test",
    ownerAnswer: null,
    ...over,
  };
}

type Row = Record<string, string>;

function row(over: Row): Row {
  return {
    ...Object.fromEntries(COLUMNS.map((c) => [c, ""])),
    Section: "needs-sean",
    Priority: "P2",
    Title: "Approve the synthetic export",
    "What this is": "A synthetic Needs Sean row that exists only inside this test.",
    "Opened by": "outflow-test",
    ...over,
  };
}

interface Entry {
  rowId: string;
  kind: string;
  blocker?: string;
  whatIsNeeded?: string;
  whyNoMachineCanDecide?: string;
  options?: { option: string; consequence: string }[];
}

const REGISTRY: Entry[] = [
  {
    rowId: "TD01",
    kind: "NOT_MACHINE_VERIFIABLE",
    whatIsNeeded: "Approve or decline the synthetic export.",
    whyNoMachineCanDecide: "It is a business decision.",
    options: [
      { option: "Approve the export", consequence: "the export ships under the published rate" },
      { option: "Decline or defer", consequence: "nothing ships and the row closes" },
    ],
  },
  { rowId: "TD02", kind: "predicate", blocker: "the secret is not in CI" },
  {
    rowId: "TD05",
    kind: "NOT_MACHINE_VERIFIABLE",
    whatIsNeeded: "Name the first record classes.",
    whyNoMachineCanDecide: "A product decision.",
    options: [{ option: "Open none yet", consequence: "the window stays in shadow" }],
  },
];

const sections = readSections(ROOT);

function stores() {
  const working = [
    row({ ID: "TD01" }),
    row({ ID: "TD02", Title: "A machine-checked wall" }),
    row({ ID: "TD03", Section: "repo-ops", Title: "Ordinary session work" }),
    row({ ID: "TD04", Title: "A row with no card" }),
    row({ ID: "TD05", Title: "Which classes open first" }),
  ];
  const resolved = [
    row({
      ID: "TD09",
      Resolution: "Resolved",
      "Resolved on": "2026-08-27",
      "Closed by": dashboardCloser(`TD09:${T0}`),
    }),
  ];
  return { working, resolved };
}

/* ========================================================================== */
/* collapseDecisionLog                                                        */
/* ========================================================================== */

test("collapseDecisionLog: a #resolved twin wins over its original, and the owner's words survive", () => {
  const original = intent({ subjectId: "TD01", decidedAt: T0, ownerAnswer: "ship it" });
  const twin: OwnerDecisionIntent = {
    ...original,
    intentId: resolvedIntentId(original.intentId),
    state: "CANONICALIZED",
    canonicalRef: "docs/tracker-resolved.csv#TD01 (resolved 2026-08-29)",
    refusedReason: null,
  };
  for (const order of [
    [original, twin],
    [twin, original],
  ]) {
    const out = collapseDecisionLog(order);
    assert.equal(out.length, 1, "two log rows, one decision");
    assert.equal(out[0].intentId, original.intentId, "the id is the DECISION's, suffix stripped");
    assert.equal(out[0].state, "CANONICALIZED");
    assert.equal(out[0].canonicalRef, twin.canonicalRef);
    assert.equal(out[0].ownerAnswer, "ship it", "what he wrote comes from the original");
    assert.equal(out[0].chosenOption, original.chosenOption);
  }
  assert.equal(baseIntentId("X:1#resolved#resolved"), "X:1", "a twin of a twin is still one decision");
});

test("collapseDecisionLog: newest decidedAt first, whatever order the store handed them over in", () => {
  const a = intent({ subjectId: "TD01", decidedAt: T0 });
  const b = intent({ subjectId: "TD05", decidedAt: T2 });
  const c = intent({ subjectId: "TD04", decidedAt: T1 });
  const ids = (rows: readonly OwnerDecisionIntent[]) => collapseDecisionLog(rows).map((r) => r.intentId);
  assert.deepEqual(ids([a, b, c]), [b.intentId, c.intentId, a.intentId]);
  assert.deepEqual(ids([c, a, b]), [b.intentId, c.intentId, a.intentId]);
  assert.deepEqual(ids([]), [], "an empty log collapses to nothing, and says so as an empty list");
});

test("latestDecisionFor: the newest decision about a subject, by decidedAt and never by position", () => {
  const first = intent({ subjectId: "TD01", decidedAt: T0, chosenOption: "Approve the export" });
  const second = intent({ subjectId: "TD01", decidedAt: T1, chosenOption: "Decline or defer" });
  assert.equal(latestDecisionFor([second, first], "TD01")?.intentId, second.intentId);
  assert.equal(latestDecisionFor([first, second], "TD01")?.intentId, second.intentId);
  assert.equal(latestDecisionFor([first, second], "TD05"), null, "no decision is null, not a guess");
});

/* ========================================================================== */
/* planOwnerDecisions — the pure applier                                       */
/* ========================================================================== */

test("RULING 271: a valid card option closes the row, carries the consequence, and opens the work", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD01", decidedAt: T0 });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });

  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.closes.length, 1);
  const close = plan.closes[0];
  assert.equal(close.id, "TD01");
  assert.equal(close.intentId, d.intentId);
  assert.equal(close.option, "Approve the export");
  assert.equal(
    close.consequence,
    "the export ships under the published rate",
    "the intent's consequence was blank, so the registry's consequence for that option is carried",
  );
  assert.equal(close.ownWords, false);
  assert.equal(close.adminSessionRef, "sid-outflow-test");
  assert.equal(
    close.note,
    `Decided on the dashboard ${T0} (intent ${d.intentId}): Approve the export — the export ships under the published rate.`,
  );

  assert.equal(plan.followUps.length, 1, "an accept option implies work");
  const follow = plan.followUps[0];
  assert.equal(follow.Section, DECIDED_SECTION);
  assert.equal(follow.Priority, "P2");
  assert.equal(follow.Title, "Act on TD01: Approve the export");
  assert.equal(follow["Depends on"], "TD01");
  assert.equal(follow["Opened by"], DASHBOARD_OPENER);
  assert.equal(follow.prefix, FOLLOW_UP_PREFIX);
  assert.match(follow["What this is"], /^Approve the synthetic export\. Sean chose: Approve the export — the export ships/);
  assert.match(follow["What this is"], /Sean's words: none\./);
  assert.match(follow["What this is"], /the Needs Sean row TD01 is closed on his decision and the obligation it concerned stays live \(RULING 271\)/);
});

test("RULING 271: the consequence he was SHOWN wins over the registry's text when both exist", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD01", decidedAt: T0, consequenceShown: "what the card said at the time" });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  assert.equal(plan.closes[0].consequence, "what the card said at the time");
});

test("RULING 271: an answer in his own words closes the row and the work carries his words", () => {
  const { working, resolved } = stores();
  const d = intent({
    subjectId: "TD01",
    decidedAt: T0,
    chosenOption: ANSWERED_IN_OWN_WORDS,
    ownerAnswer: "Ship it, but only to the two pilot buyers first.",
  });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.closes.length, 1);
  assert.equal(plan.closes[0].ownWords, true);
  assert.equal(
    plan.closes[0].note,
    `Answered on the dashboard ${T0} (intent ${d.intentId}): "Ship it, but only to the two pilot buyers first.".`,
  );
  assert.equal(plan.followUps.length, 1, "his words are work for a session to read and act on");
  assert.match(plan.followUps[0]["What this is"], /Sean's words: Ship it, but only to the two pilot buyers first\./);
  assert.equal(plan.followUps[0].Title, `Act on TD01: ${ANSWERED_IN_OWN_WORDS}`);
});

test("RULING 271: an option that is not on the card, with no answer, is refused by name", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD01", decidedAt: T0, chosenOption: "Approve the export!!" });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  assert.equal(plan.closes.length, 0);
  assert.equal(plan.followUps.length, 0);
  assert.equal(plan.refusals.length, 1);
  assert.equal(plan.refusals[0].intentId, d.intentId);
  assert.equal(plan.refusals[0].id, "TD01");
  assert.match(plan.refusals[0].reason, /none of the 2 option\(s\) on TD01's decision card/);
  assert.match(plan.refusals[0].reason, /no answer in his own words/);
});

test("RULING 227: a predicate row is a machine-checked wall and refuses a decision", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD02", decidedAt: T0, ownerAnswer: "just close it" });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  assert.equal(plan.closes.length, 0);
  assert.equal(plan.refusals.length, 1);
  assert.match(plan.refusals[0].reason, /machine-checked wall, not a decision/);
  assert.match(plan.refusals[0].reason, /RULING 227/);
});

test("RULING 271: an intent already applied is refused, so a second move never closes twice", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD09", decidedAt: T0 });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  assert.equal(plan.closes.length, 0);
  assert.equal(plan.refusals.length, 1);
  assert.match(plan.refusals[0].reason, /already applied: TD09 is closed by/);
});

test("RULING 271: a later decision about the same row supersedes an earlier one; only the latest applies", () => {
  const { working, resolved } = stores();
  const earlier = intent({ subjectId: "TD01", decidedAt: T0, chosenOption: "Approve the export" });
  const later = intent({ subjectId: "TD01", decidedAt: T1, chosenOption: "Decline or defer" });
  const plan = planOwnerDecisions({
    working,
    resolved,
    decisions: [earlier, later],
    registry: REGISTRY,
  });
  assert.equal(plan.closes.length, 1);
  assert.equal(plan.closes[0].intentId, later.intentId, "the later decision is the one applied");
  assert.equal(plan.closes[0].option, "Decline or defer");
  assert.equal(plan.refusals.length, 1);
  assert.equal(plan.refusals[0].intentId, earlier.intentId);
  assert.match(plan.refusals[0].reason, new RegExp(`superseded by ${later.intentId.replace(/[.:]/g, "\\$&")}`));
});

test("RULING 271: a Decline option closes the row and opens NO follow-up", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD01", decidedAt: T0, chosenOption: "Decline or defer" });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  assert.equal(plan.closes.length, 1);
  assert.equal(plan.closes[0].followUp, false);
  assert.deepEqual(plan.followUps, []);
  assert.match(plan.closes[0].note, /Decline or defer — nothing ships and the row closes\.$/);

  // And the other no-work prefixes the rule names.
  const none = intent({ subjectId: "TD05", decidedAt: T0, chosenOption: "Open none yet" });
  const p2 = planOwnerDecisions({ working, resolved, decisions: [none], registry: REGISTRY });
  assert.equal(p2.closes.length, 1);
  assert.deepEqual(p2.followUps, [], '"Open none yet" implies no work');
});

test("RULING 271: the applier never touches a row outside Needs Sean, and never a closed or missing one", () => {
  const { working, resolved } = stores();
  const outside = intent({ subjectId: "TD03", decidedAt: T0, ownerAnswer: "do it" });
  const missing = intent({ subjectId: "TD99", decidedAt: T0, ownerAnswer: "do it" });
  const plan = planOwnerDecisions({
    working,
    resolved,
    decisions: [outside, missing],
    registry: REGISTRY,
  });
  assert.equal(plan.closes.length, 0);
  assert.equal(plan.followUps.length, 0);
  const byId = Object.fromEntries(plan.refusals.map((r) => [r.id, r.reason]));
  assert.match(byId.TD03, /reaches only Needs Sean \(RULING 271\)/);
  assert.match(byId.TD99, /not a row in either store/);

  // A pure function: the stores it was handed are exactly as they were.
  assert.equal(working.find((r) => r.ID === "TD03")?.Resolution, "");
  assert.equal(working.every((r) => r["Closed by"] === ""), true);
});

test("RULING 271: no admin session on the decision means it cannot be shown to be his", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD01", decidedAt: T0, adminSessionRef: "" });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  assert.equal(plan.closes.length, 0);
  assert.match(plan.refusals[0].reason, /no admin session is recorded/);
});

test("RULING 271: a row with no decision card closes only on his own words", () => {
  const { working, resolved } = stores();
  const optionOnly = intent({ subjectId: "TD04", decidedAt: T0, chosenOption: "Approve the export" });
  const words = intent({ subjectId: "TD04", decidedAt: T1, chosenOption: ANSWERED_IN_OWN_WORDS, ownerAnswer: "yes" });
  const refused = planOwnerDecisions({ working, resolved, decisions: [optionOnly], registry: REGISTRY });
  assert.equal(refused.closes.length, 0);
  assert.match(refused.refusals[0].reason, /no decision card in lib\/tracker\/registry\.mjs/);
  const closed = planOwnerDecisions({ working, resolved, decisions: [words], registry: REGISTRY });
  assert.equal(closed.closes.length, 1);
});

/* ========================================================================== */
/* The close goes through planMoves on the EXISTING "sean" path                */
/* ========================================================================== */

test("a dashboard close moves through planMoves as Sean's own resolution, with no bypass", () => {
  const { working, resolved } = stores();
  const d = intent({ subjectId: "TD01", decidedAt: T0 });
  const plan = planOwnerDecisions({ working, resolved, decisions: [d], registry: REGISTRY });
  const close = plan.closes[0];

  // Exactly what scripts/tracker.mjs move does with a close.
  const target = working.find((r) => r.ID === close.id) as Row;
  target.Resolution = "Resolved";
  target.Notes = close.note;
  target["Closed by"] = dashboardCloser(close.intentId);

  // Registered as his handwriting, it moves — on the path the workbook uses.
  const asSean = planMoves({ working, sections, actor: "session", resolutionAuthor: { TD01: "sean" } });
  assert.deepEqual(asSean.refusals, []);
  assert.deepEqual(asSean.moves.map((r) => r.ID), ["TD01"]);
  assert.equal(asSean.moves[0]["Closed by"], `Sean (dashboard ${d.intentId})`);
});

test("the decided section exists, is not first, and the two own-words literals agree", () => {
  const decided = sections.find((s) => s.slug === DECIDED_SECTION);
  assert.ok(decided, `docs/tracker-sections.json carries "${DECIDED_SECTION}"`);
  assert.equal(sections[0].slug, "needs-sean", "RULING 31: Needs Sean stays first");
  assert.equal(decided?.onlySeanResolves, undefined, "a session resolves the work it does there");
  assert.equal(CORE_OWN_WORDS, ANSWERED_IN_OWN_WORDS, "tracker-core.mjs and owner-surface.ts agree on the literal");
  assert.equal(OWNER_DECISIONS_JSON, "docs/tracker-owner-decisions.json");
});

/* ========================================================================== */
/* The scripts, against a file-backed control plane in a temp directory        */
/* ========================================================================== */

function run(script: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", join(ROOT, script), ...args],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("the committed export exists, names its only writer, and is the shape move reads", () => {
  const path = join(ROOT, OWNER_DECISIONS_JSON);
  assert.ok(existsSync(path), `${OWNER_DECISIONS_JSON} is committed`);
  const file = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(file.formatVersion, 1);
  assert.match(file.note, /WRITTEN ONLY by scripts\/owner-decisions-pull\.mts/);
  assert.ok(Array.isArray(file.intents), "intents is an array move can read");
  assert.match(String(file.pulledAt), /^\d{4}-\d{2}-\d{2}T/);
});

test("file-store round trip: appendDecisionIntent -> owner-decisions-pull -> the export holds the intent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-outflow-"));
  try {
    const store = join(dir, "store");
    const out = join(dir, "decisions.json");
    const repos = await createFileRepositories(store);
    const first = intent({ subjectId: "TD01", decidedAt: T0, ownerAnswer: "go" });
    const wrote = await appendDecisionIntent(repos, first, T0);
    assert.equal(wrote.ok, true);

    const pull = run("scripts/owner-decisions-pull.mts", [`--file-store=${store}`, `--out=${out}`]);
    assert.equal(pull.code, 0, pull.out);
    assert.match(pull.out, /pulled 1 intent\(s\); file holds 1/);
    assert.match(pull.out, /intents pulled from the control plane, of the intents the export holds: 1 of 1/);

    const file = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(file.formatVersion, 1);
    assert.equal(file.intents.length, 1);
    assert.equal(file.intents[0].intentId, first.intentId);
    assert.equal(file.intents[0].ownerAnswer, "go");
    assert.equal(file.intents[0].state, "PENDING_CANONICALIZATION");
    assert.ok(file.pulledFromSha === null || /^[0-9a-f]{40}$/.test(file.pulledFromSha));

    // A second pull merges by id: nothing doubles, nothing is dropped.
    const again = run("scripts/owner-decisions-pull.mts", [`--file-store=${store}`, `--out=${out}`]);
    assert.equal(again.code, 0, again.out);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).intents.length, 1);

    // A later decision and a resolution twin of the first: two decisions, latest state.
    const second = intent({ subjectId: "TD05", decidedAt: T1, chosenOption: "Open none yet" });
    await appendDecisionIntent(repos, second, T1);
    await appendDecisionIntent(
      repos,
      { ...first, intentId: resolvedIntentId(first.intentId), state: "CANONICALIZED", canonicalRef: "docs/tracker-resolved.csv#TD01 (resolved 2026-08-29)" },
      T2,
    );
    const third = run("scripts/owner-decisions-pull.mts", [`--file-store=${store}`, `--out=${out}`]);
    assert.equal(third.code, 0, third.out);
    assert.match(third.out, /pulled 2 intent\(s\); file holds 2/);
    const merged = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(
      merged.intents.map((i: OwnerDecisionIntent) => i.intentId),
      [second.intentId, first.intentId],
      "newest first, and the twin's id is folded into the decision's",
    );
    assert.equal(merged.intents[1].state, "CANONICALIZED", "the twin's state wins");

    // An empty store pulls nothing and SAYS it could not assert, rather than printing a bare zero.
    const empty = run("scripts/owner-decisions-pull.mts", [`--file-store=${join(dir, "empty")}`, `--out=${join(dir, "empty.json")}`]);
    assert.equal(empty.code, 0, empty.out);
    assert.match(empty.out, /pulled 0 intent\(s\); file holds 0/);
    assert.match(empty.out, /COULD NOT ASSERT — the decision log is reachable and holds no intent yet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
