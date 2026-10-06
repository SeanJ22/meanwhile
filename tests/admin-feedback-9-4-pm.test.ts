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
import { join, relative, sep } from "node:path";
import test from "node:test";

import { codeOf, sourceFilesUnder } from "./read-code.ts";
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
import { METRIC_GROUP_MEANING, researchDigestRows } from "../lib/control-plane/research-digest.ts";
import type { ResearchMetrics } from "../lib/control-plane/research-metrics.ts";
import type { WindowView } from "../lib/control-plane/window-view.ts";
import type { WorkerRoleView } from "../lib/control-plane/workers/readback.ts";
import { ACS_STATE_DATASET, ACS_ZCTA_DATASET, refreshPopulationFromPromoted, statePopulation, zipPopulation } from "../lib/reference/acs-population.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
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
  planOwnerDecisions,
  writeStore,
} from "../scripts/tracker-core.mjs";

const ROOT = process.cwd();
await refreshPopulationFromPromoted({ store: new MemoryRoutineDataStore() });
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/* ================================================================== *
 * ADM-22 — every stamp is Eastern, spelled out
 * ================================================================== */

test("ADM-22: an ISO stamp reads as Eastern time spelled out, with the year only when asked; a missing or unreadable stamp says so", () => {
  assert.equal(formatEastern("2026-09-05T02:20:57.808Z"), "September 4, 10:20 PM EDT", "02:20Z is the evening before in New York");
  assert.equal(formatEastern("2026-01-05T15:20:57.808Z", { year: true }), "January 5, 2026, 10:20 AM EST", "EST in January");
  assert.equal(formatEasternDate("2026-09-05T02:20:57.808Z"), "September 4");
  assert.equal(formatEasternSpan("2026-09-04T08:04:50.476Z", "2026-09-04T08:15:00.553Z"), "September 4, 4:04 AM EDT – 4:15 AM EDT");
  assert.equal(formatCalendarDate("2026-08-11"), "August 11, 2026", "a bare tracker date is the day it names, never shifted through UTC");
  assert.equal(formatEastern(null), NO_STAMP);
  assert.equal(formatEastern("garbage"), BAD_STAMP);
  assert.equal(
    easternize("parent relaunch proven 2026-09-02T15:36:25.8796479Z: pid 20240; trigger present at 2026-09-05T06:17:17.081Z"),
    "parent relaunch proven September 2, 2026, 11:36 AM EDT: pid 20240; trigger present at September 5, 2026, 2:17 AM EDT",
    "an instrument's own sentence keeps its words and loses its machine stamps",
  );
});

