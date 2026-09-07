/**
 * **THE 9.4.26 EVENING ADMIN FEEDBACK, PINNED.** (ADM-10 through ADM-23.)
 *
 * Every row of the owner's sweep names an instance of a class; these guards
 * pin the class. Pure modules are exercised as functions; the pages are read
 * as source text (a `.tsx` cannot be imported under `node --test`), the same
 * way the morning's guards do it (`tests/admin-feedback-9-4.test.ts`).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { surfaceSource } from "./admin-surface.ts";
import { consoleReturnPath, isConsolePath } from "../lib/control-plane/console-paths.ts";
import { buildCostPanel, costRowKind } from "../lib/control-plane/cost-panel.ts";
import { NO_FOLLOW_UP_OPTION as RECEIPT_NO_WORK, decisionReceipt, impliesNoWork, receiptHeadline, splitDecided } from "../lib/control-plane/decision-receipt.ts";
import { LEVEL_CLASS, displayNameOf, words } from "../lib/control-plane/display-name.ts";
import { easternize, formatCalendarDate, formatEastern, formatEasternDate, formatEasternSpan, NO_STAMP, BAD_STAMP } from "../lib/control-plane/eastern-time.ts";
import { buildFleetView } from "../lib/control-plane/fleet-view.ts";
import { OWNER_FOLDER, validateSweep, type SweepRecord } from "../lib/feedback/sweep.ts";
import {
  ADD_TO_QUEUE_OPTION,
  FIX_QUEUE_SUBJECT,
  GO_FIX_OPTION,
  fixConsequence,
  fixQueueView,
  fixSubjectId,
  isRowDecision,
  parseFixField,
} from "../lib/control-plane/fix-queue.ts";
import { DECISION_LOG_KEY, appendDecisionIntent } from "../lib/control-plane/admin-data.ts";
import { collapseDecisionLog } from "../lib/control-plane/decision-log.ts";
import { ANSWERED_IN_OWN_WORDS, held, measured, type OwnerDecisionCard, type OwnerDecisionIntent } from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { plainWindow, recordClassLabel } from "../lib/control-plane/plain-window.ts";
import { populationInCompleteZip, type StateAuthorities } from "../lib/control-plane/readiness/extract.ts";
import { METRIC_GROUP_MEANING, researchDigestRows } from "../lib/control-plane/research-digest.ts";
import type { ResearchMetrics } from "../lib/control-plane/research-metrics.ts";
import type { WindowView } from "../lib/control-plane/window-view.ts";
import { findingPlain, roleLead, verdictPlain, workItemStatePlain } from "../lib/control-plane/workers/plain-roles.ts";
import type { WorkerRoleView } from "../lib/control-plane/workers/readback.ts";
import { ACS_STATE_DATASET, ACS_ZCTA_DATASET, statePopulation, zipPopulation } from "../lib/reference/acs-population.ts";
import { REFERENCE_ROW_COUNTS, readTable } from "../lib/reference/index.ts";
import { normalize, toCsv, type AcsFetch } from "../lib/sources/census-acs-population/index.ts";
import {
  COLUMNS,
  DASHBOARD_OPENER,
  FIX_OPENER,
  FIX_PREFIX,
  NO_FOLLOW_UP_OPTION as CORE_NO_WORK,
  dashboardCloser,
  fixRowMarker,
  goRowMarker,
  planFixQueue,
  planOwnerDecisions,
  writeStore,
} from "../scripts/tracker-core.mjs";

const ROOT = process.cwd();
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
/*
 * Admin C split the 1,236-line home page into section components. A guard that
 * names ONE file would have gone green-by-absence on a section that moved, so
 * the guards below read the SURFACE — every file that composes it, walked from
 * the directory rather than hand-listed. `tests/admin-surface.ts` carries the
 * argument in full.
 */
const surface = (which: "home" | "research" | "readiness"): string => surfaceSource(ROOT, which);

/* ================================================================== *
 * ADM-22 — every stamp is Eastern, spelled out
 * ================================================================== */

test("ADM-22: an ISO stamp reads as Eastern time spelled out, with the year only when asked; a missing or unreadable stamp says so", () => {
  assert.equal(formatEastern("2026-09-05T02:20:57.808Z"), "September 4, 10:20 PM ET", "02:20Z is the evening before in New York");
  assert.equal(formatEastern("2026-01-05T15:20:57.808Z", { year: true }), "January 5, 2026, 10:20 AM ET", "EST in January");
  assert.equal(formatEasternDate("2026-09-05T02:20:57.808Z"), "September 4");
  assert.equal(formatEasternSpan("2026-09-04T08:04:50.476Z", "2026-09-04T08:15:00.553Z"), "September 4, 4:04 AM – 4:15 AM ET");
  assert.equal(formatCalendarDate("2026-08-11"), "August 11, 2026", "a bare tracker date is the day it names, never shifted through UTC");
  assert.equal(formatEastern(null), NO_STAMP);
  assert.equal(formatEastern("garbage"), BAD_STAMP);
  assert.equal(
    easternize("parent relaunch proven 2026-09-02T15:36:25.8796479Z: pid 20240; trigger present at 2026-09-05T06:17:17.081Z"),
    "parent relaunch proven September 2, 2026, 11:36 AM ET: pid 20240; trigger present at September 5, 2026, 2:17 AM ET",
    "an instrument's own sentence keeps its words and loses its machine stamps",
  );
});

test("ADM-22: no console page prints a raw ISO stamp where the owner reads; every one goes through <When>", () => {
  for (const which of ["home", "research", "readiness"] as const) {
    const page = surface(which);
    assert.match(page, /<When iso=/, `the ${which} surface renders stamps through When`);
    assert.doesNotMatch(page, /[^=$]\{(snapshot\.publishedAt|heartbeat\.lastCycleStartedAt|d\.writtenAt|intent\.requestedAt|row\.recordedAt|attempt\.startedAt)\}/, `the ${which} surface prints no bare ISO stamp`);
  }
  assert.match(src("app/(admin)/console-ui.tsx"), /dateTime=\{iso\} title=\{iso\}/, "the ISO string stays on the element for the machine and the hover");
  assert.match(src("app/(admin)/console-ui.tsx"), /<span className="gap-whose">\{gapLabel\(gap\)\}<\/span> \{easternize\(gap\.says\)\}/, "a published gap sentence is quoted with its stamps in Eastern time");
  for (const which of ["home", "research"] as const) {
    assert.ok((surface(which).match(/<Said text=/g) ?? []).length >= 5, `the ${which} surface quotes instrument sentences through Said`);
  }
});

/* ================================================================== *
 * ADM-12 — keys render as names; a person is never invented
 * ================================================================== */

