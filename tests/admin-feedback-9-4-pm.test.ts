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
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";

import { surfaceFiles, surfaceSource } from "./admin-surface.ts";
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
import { plainWindow, recordClassLabel } from "../lib/control-plane/plain-window.ts";
import { populationInCompleteZip, type StateAuthorities } from "../lib/control-plane/readiness/extract.ts";
import { METRIC_GROUP_MEANING, researchDigestRows } from "../lib/control-plane/research-digest.ts";
import type { ResearchMetrics } from "../lib/control-plane/research-metrics.ts";
import type { WindowView } from "../lib/control-plane/window-view.ts";
import { findingPlain, roleLead, verdictPlain, workItemStatePlain } from "../lib/control-plane/workers/plain-roles.ts";
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
  planFixQueue,
  planOwnerDecisions,
  writeStore,
} from "../scripts/tracker-core.mjs";

const ROOT = process.cwd();
await refreshPopulationFromPromoted({ store: new MemoryRoutineDataStore() });
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

test("ADM-22: no console page prints a raw ISO stamp where the owner reads; every one is spelled out in Eastern time", () => {
  const BARE = /[^=$]\{(snapshot\.publishedAt|heartbeat\.lastCycleStartedAt|d\.writtenAt|intent\.requestedAt|row\.recordedAt|attempt\.startedAt|base\.nowIso)\}/;
  // The research page kept its content: its stamps go through <When>.
  const research = surface("research");
  assert.match(research, /<When iso=/, "the research surface renders stamps through When");
  assert.doesNotMatch(research, BARE, "the research surface prints no bare ISO stamp");
  assert.ok((research.match(/<Said text=/g) ?? []).length >= 5, "the research surface quotes instrument sentences through Said");
  assert.match(src("app/(admin)/console-ui.tsx"), /dateTime=\{iso\} title=\{iso\}/, "the ISO string stays on the element for the machine and the hover");
  assert.match(src("app/(admin)/console-ui.tsx"), /<span className="gap-whose">\{gapLabel\(gap\)\}<\/span> \{easternize\(gap\.says\)\}/, "a published gap sentence is quoted with its stamps in Eastern time");
  // Admin redesign, 2026-09-23: the Fleet and Readiness areas spell their stamps out with formatEastern (the shell's strip keeps the ISO string on the element for the machine and the hover) instead of through <When>.
  assert.match(src("app/(admin)/_mw/shell.tsx"), /<time className=\{s\.stripVal\} dateTime=\{props\.observedAt\} title=\{props\.observedAt\}>\s*\{formatEastern\(props\.observedAt, \{ year: true \}\)\}/);
  const offenders: string[] = [];
  for (const which of ["home", "readiness"] as const) {
    const page = surface(which);
    assert.match(page, /formatEastern\(/, `the ${which} surface spells its stamps out in Eastern time`);
    if (BARE.test(page)) offenders.push(`${which}: a bare ISO field printed as a child`);
    for (const rel of surfaceFiles(ROOT, which)) {
      const code = codeOf(rel);
      // Every redesigned page ends with the audit footer, which prints when the page read what it shows.
      for (const footer of code.match(/<AuditFooter\b[^\n]*/g) ?? []) {
        if (!/readAt=\{formatEastern\(/.test(footer)) offenders.push(`${rel}: the audit footer's read time is not spelled out (${footer.trim()})`);
      }
      // An instrument's own sentence can carry machine stamps (a provider circuit names the instant it reopens); printed bare, they reach the face as ISO.
      if (/\{standing\.detail\}/.test(code)) offenders.push(`${rel}: the runner's own sentence is printed without Said, so its stamps stay ISO`);
      // The redesign builds its sentences in lib/control-plane/admin-view: a stamp interpolated there reaches the face the same way.
      // (A React key, an element id or a link target is never read by the owner, so those templates are set aside first.)
      const shown = code.replace(/\b(?:key|id|href)=\{`[^`]*`\}/g, "");
      for (const m of shown.matchAll(/\$\{\s*([\w.]+\.at)\s*(?:\}|\?\?)/g)) offenders.push(`${rel}: \${${m[1]}} is interpolated into owner text as a raw ISO stamp`);
    }
  }
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
  const consoleFiles = [...sourceFilesUnder([".tsx"], "app", "(admin)"), ...sourceFilesUnder([".tsx"], "components", "admin")];
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
  assert.ok(consoleFiles.length > 40, `the sweep read the console (${consoleFiles.length} files)`);
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

test("ADM-12: every console surface renders keys as display names", () => {
  const n = (surface("research").match(/<Name raw=/g) ?? []).length;
  assert.ok(n >= 3, `the research surface renders at least 3 keys through Name (found ${n})`);
  const ui = src("app/(admin)/console-ui.tsx");
  assert.match(ui, /title=\{d\.raw === d\.name \? undefined : d\.raw\}/, "the raw key is the hover title");
  // Admin redesign, 2026-09-23: the Fleet screens name a subject key with displayNameOf where they draw it (the costliest assignments on Money) instead of through <Name>.
  assert.match(codeOf("app/(admin)/_mw/screens/money.tsx"), /\{displayNameOf\(t\.subject \?\? t\.recordClass, \{ candidateNames: names \}\)\.name\}/, "a subject key reaches the face as its display name, with the candidate names the snapshot carries");
  assert.doesNotMatch(surface("home"), /\{t\.subject\}|\{row\.subject\}|\{c\.subject\}/, "no subject key is printed bare on a Fleet screen");
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
  assert.match(now, /splitDecided\(snapshot\.decisionCards, collapseDecisionLog\(decisionLog\)\)/, "the page splits the cards against the live decision log");
  assert.match(now, /const waiting = split \? split\.waiting : \[\];/, "a card with a recorded decision leaves the list");
  assert.match(now, /const steps = stepsFrom\(waiting\);/, "the count is the WAITING cards, not every card");
  // Admin redesign, 2026-09-23: the decided cards are listed again under the next steps, each with its three-leg receipt — the gateway's answer promises the card will say when the sync has acted.
  assert.match(now, /const decided = split \? split\.decided : \[\];/, "what was decided is listed from the same split");
  assert.match(now, /receiptHeadline\(entry\.steps\)/, "each decided card leads with how far its receipt has got");
  assert.match(now, /entry\.steps\.map\(/, "and shows every leg of the receipt");
  // Admin redesign, 2026-09-23: the old queue's client-side count that dropped before the network answered was removed; the card itself changes at once, and the server-drawn count drops on the refresh after the receipt.
  const steps = codeOf("app/(admin)/_mw/next-steps.tsx");
  const saving = steps.indexOf('set(card.rowId, { kind: "SAVING", what });');
  assert.ok(saving > 0 && saving < steps.indexOf("await fetch(props.liveRoute"), "ADM-32: the card shows it is recording before the network answers");
  // The card itself also says what was recorded, at once, before the page refreshes.
  assert.match(steps, /RECORDED VERBATIM/, "the receipt says what was recorded");
  assert.match(steps, /A PERSON APPLIES IT/, "and who carries it into the tracker");
  assert.match(now, /returnTo=\{base\.here\}/);
  assert.match(steps, /returnTo: props\.returnTo/);
  assert.doesNotMatch(surface("home"), /carried into the tracker at the next sync, where the row closes/, "the old one-sentence promise is gone");
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
  assert.doesNotMatch(runner, /scripts\/apply-owner-decisions\.mts/, "a tracked engineering writer cannot dirty the clean detached production runtime");
  const apply = src("scripts/apply-owner-decisions.mts");
  assert.match(apply, /engineering sync, deliberately outside the standing runtime/);
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
  assert.match(ui, /where && <QueueButton where=\{where\} says=\{gap\.says\}/, "GapNote carries the button whenever the page says where it is");
  /*
   * Admin redesign, 2026-09-23: Fleet · Now and the readiness state page draw no
   * gap notes, so they no longer carry the queue form; the rule is kept
   * class-wide instead — every page that draws a queue button, directly or in
   * a panel beside it, renders the one form the button names, and every gap
   * note on the console names where it is.
   */
  const CONSOLE = join(ROOT, "app", "(admin)");
  for (const abs of sourceFilesUnder([".tsx"], "app", "(admin)")) {
    const rel = relative(ROOT, abs).split(sep).join("/");
    if (rel === "app/(admin)/console-ui.tsx") continue;
    const s = src(rel);
    const gaps = (s.match(/<GapNote\b/g) ?? []).length;
    const located = (s.match(/<GapNote\b[^>]*where=/g) ?? []).length;
    assert.equal(located, gaps, `${rel}: every GapNote names where it is (${located} of ${gaps})`);
    if (located === 0 && !/<QueueButton\b/.test(s)) continue;
    const page = join(dirname(abs), "page.tsx");
    assert.ok(page.startsWith(CONSOLE), `${rel} draws a queue button outside the console`);
    assert.match(src(relative(ROOT, page)), /<QueueForm returnTo=/, `${relative(ROOT, page)} draws a queue button (in ${rel}) and must render the one queue form it names`);
  }
  assert.match(src("app/(admin)/admin/research/page.tsx"), /<QueueForm returnTo=/, "the research page renders the one queue form");
  // Admin redesign, 2026-09-23: the home page's fix-queue section moved to the Fix list, which puts an item on the queue through queue.add and sends the queue with Go fix these on the fix-queue row.
  const fix = codeOf("app/(admin)/_mw/screens/fix.tsx");
  assert.match(fix, /<GoFix [^>]*subjectId=\{FIX_QUEUE_SUBJECT\} option=\{GO_FIX_OPTION\}/);
  const controls = codeOf("app/(admin)/_mw/fix-controls.tsx");
  assert.match(controls, /type: "queue\.add",[\s\S]{0,120}input: \{ fix: props\.fixField\[item\.id\] \}/, "an item goes on the queue through the typed gateway, as the parsed fix field");
  assert.match(fix, /fixField\[item\.id\] = fixConsequence\(t\.where, t\.says\);/, "the fix field is the same where — says shape parseFixField reads back");
  assert.match(src("lib/control-plane/gateway/registry.ts"), /const parsed = parseFixField\(combined\);/, "and the gateway's queue.add reads it back with parseFixField");
  assert.match(controls, /type: "decision\.record",[\s\S]{0,160}subjectId: props\.subjectId,\s*chosenOption: props\.option,/, "Go fix these is a decision on the fix-queue row");
});

/* ================================================================== *
 * ADM-19 — no "our"
 * ================================================================== */

test("ADM-19: a gap of ours reads 'not measured', never OUR GAP, on every console surface", () => {
  const ui = src("app/(admin)/console-ui.tsx");
  assert.match(ui, /if \(gap\.whose === "OURS"\) return "not measured";/);
  assert.match(ui, /if \(gap\.whose === "THEIRS"\) return "not published";/);
  // Admin redesign, 2026-09-23: the per-state readiness panel this named was removed; the sweep now covers every console file and the redesign's view models, so a new screen walks into the rule.
  const swept = [...sourceFilesUnder([".ts", ".tsx"], "app", "(admin)"), ...sourceFilesUnder([".ts"], "lib", "control-plane", "admin-view")];
  assert.ok(swept.some((f) => f.endsWith(join("readiness", "[state]", "page.tsx"))) && swept.some((f) => f.endsWith(join("_mw", "next-steps.tsx"))), "the sweep reaches the redesigned screens");
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
  assert.equal(findingPlain("PERMISSION_DENIED"), "an older attempt stopped at the site's robots.txt, which no longer blocks a public page");
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
  ordering: { rule: "r", scope: "s", inputs: { readerImpactAt: "FreshnessObligation.readerImpactAt", pilotJurisdictions: "p", universeProviders: [], tieBreak: "oldest nextDueAt first within a band" }, bands: { 1: 182, 2: 2151, 3: 0 }, appliesTo: "BOUNDED_MODEL_WORKER" },
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
      { stage: "PIPELINE_EVALUATION", outcome: "COMPLETED", startedAt: "", finishedAt: "", reason: null },
      { stage: "DIGEST", outcome: "COMPLETED", startedAt: "", finishedAt: "", reason: null },
    ] as never),
    promoted: held(m(0, 43)),
    wouldPromote: held(m(0, 43)),
    refused: held(m(43, 43)),
    deferred: held(m(0, 43)),
    byRecordClass: held([{ recordClass: "OFFICIAL_MEETING_DOCUMENT_INVENTORY", promoteWould: m(0, 3), refuseWould: m(3, 3), deferred: m(0, 3) }]),
    verdicts: held({ shown: m(0, 0), rows: [] }),
    controls: { held: false, gap: { whose: "OURS", says: "no controls" } },
    incidents: held({ shown: m(0, 0), rows: [] }),
    proof: held({ windowId: "nw-1", recordPath: null, digestPath: null, leaseId: "ls-1", windowsRecorded: 3 }),
  };
  const plain = plainWindow(view);
  assert.equal(
    plain.headline,
    "The window for September 4 ran on time at September 4, 4:04 AM ET in shadow mode (nothing reaches readers yet); all 2 stages completed; nothing was promoted because the gate is closed (reader, truth and freshness are not yet independently proven) — of 43 items, 43 refused; no incidents.",
  );
  assert.deepEqual(plain.stages.map((s) => [s.label, s.ok]), [["Evaluate", true], ["Digest", true]]);
  assert.deepEqual(plain.split, { items: 43, promoted: 0, wouldPromote: 0, refused: 43, deferred: 0 });
  assert.equal(plain.classes[0].label, "official meeting document inventory");
  assert.equal(recordClassLabel("campaign-finance"), "campaign finance");
  const never = plainWindow({ ...view, verdict: "NEVER_RUN", time: { held: false, gap: { whose: "OURS", says: "never" } } });
  assert.match(never.headline, /never run/);
  const page = src("app/(admin)/admin/research/page.tsx");
  assert.match(page, /\{windowPlain\.headline\}/);
  assert.match(page, /className="stage-strip"/);
  assert.match(page, /Window detail — definitions, the gate, controls, proof<\/summary>/);
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
  // Admin redesign, 2026-09-23: the spend-by-role and spend-by-day charts (POS-12) were removed; Fleet · Money draws AI usage by provider and model, and the model money by place, instead.
  /*
   * ADM-33 (9.6.26) struck the blanket "$0 by design" claim: the owner did not
   * believe the Detective was free, and he was right to ask — absence of a cost
   * record was being read as proof that a role never spends. "Plain code" is a
   * reading of the code that runs the work and "no dollars reported" is a
   * reading of the ledger, and the two are never the same sentence.
   *
   * Admin redesign, 2026-09-23: Money no longer draws a row per role; it draws
   * a row per model, each carrying its own class (plain code, or which tier of
   * model). The split follows the row.
   */
  assert.doesNotMatch(page, /free by design/i, "the blanket claim is gone");
  assert.match(codeOf("lib/control-plane/admin-view/money-view.ts"), /tier: tierOf\(r\.key\),/, "each model row carries its own class");
  const money = codeOf("app/(admin)/_mw/screens/money.tsx");
  const cells = /function ModelCells[\s\S]*?\n\}/.exec(money)?.[0] ?? "";
  assert.ok(cells.includes("{m.tier}"), "the class is drawn on the row");
  assert.doesNotMatch(cells, /m\.usd === null \? <span[^>]*>no model cost</, "ADM-33: a model row whose charges reported no dollars reads 'no model cost', the same words as plain code — an unpriced model reads as free");
  assert.match(src("scripts/publish-owner-snapshot.mts"), /spendByDay: spendByDay\(reads\)/);
});

/* ================================================================== *
 * ADM-18 — the reader suite says what it is, or one line
 * ================================================================== */

test("ADM-18: the reader-suite reading collapses to one named line when there is no grid", () => {
  // Admin redesign, 2026-09-23: the home page's reader-check section (its lead sentence and its per-ZIP table) was removed; the same snapshot reading is drawn on /admin/fleet's Panels tab as the coverage-gaps panel.
  const panels = codeOf("components/admin/fleet-panels-tab.tsx");
  assert.match(panels, /const zip = c\.value\.zipRows;/, "the panel reads the reader-suite grid from the snapshot");
  assert.match(panels, /\$\{zip\.gap\.says\}/, "no grid renders as the NAMED gap sentence, never as an empty table");
  assert.doesNotMatch(panels, /"no grid"/);
  assert.doesNotMatch(surface("home"), /"no grid"/);
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
  assert.match(complete.value.contract, /1 of 2 ZIP\(s\) in Arizona with a population on file/);
  const none = populationInCompleteZip(a, [zip("85641", 34752, ["BLOCKED"])]);
  assert.ok(none.held && none.value.value === 0, "a measured zero: nothing is complete yet, and that is a fact");
  assert.ok(!populationInCompleteZip({ ...a, statePopulation: null }, [zip("85701", 5498, ["CURRENT"])]).held);
  assert.ok(!populationInCompleteZip(a, []).held);
  assert.ok(!populationInCompleteZip(a, [zip("85700", null, ["CURRENT"])]).held);
  const refresh = src("scripts/readiness-refresh.mts");
  assert.match(refresh, /population: population\.population/);
  assert.match(refresh, /statePopulation: null/);
  assert.match(refresh, /canonical civic-data receipt in Admin/);
  assert.doesNotMatch(refresh, /statePopulation\(spec\.code\)/, "readiness may not revive tracked ACS as a second authority");
  assert.doesNotMatch(src("lib/control-plane/readiness/extract.ts"), /not yet ingested/);
  assert.match(refresh, /Routine ACS population is shown from the canonical civic-data receipt in Admin/, "the readiness publisher names the canonical owner instead of copying tracked ACS truth");
  // Admin redesign, 2026-09-23: the per-state readiness panel and its per-ZIP population column were removed; the redesigned state page draws no population, so no page can hardcode a population gap.
  for (const rel of ["app/(admin)/readiness/[state]/page.tsx", "lib/control-plane/admin-view/readiness-view.ts", "lib/control-plane/admin-view/coverage.ts"]) {
    assert.doesNotMatch(src(rel), /"population not on file"/, `${rel} hardcodes a population gap`);
  }
});

/* ================================================================== *
 * ADM-15 — the next step per ZIP
 * ================================================================== */

test("ADM-15: readiness says the next thing to do, and a Deploy-fleet-here control carries its own target", () => {
  // Admin redesign, 2026-09-23: the per-ZIP table (its next-step column and per-row deploy button) was removed; the all-states page says the next thing to do per state, from its largest county gap.
  const all = codeOf("app/(admin)/readiness/page.tsx");
  assert.match(all, /"Next thing to do"/);
  assert.match(all, /next: counties\.kind === "HELD" && registry\.kind === "HELD" \? nextThing\(/, "the next step is generated from the state's own gaps");
  assert.match(all, /\{r\.next\}/);
  /*
   * §9A.16 (9.6.26): the button is the SAME control as the rest of the console,
   * so it explains itself before acting and sends through the one typed
   * gateway. Admin redesign, 2026-09-23: Deploy fleet here on an opened
   * container is a link to the Work composer with that geography already
   * filled in; the composer (guarded in admin-feedback-9-4, ADM-8) explains
   * itself and sends expansion.scope.set.
   */
  const state = codeOf("app/(admin)/readiness/[state]/page.tsx");
  assert.match(state, /withScope\("\/admin\/work", scope, \{ geo: `\$\{shortOf\}:\$\{open\.c\.geography\.geoid\}`, st: code \}\)[\s\S]{0,80}Deploy fleet here/, "the container already knows which geography, so he does not retype it");
  const work = codeOf("app/(admin)/_mw/screens/work.tsx");
  assert.match(work, /const geoParam = param\(sp, "geo"\);/, "the Work screen reads the geography it was sent with");
  assert.match(work, /initial=\{initialGeo\}/, "and hands it to the composer as the choice already made");
});

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
  // Admin redesign, 2026-09-23: the header's View / State dropdowns were replaced by the shell's scope select, the one header control that waits on the server; it acknowledges the choice inside a transition with a loading status.
  const nav = codeOf("app/(admin)/_mw/header-controls.tsx");
  assert.match(nav, /useTransition\(/);
  assert.match(nav, /\{pending && \([\s\S]*?role="status"/);
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