test("ADM-22: no console page prints a raw ISO stamp where the owner reads; every one is spelled out in Eastern time", () => {
  const offenders: string[] = [];
  /*
   * Every other console file, swept rather than listed — the pages kept under
   * the new header (the fleet operations map and its panels, feedback, sources)
   * are console pages too. A stamp field printed as a child, or interpolated
   * into a sentence, reaches the owner as ISO; an attribute (`iso=`, `key=`,
   * `dateTime=`) does not. Found on 2026-09-23: thirteen such prints on the
   * fleet operations and feedback pages.
   */
  const NOT_A_STAMP = new Set([
    "row.adapter.at", // the sources page's adapter module path: a place, not a time
    "e.at", // the sources page's evidence location: a place, not a time
    "answer.readBackAt", // the page a chat answer can be read back on: a path, not a time
    "receipt.readBackAt", // the page an action's result can be read back on: a path, not a time
    "readAt", // the audit footer's prop, spelled out at every call site (asserted above)
  ]);
  const consoleFiles = [...sourceFilesUnder([".tsx"], "app", "(admin)")];
  for (const abs of consoleFiles) {
    const rel = relative(ROOT, abs).split(sep).join("/");
    const shown = codeOf(rel).replace(/\b(?:key|id|href)=\{`[^`]*`\}/g, "");
    for (const m of shown.matchAll(/\$\{\s*([\w.?]+(?:At|\.at|Iso))\s*\}/g)) {
      if (!NOT_A_STAMP.has(m[1])) offenders.push(`${rel}: \${${m[1]}} is interpolated into owner text as a raw ISO stamp`);
    }
    // A child, not a destructuring pattern (`{ observedAt }: Props`) or an attribute.
    for (const m of shown.matchAll(/(?<![=\w$])\{\s*([\w.?]+(?:At|\.at|Iso))\s*\}(?!\s*[:=)])/g)) {
      if (!NOT_A_STAMP.has(m[1])) offenders.push(`${rel}: {${m[1]}} is printed as a raw ISO stamp`);
    }
  }
  assert.ok(consoleFiles.length > 30, `the sweep read the console (${consoleFiles.length} files)`);
  assert.deepEqual([...new Set(offenders)], [], "raw ISO stamps reach the owner's face");
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
  assert.match(publisher, /canonical candidate-profile projection/);
  assert.doesNotMatch(publisher, /candidate-cards-2026\.json/, "the operational snapshot must not republish tracked civic data");
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

test("ADM-16: the page renders the split and receipt, while tracked tracker synchronization stays outside the immutable runtime", () => {
  const now = codeOf("app/(admin)/admin/page.tsx");
  // S11 (Sean, 2026-09-30): the old tracker's decision cards are off the home screen, so the page no longer splits, counts or lists them.
  assert.doesNotMatch(now, /splitDecided\(|readDecisionCards\(|readDecisions\(|NextSteps|receiptHeadline\(/, "the home screen does not draw the old tracker decisions");
  assert.equal(consoleReturnPath("/admin", "/admin"), "/admin");
  assert.equal(consoleReturnPath("/readiness/az", "/admin"), "/admin", "a retired page is not a destination any more");
  assert.equal(consoleReturnPath("https://evil.example/", "/admin"), "/admin");
  assert.equal(consoleReturnPath("/readiness/AZ", "/admin"), "/admin", "the closed list is exact");
  assert.equal(isConsolePath("/admin/sources"), false, "the Sources page is deleted: publication status is on Workers");
  assert.match(src("app/api/admin/research/route.ts"), /consoleReturnPath\(/);
  const canon = src("scripts/canonicalize-owner-decisions.mts");
  assert.match(canon, /openedWork: resolution\.openedWork/, "the twin carries the work opened");
  assert.match(canon, /subjectTitle: resolution\.subjectTitle/);
  assert.match(canon, /"Opened by"\] \?\? ""\)\.trim\(\) === DASHBOARD_OPENER/, "work opened is found by the dashboard opener, never guessed");
  const runner = src("scripts/pilot-runner.mts");
  assert.doesNotMatch(runner, /scripts\/apply-owner-decisions\.mts/, "a tracked engineering writer cannot dirty the clean detached production runtime");
  assert.match(src("scripts/tracker.mjs"), /const book = ONLY_DASHBOARD \? null : readWorkbookRows\(\);/, "the unattended sync never imports the workbook");
  assert.doesNotMatch(src("package.json"), /"decisions:sync":/);
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


test("ADM-20: every gap on the console carries the queue button, and the page has the queue with Go fix these", () => {
  assert.deepEqual(parseFixField("Cost — not measured yet"), { where: "Cost", says: "not measured yet", subjectId: fixSubjectId("Cost", "not measured yet"), consequenceShown: "Cost — not measured yet" });
  assert.equal(parseFixField("   "), null);
  assert.match(src("lib/control-plane/gateway/registry.ts"), /const parsed = parseFixField\(combined\);/, "and the gateway's queue.add reads it back with parseFixField");
});

/* ================================================================== *
 * ADM-19 — no "our"
 * ================================================================== */

test("ADM-19: a gap of ours reads 'not measured', never OUR GAP, on every console surface", () => {
  // Admin redesign, 2026-09-23: the per-state readiness panel this named was removed; the sweep now covers every console file and the redesign's view models, so a new screen walks into the rule.
  const swept = [...sourceFilesUnder([".ts", ".tsx"], "app", "(admin)"), ...sourceFilesUnder([".ts"], "lib", "control-plane", "admin-view")];
  for (const abs of swept) {
    const rel = relative(ROOT, abs).split(sep).join("/");
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

/* ================================================================== *
 * ADM-11 — every measure has a meaning, and a picture
 * ================================================================== */

const METRICS: ResearchMetrics = {
  computedAt: "2026-09-04T16:57:00.000Z",
  capacity: { meanUsdPerAttempt: 0.3867, measuredAttempts: 1, unmeasuredAttempts: 3, windowHours: 24, ceilingUsd: 25, attemptsPerDayAtCap: 64, denominator: "d" },
  ordering: { rule: "r", scope: "s", inputs: { readerImpactAt: "FreshnessObligation.readerImpactAt", pilotJurisdictions: "p", universeProviders: [], tieBreak: "oldest nextDueAt first within a band" }, bands: { 1: 182, 2: 2151, 3: 0 }, appliesTo: "BOUNDED_MODEL_WORKER" },
  funnel: { stages: [{ stage: "SCOUTED", count: 22, source: "s" }, { stage: "CONFIRMED", count: 0, source: "s" }, { stage: "VALIDATED", count: 18, source: "s" }], pipelineSource: "p" },
  share: { thisCycle: { deterministic: 1, model: 0, modelShare: 0 }, window: { deterministic: 211, model: 21, modelShare: 21 / 232, cycles: 18, since: "2026-09-01T00:00:00.000Z" }, delta: -0.091 },
  cacheByRole: [{ role: "SCOUT", cacheRead: 955734, cacheWrite: 100, uncachedInput: 4540417, hitRate: 0.174, repeatedPrefixTurns: 4, repeatedPrefixMisses: 0, attempts: 27, denominator: "d" }],
  costPerOutcome: [{ outcome: "ROUTE_CANDIDATE", count: 12, usdPerOutcome: 2.2914, denominator: "d" }],
  cacheDefects: { defective: 0, instrumented: 4 },
};

/* ================================================================== *
 * ADM-13 — the nightly window in one line
 * ================================================================== */

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
  assert.match(src("scripts/publish-owner-snapshot.mts"), /spendByDay: spendByDay\(reads\)/);
});

/* ================================================================== *
 * ADM-18 — the reader suite says what it is, or one line
 * ================================================================== */

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


/* ================================================================== *
 * ADM-15 — the next step per ZIP
 * ================================================================== */

/* ================================================================== *
 * ADM-21 — Lumen Edge on the admin only, with the reader legend's colours
 * ================================================================== */

test("ADM-21: the admin stylesheet carries the four Lumen signals, the reader legend's level colours in both themes, and no font import", () => {
  const layout = src("app/(admin)/layout.tsx");
  // Signal 1: the bottom-lit surface. Under the approved ADMIN-PARITY language the
  // gradient is no longer a hardcoded rgba pair — it is lit from the SHARED
  // `--ce-panel` token (so the admin surface tracks the reader's panel) while
  // staying a bottom-anchored radial gradient that lifts toward the base. This
  // verifies that intended behavior, not the superseded literal.
  assert.match(layout, /--ce-surface-panel-gradient: radial-gradient\([^;]*at 50% 100%,[^;]*color-mix\(in srgb, var\(--ce-panel\) \d+%, white\)[^;]*var\(--ce-panel\)[^;]*\);/, "signal 1: the bottom-lit surface, lit from the shared --ce-panel token");
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
    // Under ADMIN-PARITY the level colours are not COPIED from the reader legend;
    // they REFERENCE its `--accent-*` token live, with the legend's own value kept
    // as the self-contained fallback (for an isolated render without globals.css).
    // So each still matches the reader legend — more faithfully than a copy.
    assert.match(layout, new RegExp(`--lvl-${level}: var\\(--accent-${accent}, ${dark}\\);`), `dark ${level} references the reader legend, legend value as fallback`);
    assert.match(layout, new RegExp(`--lvl-${level}: var\\(--accent-${accent}, ${lit}\\);`), `light ${level} references the reader legend, legend value as fallback`);
  }
  assert.match(layout, /\.admin \.card\.lvl-state::after \{ background: linear-gradient\(90deg, transparent 0%, var\(--lvl-state\) 50%, transparent 100%\)/, "the horizon carries the hue");
  // Scope: the admin's OWN recipe tokens never leak into the reader stylesheet.
  // (The Lumen MATERIAL itself now lives in globals.css by the approved Lumen ×
  // Meanwhile design — the reader wears it too — so this no longer asserts the
  // superseded "lumen is admin-only"; it asserts the still-true invariant that the
  // `--ce-*` control-centre recipe stays out of the consumer stylesheet.)
  assert.doesNotMatch(globals, /--ce-surface|--ce-void|--ce-graphite|--ce-panel-raised/);
  assert.equal(existsSync(join(ROOT, "DESIGN.md")), false, "no DESIGN.md at the repo root");
  assert.equal(existsSync(join(ROOT, "css", "system.css")), false);
});

/* ================================================================== *
 * ADM-14 — one round trip per view
 * ================================================================== */

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