test("ADM-12: jurisdiction, OCD, ballot, curated and record keys render as display names with their level", () => {
  assert.equal(displayNameOf("nj:county:county-of-atlantic").name, "Atlantic County, New Jersey");
  assert.equal(displayNameOf("nj:county:county-of-atlantic").level, "local");
  assert.equal(displayNameOf("az:city:city-of-avondale").name, "City of Avondale, Arizona");
  const sb = displayNameOf("ocd-division/country:us/state:nh/county:sullivan/place:springfield_town#select-board");
  assert.equal(sb.name, "Springfield Town — Select Board, Sullivan County, New Hampshire");
  assert.equal(sb.short, "Springfield Town — Select Board");
  assert.equal(displayNameOf("ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#board").level, "school");
  assert.equal(displayNameOf("ballot-az-pima:prop-423").name, "Pima County Prop 423, Arizona");
  assert.equal(displayNameOf("ballot-az-pima:us-house-6").name, "Pima County U.S. House District 6, Arizona");
  assert.equal(displayNameOf("ballot-az-pima:us-house-6").level, "federal");
  assert.equal(displayNameOf("curated:az/corona-de-tucson-fire-district#governing").name, "Corona de Tucson Fire District (governing body), Arizona");
  assert.equal(displayNameOf("at-4da7d91e090a1497b3bff5ff").name, "Attempt 4da7d91e");
  assert.equal(displayNameOf("wi-6de0185c52067ad3c8ad51c2").name, "Work item 6de0185c");
  assert.equal(displayNameOf("proof-mthbrw87").name, "Proof run mthbrw87");
  assert.equal(displayNameOf("az").name, "Arizona");
  assert.equal(displayNameOf("Arizona").level, "state");
  assert.equal(displayNameOf("az-sos-cfs-bulk-ftp").name, "SOS CFS Bulk FTP, Arizona");
  assert.equal(displayNameOf("").name, "no subject recorded");
  assert.equal(displayNameOf("meetings:1").recognised, false, "an unrecognised key says so rather than pretending");
  assert.equal(words("u-s-representative-district-6"), "U.S. Representative District 6");
  assert.deepEqual(Object.keys(LEVEL_CLASS).sort(), ["federal", "local", "school", "state"]);
  // The fleet's own sentence names places, never keys.
  const fleet = buildFleetView({
    nowIso: "2026-09-05T03:00:00.000Z",
    attempts: [
      { id: "a1", routeTaskId: "r", leaseId: "l", workItemId: "w1", startedAt: "2026-09-04T10:00:00.000Z", endedAt: "2026-09-04T10:05:00.000Z", outcome: "COMPLETED", abortReason: null, artifactIds: [], methodVersion: "m", policyVersion: "p", cost: { inputTokens: null, outputTokens: null, usd: null, durationMs: null, bytesFetched: null, requestCount: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, worker: { role: "SCOUT", provider: "we-the-people", version: "deterministic-walker", instance: "i" } },
    ] as never,
    workItems: [{ id: "w1", subject: "ballot-az-pima:prop-423" }] as never,
    routeTasks: [],
  });
  assert.match(fleet.groups[0].doing, /worked in Pima County Prop 423\./);
  assert.doesNotMatch(fleet.groups[0].doing, /ballot-az-pima/);
});

test("ADM-12: a candidate is named from the record and never re-derived from the slug", () => {
  const key = "az:2026:state-az-sldl-19:state-representative-district-19:anderson-jackie-o-donnell";
  const named = displayNameOf(key, { candidateNames: { "anderson-jackie-o-donnell": "Jackie O'Donnell Anderson" } });
  assert.equal(named.name, "Jackie O'Donnell Anderson — State Representative District 19, Arizona (2026)");
  assert.equal(named.level, "state");
  const bare = displayNameOf(key);
  assert.match(bare.name, /^candidate anderson-jackie-o-donnell — State Representative District 19/, "no record, no invented name: the slug stays a slug");
  assert.doesNotMatch(bare.name, /O'Donnell|Donnell Anderson/);
  const federal = displayNameOf("az:2026:state-az-cd-6:u-s-representative-district-6:peters-jereme-lance");
  assert.equal(federal.level, "federal");
  assert.match(federal.name, /U\.S\. Representative District 6/);
  const publisher = src("scripts/publish-owner-snapshot.mts");
  assert.match(publisher, /candidateNames\(\)/, "the publisher carries the slug → name map on the snapshot");
  assert.match(publisher, /candidate-cards-2026\.json/);
});

test("ADM-12: every console surface renders keys through <Name>, raw key on hover", () => {
  const nameUses = [["home", 3], ["research", 3]] as const;
  for (const [which, least] of nameUses) {
    const n = (surface(which).match(/<Name raw=/g) ?? []).length;
    assert.ok(n >= least, `the ${which} surface renders at least ${least} keys through Name (found ${n})`);
  }
  const ui = src("app/(admin)/console-ui.tsx");
  assert.match(ui, /title=\{d\.raw === d\.name \? undefined : d\.raw\}/, "the raw key is the hover title");
});

/* ================================================================== *
 * ADM-16 — the receipt: recorded, in the tracker, work opened
 * ================================================================== */

const INTENT = (over: Partial<OwnerDecisionIntent>): OwnerDecisionIntent => ({
  formatVersion: 1,
  intentId: "T05:2026-09-05T03:00:00.000Z",
  subjectId: "T05",
  chosenOption: "Name yourself as the reviewer and build the surface",
  consequenceShown: "NH165 unblocks",
  decidedAt: "2026-09-05T03:00:00.000Z",
  state: "PENDING_CANONICALIZATION",
  canonicalRef: null,
  refusedReason: null,
  adminSessionRef: "adm_x",
  ownerAnswer: null,
  ...over,
});
const CARD = (rowId: string, title: string): OwnerDecisionCard => ({
  rowId,
  title,
  whatIsNeeded: "…",
  whyNoMachineCanDecide: "…",
  options: [],
  blockedDescendants: null,
  openedOn: null,
  ageDays: null,
  priority: "P1",
  verifiability: "NOT_MACHINE_VERIFIABLE",
});

test("ADM-16: a fresh decision is recorded and WAITING on the tracker and the work; an applied one names the row and the work opened", () => {
  const fresh = decisionReceipt(INTENT({}));
  assert.deepEqual(fresh.map((s) => `${s.key}:${s.state}`), ["recorded:DONE", "tracker:WAITING", "work:WAITING"]);
  assert.match(fresh[1].says, /standing runner applies recorded decisions/);
  assert.equal(receiptHeadline(fresh), "recorded · waiting for the next sync");
  const applied = decisionReceipt(INTENT({ state: "CANONICALIZED", canonicalRef: "docs/tracker-resolved.csv#T05 (resolved 2026-09-05)", openedWork: [{ id: "DEC03", title: "Act on T05: Name yourself as the reviewer and build the surface" }] }));
  assert.deepEqual(applied.map((s) => s.state), ["DONE", "DONE", "DONE"]);
  assert.match(applied[1].says, /docs\/tracker-resolved\.csv#T05/);
  assert.match(applied[2].says, /DEC03 — Act on T05/);
  assert.equal(receiptHeadline(applied), "recorded · closed in the tracker · work opened");
  const declined = decisionReceipt(INTENT({ chosenOption: "Decline or defer", state: "CANONICALIZED", canonicalRef: "docs/tracker-resolved.csv#T05 (resolved 2026-09-05)", openedWork: [] }));
  assert.match(declined[2].says, /No work is implied/);
  assert.equal(impliesNoWork({ chosenOption: "Acknowledge the correction" }), true);
  assert.equal(impliesNoWork({ chosenOption: ANSWERED_IN_OWN_WORDS }), false, "his own words are always work for a session to read");
  const refused = decisionReceipt(INTENT({ state: "REJECTED_BY_GATES", refusedReason: "R-0001 is retired" }));
  assert.deepEqual(refused.map((s) => s.state), ["DONE", "REFUSED", "REFUSED"]);
  assert.equal(RECEIPT_NO_WORK.source, CORE_NO_WORK.source, "the page's no-work rule is the tracker applier's, verbatim");
});

test("ADM-16: a card with a recorded decision leaves 'waiting on you' at once; a decision whose card has left the snapshot is still listed", () => {
  const cards = [CARD("T05", "Abuse policy live"), CARD("B01", "Settle the name")];
  const gone = INTENT({ intentId: "NH108:2026-09-05T02:00:00.000Z", subjectId: "NH108", decidedAt: "2026-09-05T02:00:00.000Z", state: "CANONICALIZED", canonicalRef: "docs/tracker-resolved.csv#NH108 (resolved 2026-09-05)", subjectTitle: "Four decisions before any questionnaire" });
  const queued = INTENT({ intentId: "fix:abc:2026-09-05T02:30:00.000Z", subjectId: "fix:abc", chosenOption: ADD_TO_QUEUE_OPTION, decidedAt: "2026-09-05T02:30:00.000Z" });
  const { waiting, decided } = splitDecided(cards, [INTENT({}), gone, queued]);
  assert.deepEqual(waiting.map((c) => c.rowId), ["B01"]);
  assert.deepEqual(decided.map((d) => d.decision.subjectId), ["T05", "NH108"], "newest first; the queued gap is not a row decision");
  assert.equal(decided[1].card, null);
  assert.equal(decided[1].decision.subjectTitle, "Four decisions before any questionnaire");
  assert.equal(isRowDecision(queued), false);
});

test("ADM-16: the page renders the split and the receipt, the routes return to the console page the form came from, and the sync is scheduled on the runner", () => {
  const page = surface("home");
  assert.match(page, /splitDecided\(/);
  assert.match(page, /total=\{waiting\.length\}/, "the count is the WAITING cards, not every card");
  assert.match(
    src("app/(admin)/admin/decisions.tsx"),
    /const waitingNow = total - goneRows\.size;/,
    "ADM-32: the count drops the moment a decision is recorded, before the network answers",
  );
  assert.match(page, /<DecidedSection /);
  assert.match(page, /className="receipt"/);
  assert.match(page, /returnTo=\{HERE\}/);
  assert.doesNotMatch(page, /carried into the tracker at the next sync, where the row closes/, "the old one-sentence promise is gone; the receipt shows each leg");
  assert.equal(consoleReturnPath("/readiness/az", "/admin"), "/readiness/az");
  assert.equal(consoleReturnPath("https://evil.example/", "/admin"), "/admin");
  assert.equal(consoleReturnPath("/readiness/AZ", "/admin"), "/admin", "the closed list is exact");
  assert.equal(isConsolePath("/admin/research"), true);
  assert.match(src("app/api/admin/decision/route.ts"), /consoleReturnPath\(/);
  assert.match(src("app/api/admin/research/route.ts"), /consoleReturnPath\(/);
  const canon = src("scripts/canonicalize-owner-decisions.mts");
  assert.match(canon, /openedWork: resolution\.openedWork/, "the twin carries the work opened");
  assert.match(canon, /subjectTitle: resolution\.subjectTitle/);
  assert.match(canon, /"Opened by"\] \?\? ""\)\.trim\(\) === DASHBOARD_OPENER/, "work opened is found by the dashboard opener, never guessed");
  const runner = src("scripts/pilot-runner.mts");
  const sync = runner.indexOf('name: "decision sync"');
  const snapshot = runner.indexOf('name: "owner snapshot"');
  assert.ok(sync > 0 && snapshot > sync, "the decision sync runs before the snapshot republishes");
  assert.match(runner, /scripts\/apply-owner-decisions\.mts/);
  const apply = src("scripts/apply-owner-decisions.mts");
  assert.match(apply, /owner-decisions-pull\.mts/);
  assert.match(apply, /"move", "--only=dashboard", "--session=dashboard-decision-nonhunt"/);
  assert.match(apply, /canonicalize-owner-decisions\.mts/);
  assert.match(src("scripts/tracker.mjs"), /const book = ONLY_DASHBOARD \? null : readWorkbookRows\(\);/, "the unattended sync never imports the workbook");
  assert.match(src("package.json"), /"decisions:sync":/);
});


/* ================================================================== *
 * ADM-16 — the whole way out, proved on a file-backed control plane
 * ================================================================== */

function run(script: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, script), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 26,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("ADM-16: the whole way out, on a file-backed control plane: record → pull → the applied tracker rows → canonicalize → a receipt with every step DONE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-adm16-"));
  try {
    const store = join(dir, "store");
    const repos = await createFileRepositories(store);
    const T0 = "2026-09-05T03:00:00.000Z";
    const decision = INTENT({ intentId: `T05:${T0}`, subjectId: "T05", decidedAt: T0 });
    const queued = INTENT({ intentId: `fix:abcd1234:${T0}`, subjectId: "fix:abcd1234", chosenOption: ADD_TO_QUEUE_OPTION, consequenceShown: fixConsequence("Cost", "not measured yet"), decidedAt: T0 });
    const go = INTENT({ intentId: "fix-queue:2026-09-05T03:05:00.000Z", subjectId: FIX_QUEUE_SUBJECT, chosenOption: GO_FIX_OPTION, consequenceShown: "1 queued gap(s)", decidedAt: "2026-09-05T03:05:00.000Z" });
    for (const i of [decision, queued, go]) assert.equal((await appendDecisionIntent(repos, i, i.decidedAt)).ok, true);

    // 1. The pull exports the log.
    const out = join(dir, "decisions.json");
    const pull = run("scripts/owner-decisions-pull.mts", [`--file-store=${store}`, `--out=${out}`]);
    assert.equal(pull.code, 0, pull.out);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).intents.length, 3);

    // 2. What the move script writes when it applies them (proved in tests/owner-decisions-outflow.test.ts).
    const row = (over: Record<string, string>) => ({ ...Object.fromEntries(COLUMNS.map((c) => [c, ""])), Section: "needs-sean", Priority: "P1", Title: "Abuse policy live", "What this is": "…", ...over });
    const resolved = join(dir, "resolved.csv");
    const working = join(dir, "working.csv");
    writeFileSync(resolved, writeStore([row({ ID: "T05", Resolution: "Resolved", "Resolved on": "2026-09-05", "Closed by": dashboardCloser(decision.intentId) })]), "utf8");
    writeFileSync(
      working,
      writeStore([
        row({ ID: "DEC03", Section: "decided", Priority: "P2", Title: "Act on T05: Name yourself as the reviewer and build the surface", "Depends on": "T05", "Opened by": DASHBOARD_OPENER }),
        row({ ID: "FIX01", Section: "decided", Priority: "P2", Title: "Fix: not measured yet", Detail: `${fixRowMarker(queued.intentId)} ${goRowMarker(go.intentId)} subject fix:abcd1234`, "Opened by": FIX_OPENER }),
      ]),
      "utf8",
    );

    // 3. The canonicalizer records what each intent became.
    const canon = run("scripts/canonicalize-owner-decisions.mts", [`--file-store=${store}`, `--resolved=${resolved}`, `--working=${working}`]);
    assert.equal(canon.code, 0, canon.out);
    assert.ok(canon.out.includes("3 intent(s) resolved"), canon.out);
    const log = await repos.ownerDecisions.read(DECISION_LOG_KEY);
    assert.equal(log.length, 6, "three originals, three resolutions");

    // 4. The page's receipt, from the collapsed log alone.
    const collapsed = collapseDecisionLog(log);
    const { decided, waiting } = splitDecided([CARD("T05", "Abuse policy live"), CARD("B01", "Settle the name")], collapsed);
    assert.deepEqual(waiting.map((c) => c.rowId), ["B01"]);
    assert.equal(decided.length, 1);
    assert.deepEqual(decided[0].steps.map((s) => s.state), ["DONE", "DONE", "DONE"]);
    assert.ok(decided[0].steps[1].says.includes(`Closed in the tracker as ${resolved}#T05 (resolved 2026-09-05)`), decided[0].steps[1].says);
    assert.match(decided[0].steps[2].says, /DEC03 — Act on T05: Name yourself as the reviewer and build the surface/);
    assert.equal(decided[0].decision.subjectTitle, "Abuse policy live");
    const queue = fixQueueView(collapsed);
    assert.deepEqual(queue.items.map((i) => [i.state, i.openedWork.map((w) => w.id)]), [["OPENED", ["FIX01"]]]);
    assert.equal(queue.lastGo?.state, "CANONICALIZED");
    assert.ok((queue.lastGo?.canonicalRef ?? "").includes("opened 1 fix row(s): FIX01"), queue.lastGo?.canonicalRef ?? "");

    // Idempotent: a second canonicalize appends nothing.
    const again = run("scripts/canonicalize-owner-decisions.mts", [`--file-store=${store}`, `--resolved=${resolved}`, `--working=${working}`]);
    assert.equal(again.code, 0, again.out);
    assert.equal((await repos.ownerDecisions.read(DECISION_LOG_KEY)).length, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================== *
 * ADM-20 — the fix queue
 * ================================================================== */

test("ADM-20: a gap's subject is stable per surface and sentence, and the queue folds intents into QUEUED / SENT / OPENED / REFUSED", () => {
  const sid = fixSubjectId("Cost", "not measured yet");
  assert.equal(sid, fixSubjectId("Cost", "not measured yet "), "trimmed, so a re-render never changes the id");
  assert.notEqual(sid, fixSubjectId("Cost · other", "not measured yet"));
  assert.match(sid, /^fix:[0-9a-f]{8}$/);
  assert.equal(fixConsequence("Cost", "not measured yet"), "Cost — not measured yet");
  const q = INTENT({ intentId: `${sid}:2026-09-05T03:10:00.000Z`, subjectId: sid, chosenOption: ADD_TO_QUEUE_OPTION, consequenceShown: fixConsequence("Cost", "not measured yet"), decidedAt: "2026-09-05T03:10:00.000Z" });
  const go = INTENT({ intentId: "fix-queue:2026-09-05T03:20:00.000Z", subjectId: FIX_QUEUE_SUBJECT, chosenOption: GO_FIX_OPTION, consequenceShown: "", decidedAt: "2026-09-05T03:20:00.000Z" });
  const later = INTENT({ intentId: "fix:zzzz:2026-09-05T03:30:00.000Z", subjectId: "fix:zzzz", chosenOption: ADD_TO_QUEUE_OPTION, consequenceShown: "Research — no state", decidedAt: "2026-09-05T03:30:00.000Z" });
  assert.equal(fixQueueView([q]).items[0].state, "QUEUED");
  const view = fixQueueView([q, go, later]);
  assert.deepEqual(view.items.map((i) => [i.subjectId, i.state]), [["fix:zzzz", "QUEUED"], [sid, "SENT"]]);
  assert.equal(view.items[1].where, "Cost");
  assert.equal(view.items[1].says, "not measured yet");
  assert.equal(view.lastGo?.intentId, go.intentId);
  assert.deepEqual(view.counts, { queued: 1, sent: 1, opened: 0, refused: 0 });
  const opened = fixQueueView([{ ...q, state: "CANONICALIZED", canonicalRef: "docs/tracker-working.csv#FIX01", openedWork: [{ id: "FIX01", title: "Fix: not measured yet" }] }, go]);
  assert.equal(opened.items[0].state, "OPENED");
  assert.deepEqual(opened.items[0].openedWork, [{ id: "FIX01", title: "Fix: not measured yet" }]);
});

test("ADM-20: the applier opens a FIX row only for a gap queued at or before a Go, marks it by intent, and refuses one with no session", () => {
  const row = (over: Record<string, string>) => ({ ID: "", Section: "needs-sean", Title: "", "What this is": "", Resolution: "", "Closed by": "", Detail: "", "Opened by": "", ...over });
  const working = [row({ ID: "T05", Title: "Abuse policy live" })];
  const decisions = [
    { intentId: "fix:a:2026-09-05T03:10:00.000Z", subjectId: "fix:a", chosenOption: ADD_TO_QUEUE_OPTION, consequenceShown: "Cost — not measured yet", decidedAt: "2026-09-05T03:10:00.000Z", adminSessionRef: "s" },
    { intentId: "fix:b:2026-09-05T03:40:00.000Z", subjectId: "fix:b", chosenOption: ADD_TO_QUEUE_OPTION, consequenceShown: "Research — no state", decidedAt: "2026-09-05T03:40:00.000Z", adminSessionRef: "s" },
    { intentId: "fix:c:2026-09-05T03:11:00.000Z", subjectId: "fix:c", chosenOption: ADD_TO_QUEUE_OPTION, consequenceShown: "Runner — silent", decidedAt: "2026-09-05T03:11:00.000Z", adminSessionRef: "" },
    { intentId: "fix-queue:2026-09-05T03:20:00.000Z", subjectId: FIX_QUEUE_SUBJECT, chosenOption: GO_FIX_OPTION, consequenceShown: "", decidedAt: "2026-09-05T03:20:00.000Z", adminSessionRef: "s" },
    { intentId: "T05:2026-09-05T03:00:00.000Z", subjectId: "T05", chosenOption: ANSWERED_IN_OWN_WORDS, consequenceShown: "", decidedAt: "2026-09-05T03:00:00.000Z", adminSessionRef: "s", ownerAnswer: "do it" },
  ];
  const plan = planFixQueue({ working, resolved: [], decisions });
  assert.deepEqual(plan.opens.map((o) => o.subjectId), ["fix:a"]);
  assert.equal(plan.opens[0].row.prefix, FIX_PREFIX);
  assert.equal(plan.opens[0].row.Section, "decided");
  assert.equal(plan.opens[0].row["Opened by"], FIX_OPENER);
  assert.equal(plan.opens[0].row.Title, "Fix: not measured yet");
  assert.match(plan.opens[0].row["What this is"], /^Cost: not measured yet Sean queued this gap/);
  assert.ok(plan.opens[0].row.Detail.includes(fixRowMarker("fix:a:2026-09-05T03:10:00.000Z")));
  assert.ok(plan.opens[0].row.Detail.includes(goRowMarker("fix-queue:2026-09-05T03:20:00.000Z")));
  assert.deepEqual(plan.waiting.map((w) => w.subjectId), ["fix:b"], "queued after the Go waits for the next one");
  assert.deepEqual(plan.refusals.map((r) => r.id), ["fix:c"]);
  assert.equal(plan.go?.intentId, "fix-queue:2026-09-05T03:20:00.000Z");
  // Applied once: a row carrying the marker is not opened again.
  const again = planFixQueue({ working: [...working, row({ ID: "FIX01", Section: "decided", Detail: fixRowMarker("fix:a:2026-09-05T03:10:00.000Z") })], resolved: [], decisions });
  assert.deepEqual(again.opens, []);
  // The row applier ignores the fix queue's intents entirely.
  const rows = planOwnerDecisions({ working, resolved: [], decisions, registry: [] });
  assert.deepEqual(rows.closes.map((c) => c.id), ["T05"]);
  assert.equal(rows.refusals.some((r) => r.id.startsWith("fix")), false, "no fix intent reaches the row applier as a refusal");
  assert.notEqual(String(DASHBOARD_OPENER), String(FIX_OPENER));
});

test("ADM-20: every gap on the console carries the queue button, and the page has the queue with Go fix these", () => {
  const ui = src("app/(admin)/console-ui.tsx");
  assert.match(ui, /export function QueueButton/);
  assert.match(ui, /export function QueueForm/);
  assert.match(ui, /form=\{QUEUE_FORM_ID\}/, "the button is phrasing content that names the page's one form — a form inside a sentence broke hydration");
  assert.doesNotMatch(ui, /<form[^>]*className=\{`queue-add/, "no per-gap form");
  assert.match(src("app/api/admin/decision/route.ts"), /parseFixField\(/);
  assert.deepEqual(parseFixField("Cost — not measured yet"), { where: "Cost", says: "not measured yet", subjectId: fixSubjectId("Cost", "not measured yet"), consequenceShown: "Cost — not measured yet" });
  assert.equal(parseFixField("   "), null);
  for (const rel of ["app/(admin)/admin/page.tsx", "app/(admin)/admin/research/page.tsx", "app/(admin)/readiness/[state]/page.tsx"]) {
    assert.match(src(rel), /<QueueForm returnTo=/, `${rel} renders the one queue form`);
  }
  assert.match(ui, /where && <QueueButton where=\{where\} says=\{gap\.says\}/, "GapNote carries the button whenever the page says where it is");
  const page = surface("home");
  assert.match(page, /<FixQueueSection /);
  assert.match(page, /value=\{GO_FIX_OPTION\}/);
  assert.match(page, /value=\{FIX_QUEUE_SUBJECT\}/);
  for (const rel of ["app/(admin)/admin/page.tsx", "app/(admin)/admin/research/page.tsx"]) {
    const s = src(rel);
    const gaps = (s.match(/<GapNote /g) ?? []).length;
    const located = (s.match(/<GapNote [^>]*where=/g) ?? []).length;
    assert.equal(located, gaps, `${rel}: every GapNote names where it is (${located} of ${gaps})`);
  }
});

/* ================================================================== *
 * ADM-19 — no "our"
 * ================================================================== */

test("ADM-19: a gap of ours reads 'not measured', never OUR GAP, on every console surface", () => {
  const ui = src("app/(admin)/console-ui.tsx");
  assert.match(ui, /if \(gap\.whose === "OURS"\) return "not measured";/);
  assert.match(ui, /if \(gap\.whose === "THEIRS"\) return "not published";/);
  for (const rel of ["app/(admin)/admin/page.tsx", "app/(admin)/admin/research/page.tsx", "app/(admin)/readiness/[state]/readiness-panel.tsx", "app/(admin)/console-ui.tsx"]) {
    assert.doesNotMatch(src(rel), /our gap|OUR GAP|function whoseLabel/i, `${rel} carries no 'our gap' wording and no second gap labeller`);
  }
});

/* ================================================================== *
 * ADM-10 — each role leads with what it is doing and whether anything needs the owner
 * ================================================================== */

const metric = (value: number, denominator: number, unit: "attempts" | "tasks" | "artifacts") => ({ label: "", value, denominator, contract: "", source: "", observedAt: "2026-09-05T03:00:00.000Z", unit });
const attempt = (over: Record<string, unknown>) =>
  ({
    attemptId: "at-1",
    routeTaskId: "rt",
    workItemId: "wi-1",
    worker: { role: "ADVERSARIAL_AUDITOR", provider: "anthropic", version: "claude-opus-5", instance: "i" },
    outcome: "COMPLETED",
    startedAt: "2026-09-04T08:02:44.866Z",
    endedAt: "2026-09-04T08:03:16.165Z",
    duration: null,
    cost: null,
    artifacts: metric(8, 8, "artifacts"),
    resultStatus: "MATCHED",
    resultId: "r",
    verdict: "INCONCLUSIVE",
    executionMode: "MODEL_ASSISTED",
    resultDetail: "",
    findings: [{ code: "AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE", detail: "x", severity: "WARN" }],
    workItemState: "BLOCKED",
    reopenedByResult: false,
    ...over,
  }) as unknown as WorkerRoleView["attempts"][number];

test("ADM-10: a role lead says what is happening, says plainly when nothing needs the owner, and names the work item when something does", () => {
  const auditors: WorkerRoleView = { role: "ADVERSARIAL_AUDITOR", shown: metric(5, 6, "attempts"), pending: metric(0, 5, "tasks"), due: metric(0, 0, "tasks"), attempts: [attempt({}), attempt({ attemptId: "at-2", workItemId: "wi-1" })] } as WorkerRoleView;
  const lead = roleLead(auditors);
  assert.equal(lead.title, "Auditors");
  assert.equal(lead.needsYou, null);
  assert.match(lead.doing, /None working right now; 0 tasks waiting of 5 registered, 0 due now; 6 attempts on record\./);
  assert.match(lead.doing, /Of the 2 newest: 2 completed, all on the same work item\./);
  assert.match(lead.doing, /2 inconclusive \(the audit could not settle it either way, so nothing was certified\)/);
  assert.deepEqual(lead.glossary.map((g) => g.code), ["AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE", "INCONCLUSIVE"]);
  const parsers: WorkerRoleView = { role: "PARSER", shown: metric(1, 20, "attempts"), pending: metric(2, 12, "tasks"), due: metric(2, 2, "tasks"), attempts: [attempt({ outcome: "ABORTED", verdict: null, resultStatus: "NOT_RECORDED", findings: [], workItemState: "AWAITING_OWNER", worker: { role: "PARSER", provider: "we-the-people", version: "civic-record-workers/2.0.0", instance: "i" } })] } as WorkerRoleView;
  const p = roleLead(parsers);
  assert.equal(p.title, "Parsers");
  assert.match(p.needsYou ?? "", /^Yes — work item wi-1 is waiting on you/);
  assert.match(p.doing, /1 aborted/);
  assert.match(p.doing, /recorded no typed result/);
  const empty = roleLead({ role: "ENGINEERING", shown: metric(0, 0, "attempts"), pending: metric(0, 0, "tasks"), due: metric(0, 0, "tasks"), attempts: [] } as WorkerRoleView);
  assert.match(empty.doing, /^No engineers have run yet; nothing is queued for them\./);
  assert.equal(verdictPlain(null), "no typed result was recorded");
  assert.equal(findingPlain("PERMISSION_DENIED"), "the source's permission rules refused the route");
  assert.equal(findingPlain("SOMETHING_NEW"), "something new");
  assert.equal(workItemStatePlain("AUTHOR_DECISION_REQUIRED"), "needs your decision");
  const panel = src("app/(admin)/admin/research/worker-fleet-panel.tsx");
  assert.match(panel, /roleLead\(role\)/);
  assert.match(panel, /Needs you\?/);
  assert.match(panel, /Nothing in any role needs a decision from you right now\./);
});

/* ================================================================== *
 * ADM-11 — every measure has a meaning, and a picture
 * ================================================================== */

const METRICS: ResearchMetrics = {
  computedAt: "2026-09-04T16:57:00.000Z",
  capacity: { meanUsdPerAttempt: 0.3867, measuredAttempts: 1, unmeasuredAttempts: 3, windowHours: 24, ceilingUsd: 25, attemptsPerDayAtCap: 64, denominator: "d" },
  ordering: { rule: "r", scope: "s", inputs: { readerImpactAt: "FreshnessObligation.readerImpactAt", pilotJurisdictions: "p", openRedQuestions: { count: 0, zips: [], run: null }, universeProviders: [], tieBreak: "oldest nextDueAt first within a band" }, bands: { 1: 182, 2: 2151, 3: 0 }, appliesTo: "BOUNDED_MODEL_WORKER" },
  funnel: { stages: [{ stage: "SCOUTED", count: 22, source: "s" }, { stage: "CONFIRMED", count: 0, source: "s" }, { stage: "VALIDATED", count: 18, source: "s" }], pipelineSource: "p" },
  share: { thisCycle: { deterministic: 1, model: 0, modelShare: 0 }, window: { deterministic: 211, model: 21, modelShare: 21 / 232, cycles: 18, since: "2026-09-01T00:00:00.000Z" }, delta: -0.091 },
  cacheByRole: [{ role: "SCOUT", cacheRead: 955734, cacheWrite: 100, uncachedInput: 4540417, hitRate: 0.174, repeatedPrefixTurns: 4, repeatedPrefixMisses: 0, attempts: 27, denominator: "d" }],
  costPerOutcome: [{ outcome: "ROUTE_CANDIDATE", count: 12, usdPerOutcome: 2.2914, denominator: "d" }],
  cacheDefects: { defective: 0, instrumented: 4 },
};

test("ADM-11: every research metric row carries a plain meaning, every group has one, and the page draws the funnel, the share and the cache", () => {
  const rows = researchDigestRows(METRICS);
  for (const group of Object.keys(rows) as (keyof typeof rows)[]) {
    assert.ok(METRIC_GROUP_MEANING[group].length > 40, `${group} has a group meaning`);
    for (const row of rows[group]) assert.ok(row.meaning.length > 30, `${group} · ${row.label} has a meaning`);
  }
  assert.match(rows.share[1].meaning, /over the last 18 cycle\(s\)/);
  assert.match(rows.capacity[0].meaning, /\$25 daily ceiling/);
  const page = src("app/(admin)/admin/research/page.tsx");
  assert.match(page, /<Funnel/);
  assert.match(page, /<StackedBar/);
  assert.match(page, /<Ring/);
  assert.match(page, /METRIC_GROUP_MEANING\./);
  assert.match(page, /\{row\.meaning\}/);
  const charts = src("app/(admin)/charts.tsx");
  assert.doesNotMatch(charts, /"use client"/, "charts are server-rendered from audited numbers; no client JavaScript");
});

/* ================================================================== *
 * ADM-13 — the nightly window in one line
 * ================================================================== */

test("ADM-13: the window reads as one sentence, a stage strip and a split; definitions stay behind a disclosure", () => {
  const m = (v: number, d: number) => measured(v, d, "c", "s");
  const view: WindowView = {
    nowIso: "2026-09-05T03:00:00.000Z",
    verdict: "COMPLETED",
    reasons: [],
    time: held({ windowId: "nw-1", localDate: "2026-09-04", zone: "America/New_York", scheduledFor: "2026-09-04T08:00:00.000Z", startedAt: "2026-09-04T08:04:50.476Z", finishedAt: "2026-09-04T08:15:00.553Z", trigger: "RUNNER_CLOCK", mode: "SHADOW", host: "SeanLenovo", testedSha: "a6f7fd4d", caughtUp: [] }),
    gate: held({ reason: "SHADOW — READER NOT_READY, TRUTH NOT_READY, FRESHNESS NOT_READY; promotion OFF", openRecordClasses: [], readFrom: null }),
    stages: held([
      { stage: "LEGACY_REFRESH", outcome: "COMPLETED", startedAt: "", finishedAt: "", reason: null },
      { stage: "PIPELINE_EVALUATION", outcome: "COMPLETED", startedAt: "", finishedAt: "", reason: null },
      { stage: "POST_PROMOTION_VERIFICATION", outcome: "COMPLETED", startedAt: "", finishedAt: "", reason: null },
      { stage: "DIGEST", outcome: "COMPLETED", startedAt: "", finishedAt: "", reason: null },
    ] as never),
    promoted: held(m(0, 43)),
    wouldPromote: held(m(0, 43)),
    refused: held(m(43, 43)),
    deferred: held(m(0, 43)),
    byRecordClass: held([{ recordClass: "OFFICIAL_MEETING_DOCUMENT_INVENTORY", promoteWould: m(0, 3), refuseWould: m(3, 3), deferred: m(0, 3) }]),
    verdicts: held({ shown: m(0, 0), rows: [] }),
    legacy: held({ source: "JSON", ran: m(3, 5), rows: [] }),
    controls: { held: false, gap: { whose: "OURS", says: "no controls" } },
    verification: held({ instrument: "scripts/staging-observer.mts", verdict: "HELD", detail: "" }),
    incidents: held({ shown: m(0, 0), rows: [] }),
    proof: held({ windowId: "nw-1", recordPath: null, digestPath: null, leaseId: "ls-1", windowsRecorded: 3 }),
  };
  const plain = plainWindow(view);
  assert.equal(
    plain.headline,
    "The window for September 4 ran on time at September 4, 4:04 AM ET in shadow mode (nothing reaches readers yet); all 4 stages completed; nothing was promoted because the gate is closed (reader, truth and freshness are not yet independently proven) — of 43 items, 43 refused; no incidents.",
  );
  assert.deepEqual(plain.stages.map((s) => [s.label, s.ok]), [["Refresh", true], ["Evaluate", true], ["Verify", true], ["Digest", true]]);
  assert.deepEqual(plain.split, { items: 43, promoted: 0, wouldPromote: 0, refused: 43, deferred: 0 });
  assert.equal(plain.classes[0].label, "official meeting document inventory");
  assert.equal(recordClassLabel("campaign-finance"), "campaign finance");
  const never = plainWindow({ ...view, verdict: "NEVER_RUN", time: { held: false, gap: { whose: "OURS", says: "never" } } });
  assert.match(never.headline, /never run/);
  const page = src("app/(admin)/admin/research/page.tsx");
  assert.match(page, /\{windowPlain\.headline\}/);
  assert.match(page, /className="stage-strip"/);
  assert.match(page, /Window detail — definitions, the gate, the legacy refresh, controls, proof<\/summary>/);
});

/* ================================================================== *
 * ADM-17 — free by design is not a gap; time, requests and bytes are measured
 * ================================================================== */

test("ADM-17: a role whose attempts all ran without a paid model is $0 by design with its non-dollar measures; a model role with no dollars is unmeasured", () => {
  const entry = (attemptId: string, role: string, usd: number | null, extra: Partial<{ durationMs: number; bytesFetched: number; requestCount: number }> = {}) => ({
    attemptId, workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "f", role: role as never,
    cost: { inputTokens: null, outputTokens: null, usd, durationMs: extra.durationMs ?? null, bytesFetched: extra.bytesFetched ?? null, requestCount: extra.requestCount ?? null, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt: "2026-09-05T02:00:00.000Z",
  });
  const panel = buildCostPanel({
    costs: [
      entry("s1", "SCOUT", 0.5),
      entry("s2", "SCOUT", null),
      entry("a1", "ACQUIRER", null, { durationMs: 4000, bytesFetched: 2_097_152, requestCount: 3 }),
      entry("a2", "ACQUIRER", null, { durationMs: 2000, bytesFetched: 1024, requestCount: 1 }),
      entry("d1", "DETECTIVE", null),
    ],
    attempts: [
      { id: "s1", worker: { version: "claude-opus-5", provider: "anthropic" } },
      { id: "s2", worker: { version: "claude-opus-5", provider: "anthropic" } },
      { id: "a1", worker: { version: "deterministic-walker", provider: "we-the-people" } },
      { id: "a2", worker: { version: "deterministic-walker", provider: "we-the-people" } },
      { id: "d1", worker: { version: "claude-opus-5", provider: "anthropic" } },
    ],
    cacheByRole: null,
    share: null,
    verifiedRecords: null,
  });
  const acq = panel.costByRole.find((r) => r.key === "ACQUIRER")!;
  assert.equal(acq.kind, "FREE_BY_DESIGN");
  assert.ok(acq.usd.held && acq.usd.value.value === 0);
  assert.deepEqual(acq.nonDollar, { requests: 4, bytes: 2_098_176, durationMs: 6000, entries: 2 });
  assert.match(acq.meaning ?? "", /\$0 by design — 2 attempts ran deterministic code/);
  const det = panel.costByRole.find((r) => r.key === "DETECTIVE")!;
  assert.equal(det.kind, "UNMEASURED");
  assert.ok(!det.usd.held && /^1 model attempt of 1 reported no dollar cost\.$/.test(det.usd.gap.says), "the label says 'not measured'; the sentence does not repeat it");
  // A snapshot published before the kind existed is read by its own sentence.
  assert.equal(costRowKind({ usd: { held: false, gap: { whose: "OURS", says: "not measured — 1322 attempts, none reported a dollar cost (this work runs without a paid model)." } } }), "FREE_BY_DESIGN");
  assert.equal(costRowKind({ usd: { held: false, gap: { whose: "OURS", says: "3 model attempts of 3 reported no dollar cost." } } }), "UNMEASURED");
  assert.equal(costRowKind({ usd: held(measured(1, 2, "c", "s")) }), "MEASURED");
  assert.equal(costRowKind({ kind: "UNMEASURED", usd: held(measured(1, 2, "c", "s")) }), "UNMEASURED", "a published kind wins");
  const scout = panel.costByRole.find((r) => r.key === "SCOUT")!;
  assert.equal(scout.kind, "MEASURED");
  assert.match(scout.meaning ?? "", /1 of 2 attempts reported a dollar cost; 1 reported none/);
  const page = surface("home");
  // POS-12: the two charts the owner said he likes are still drawn.
  assert.match(page, /Spend by role — measured dollars/);
  assert.match(page, /Spend by day — last 14 days/);
  /*
   * ADM-33 (9.6.26) struck the blanket "$0 by design" claim: the owner did not
   * believe the Detective was free, and he was right to ask — absence of a cost
   * record was being read as proof that a role never spends. The section now
   * classifies each row from the EXECUTION POLICY, so "Plain code" is a reading
   * of the code that runs the role and "$0 this run" is a reading of the ledger,
   * and the two are never the same sentence. This guard now pins that split.
   */
  assert.doesNotMatch(page, /free by design/i, "the blanket claim is gone");
  assert.match(page, /costClassOf|cost-class/, "each row carries its own cost class");
  assert.match(src("scripts/publish-owner-snapshot.mts"), /spendByDay: spendByDay\(reads\)/);
});

/* ================================================================== *
 * ADM-18 — the reader suite says what it is, or one line
 * ================================================================== */

test("ADM-18: the reader-suite section leads with what it measures and collapses to one line when there is no grid", () => {
  const page = surface("home");
  assert.match(page, /The reader check asks the live site the questions a resident would ask/);
  assert.match(page, /<GapNote gap=\{snapshot\.zipRows\.gap\}/, "no grid renders as a NAMED gap with its queue button, never as an empty table");
  assert.doesNotMatch(page, /"no grid"/);
});

/* ================================================================== *
 * ADM-23 — population on file
 * ================================================================== */

test("ADM-23: the ACS tables are on file with their pinned counts, the pilot ZIPs and states resolve, and the adapter refuses a non-count", () => {
  assert.equal(REFERENCE_ROW_COUNTS[ACS_ZCTA_DATASET], 33_772);
  assert.equal(REFERENCE_ROW_COUNTS[ACS_STATE_DATASET], 52);
  assert.equal(readTable(ACS_ZCTA_DATASET).count, 33_772);
  /*
   * ADM-41 (9.6.26): re-acquired at the ACS 5-Year 2024 release, the newest the
   * API serves — `/data/2025/acs/acs5` answers 404, measured 2026-09-06. Every
   * value below was verified by an independent live call before the tables were
   * committed. The 2023 figures they replace were 5,169 / 1,957 / 22,632 /
   * 31,665 and 7,268,175 / 1,387,834 / 9,267,014.
   */
  assert.equal(zipPopulation("85701"), 5498);
  assert.equal(zipPopulation("03255"), 2015);
  assert.equal(zipPopulation("07866"), 22663);
  assert.equal(zipPopulation("85641"), 34752);
  assert.equal(zipPopulation("00000"), null, "a ZIP with no tabulation area is null, never zero");
  assert.equal(statePopulation("az"), 7_378_838);
  assert.equal(statePopulation("nh"), 1_394_868);
  assert.equal(statePopulation("nj"), 9_343_809);
  assert.equal(statePopulation("zz"), null);
  const fetched: AcsFetch = { scope: "zcta", url: "u", status: 200, fetchedAt: "t", rows: [["NAME", "B01003_001E", "B01003_001M", "zip code tabulation area"], ["ZCTA5 85701", "5498", "734", "85701"], ["ZCTA5 00601", "16721", "-555555555", "00601"]] };
  assert.deepEqual(normalize(fetched).map((r) => r.code), ["00601", "85701"]);
  /*
   * The Bureau answers a margin it cannot compute with a NEGATIVE jam value
   * (`-555555555` — "the estimate is controlled; a statistical test is not
   * appropriate"). That is "no margin stated" and is written as an EMPTY cell,
   * never as a margin of zero, which would claim the estimate is exact.
   */
  assert.equal(toCsv(normalize(fetched), "zcta"), "zcta,name,population,margin_of_error\n00601,ZCTA5 00601,16721,\n85701,ZCTA5 85701,5498,734\n");
  assert.throws(() => normalize({ ...fetched, rows: [fetched.rows[0], ["ZCTA5 1", "-1", "0", "00001"]] }), /not a count/);
  assert.throws(() => normalize({ ...fetched, rows: [fetched.rows[0], ["ZCTA5 1", null, "0", "00001"]] }), /not a count/);
  assert.ok(existsSync(join(ROOT, "data", "reference", `${ACS_ZCTA_DATASET}.md`)));
});

test("ADM-23: population-weighted completeness is a measured share of the state's ACS total, and its gaps are named", () => {
  // ADM-41: the state total is the 2024 release's, in the same run as the ZIPs.
  const a = { code: "az", name: "Arizona", statePopulation: 7_378_838 } as StateAuthorities;
  const zip = (zip: string, population: number | null, states: string[]) => ({
    zip,
    place: held(zip),
    population: population === null ? { held: false as const, gap: { whose: "OURS" as const, says: "no ZCTA" } } : held(measured(population, 7_378_838, "c", "s")),
    populationBasis: population === null ? ("NO_TABULATION_AREA" as const) : ("COUNTED" as const),
    populationMargin: null,
    bodies: states.map((state) => ({ state: state as never, gap: "g" })),
    tierLabel: null,
  });
  const complete = populationInCompleteZip(a, [zip("85701", 5498, ["CURRENT", "ARGUED_ABSENT"]), zip("85641", 34752, ["CURRENT", "BLOCKED"]), zip("85700", null, ["CURRENT"])]);
  assert.ok(complete.held);
  assert.equal(complete.value.value, 5498);
  assert.equal(complete.value.denominator, 7_378_838);
  assert.match(complete.value.contract, /1 of 2 researched ZIP\(s\) with a population on file/);
  const none = populationInCompleteZip(a, [zip("85641", 34752, ["BLOCKED"])]);
  assert.ok(none.held && none.value.value === 0, "a measured zero: nothing is complete yet, and that is a fact");
  assert.ok(!populationInCompleteZip({ ...a, statePopulation: null }, [zip("85701", 5498, ["CURRENT"])]).held);
  assert.ok(!populationInCompleteZip(a, []).held);
  assert.ok(!populationInCompleteZip(a, [zip("85700", null, ["CURRENT"])]).held);
  const refresh = src("scripts/readiness-refresh.mts");
  assert.match(refresh, /population: population\.population/);
  assert.match(refresh, /statePopulation: statePopulation\(spec\.code\)/);
  assert.doesNotMatch(src("lib/control-plane/readiness/extract.ts"), /not yet ingested/);
  assert.match(refresh, /no Census tabulation area/, "the publisher names the gap a PO-box ZIP is");
  const panel = src("app/(admin)/readiness/[state]/readiness-panel.tsx");
  assert.match(panel, /\{z\.population\.gap\.says\}/, "the panel renders the published gap sentence, never a hardcoded one");
  assert.doesNotMatch(panel, /"population not on file"/);
});

/* ================================================================== *
 * ADM-15 — the next step per ZIP
 * ================================================================== */

test("ADM-15: every readiness ZIP row carries a next step and a Deploy-fleet-here intent that returns to the state's page", () => {
  const panel = src("app/(admin)/readiness/[state]/readiness-panel.tsx");
  assert.match(panel, /function NextStep\(/);
  assert.match(panel, /<th>Next step<\/th>/);
  assert.match(panel, /Go get this one thing:/);
  assert.match(panel, /Deploy fleet here/);
  /*
   * §9A.16 (9.6.26): the row's button is the SAME control as the console
   * home's, so it explains itself before acting and sends through the one typed
   * gateway. It still carries the row's own target and still comes back here.
   */
  assert.match(panel, /<DeployFleet returnTo=\{`\/readiness\/\$\{stateCode\}`\}/);
  assert.match(panel, /prefill=\{target\}/, "the row already knows which ZIP and which gap, so he does not retype it");
  assert.match(src("app/(admin)/admin/deploy-fleet.tsx"), /type: "fleet\.deployHere"/);
  assert.match(panel, /Nothing to do — every governing body a resident belongs to is resolved\./);
  assert.match(panel, /GATED_ON_OPERATOR/);
});

/* ================================================================== *
 * ADM-21 — Lumen Edge on the admin only, with the reader legend's colours
 * ================================================================== */

test("ADM-21: the admin stylesheet carries the four Lumen signals, the reader legend's level colours in both themes, and no font import", () => {
  const layout = src("app/(admin)/layout.tsx");
  assert.match(layout, /--ce-surface-panel-gradient: radial-gradient\(ellipse at bottom, rgba\(47,52,65,\.6\) 0%, rgba\(20,22,30,1\) 65%\)/, "signal 1: the bottom-lit surface");
  assert.match(layout, /--ce-rim: inset 0 0 0 1px var\(--ce-alpha-hairline\)/, "signal 2: an inset hairline, never a border");
  assert.match(layout, /\.admin \.card::after \{[^}]*left: 15%; width: 70%; height: 1px;/, "signal 3: the horizon line");
  assert.match(layout, /cubic-bezier\(\.15,\.83,\.66,1\)/, "signal 4: the motion curve");
  assert.match(layout, /--ce-shadow-card: 0 1px 1px rgba\(0,0,0,\.4\), 0 12px 32px -12px rgba\(0,0,0,\.6\)/);
  assert.match(layout, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(layout, /fonts\.googleapis|Space Grotesk|JetBrains Mono|"Inter"|@import/, "fonts stay ours");
  assert.doesNotMatch(layout, /\.card \{[^}]*border: 1px solid/, "no solid card borders remain");
  // The level colours are the reader map legend's own, dark and light, verbatim.
  const globals = src("app/globals.css");
  const token = (name: string, from: number) => new RegExp(`--accent-${name}: (#[0-9a-f]{6})`).exec(globals.slice(from))?.[1];
  const light = globals.indexOf('[data-theme="light"]');
  assert.ok(light > 0);
  for (const [level, accent] of [["local", "local"], ["state", "state"], ["school", "school"], ["federal", "national"]] as const) {
    const dark = token(accent, 0);
    const lit = token(accent, light);
    assert.ok(dark && lit, `globals carries --accent-${accent} in both themes`);
    assert.match(layout, new RegExp(`--lvl-${level}: ${dark};`), `dark ${level} matches the reader legend`);
    assert.match(layout, new RegExp(`--lvl-${level}: ${lit};`), `light ${level} matches the reader legend`);
  }
  assert.match(layout, /\.admin \.card\.lvl-state::after \{ background: linear-gradient\(90deg, transparent 0%, var\(--lvl-state\) 50%, transparent 100%\)/, "the horizon carries the hue");
  // Scope: the consumer app is untouched.
  assert.doesNotMatch(globals, /--ce-surface|lumen|Lumen/);
  assert.equal(existsSync(join(ROOT, "DESIGN.md")), false, "no DESIGN.md at the repo root");
  assert.equal(existsSync(join(ROOT, "css", "system.css")), false);
  assert.match(src("app/(admin)/console-ui.tsx"), /export function LevelLegend/);
});

/* ================================================================== *
 * ADM-14 — one round trip per view
 * ================================================================== */

test("ADM-14: the research page issues its reads in one round and the header still acknowledges the choice at once", () => {
  const page = src("app/(admin)/admin/research/page.tsx");
  const all = /await Promise\.all\(\[([\s\S]*?)\]\);/.exec(page);
  assert.ok(all, "one Promise.all");
  for (const read of ["readHeartbeat(", "readResearchState(", "readResearchIntents(", "readScoutResults(", "readScoutSpend(", "readScoutEvidenceCount(", "readWorkerFleet(", "readLastWindow(", "readSnapshot("]) {
    assert.ok(all![1].includes(read), `${read} is in the single round`);
  }
  assert.doesNotMatch(page, /const fleet = await readWorkerFleet/);
  assert.doesNotMatch(page, /const lastWindow = await readLastWindow/);
  const nav = src("app/(admin)/console-nav.tsx");
  assert.match(nav, /useTransition\(/);
  assert.match(nav, /console-nav-pending/);
});

/* ================================================================== *
 * The owner's second folder of the day
 * ================================================================== */

test("the sweep gate accepts a second same-day owner folder (9.4.26.2) and still refuses a non-date", () => {
  assert.equal(OWNER_FOLDER.test("9.4.26"), true);
  assert.equal(OWNER_FOLDER.test("9.4.26.2"), true);
  assert.equal(OWNER_FOLDER.test("2026-09-04"), false);
  assert.equal(OWNER_FOLDER.test("9.4.26.2.1"), false);
  const record = JSON.parse(src("data/feedback/sweeps/9.4.26.2.json")) as SweepRecord;
  assert.equal(record.folder, "9.4.26.2");
  assert.deepEqual(validateSweep(record), []);
  assert.equal(record.items.length, 18, "fourteen issues and four positives, each disposed");
  assert.match(src("scripts/feedback-sweep.mts"), /OWNER_FOLDER\.test\(e\.name\)/);
});
