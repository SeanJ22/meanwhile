/**
 * Admin display guards: Eastern time stamps, display names, the fix queue, cost rows, population
 * reference tables and the admin stylesheet. Pages are read as source text (a `.tsx` cannot be
 * imported under `node --test`).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { codeOf, sourceFilesUnder } from "./read-code.ts";
import { consoleReturnPath, isConsolePath } from "../lib/control-plane/console-paths.ts";
import { buildCostPanel, costRowKind } from "../lib/control-plane/cost-panel.ts";
import { LEVEL_CLASS, displayNameOf, words } from "../lib/control-plane/display-name.ts";
import { easternize, formatCalendarDate, formatEastern, formatEasternDate, formatEasternSpan, NO_STAMP, BAD_STAMP } from "../lib/control-plane/eastern-time.ts";
import { buildFleetView } from "../lib/control-plane/fleet-view.ts";
import {
  ADD_TO_QUEUE_OPTION,
  FIX_QUEUE_SUBJECT,
  GO_FIX_OPTION,
  fixConsequence,
  fixQueueView,
  fixSubjectId,
  parseFixField,
} from "../lib/control-plane/fix-queue.ts";
import { held, measured, type OwnerDecisionIntent } from "../lib/control-plane/owner-surface.ts";
import { normalize, toCsv, type AcsFetch } from "../lib/sources/census-acs-population/index.ts";

const ROOT = process.cwd();
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/* ================================================================== *
 * every stamp is Eastern, spelled out
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
  const offenders: string[] = [];
  // A stamp printed as a child or interpolated into a sentence reaches the owner as ISO; an attribute does not.
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
 * keys render as names; a person is never invented
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
 * Decisions and console paths
 * ================================================================== */

const INTENT = (over: Partial<OwnerDecisionIntent>): OwnerDecisionIntent => ({
  formatVersion: 1,
  intentId: "T05:2026-09-05T03:00:00.000Z",
  subjectId: "T05",
  chosenOption: "Name yourself as the reviewer and build the surface",
  consequenceShown: "NH165 unblocks",
  decidedAt: "2026-09-05T03:00:00.000Z",
  state: "RECORDED",
  canonicalRef: null,
  refusedReason: null,
  adminSessionRef: "adm_x",
  ownerAnswer: null,
  ...over,
});
test("a console return path is a closed list of console pages", () => {
  assert.equal(consoleReturnPath("/admin", "/admin"), "/admin");
  assert.equal(consoleReturnPath("/readiness/az", "/admin"), "/admin", "a retired page is not a destination any more");
  assert.equal(consoleReturnPath("https://evil.example/", "/admin"), "/admin");
  assert.equal(consoleReturnPath("/readiness/AZ", "/admin"), "/admin", "the closed list is exact");
  assert.equal(isConsolePath("/admin/sources"), false, "the Sources page is deleted: publication status is on Workers");
});

/* ================================================================== *
 * the fix queue
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
 * no "our"
 * ================================================================== */

test("ADM-19: a gap of ours reads 'not measured', never OUR GAP, on every console surface", () => {
  const swept = [...sourceFilesUnder([".ts", ".tsx"], "app", "(admin)"), ...sourceFilesUnder([".ts"], "lib", "control-plane", "admin-view")];
  for (const abs of swept) {
    const rel = relative(ROOT, abs).split(sep).join("/");
    assert.doesNotMatch(src(rel), /our gap|OUR GAP|function whoseLabel/i, `${rel} carries no 'our gap' wording and no second gap labeller`);
  }
});

/* ================================================================== *
 * free by design is not a gap; time, requests and bytes are measured
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
 * The population adapter
 * ================================================================== */

test("the ACS adapter normalizes rows, leaves an unstated margin empty, and refuses a non-count", () => {
  const fetched: AcsFetch = { scope: "zcta", url: "u", status: 200, fetchedAt: "t", rows: [["NAME", "B01003_001E", "B01003_001M", "zip code tabulation area"], ["ZCTA5 85701", "5498", "734", "85701"], ["ZCTA5 00601", "16721", "-555555555", "00601"]] };
  assert.deepEqual(normalize(fetched).map((r) => r.code), ["00601", "85701"]);
  // A negative jam value (`-555555555`) means no margin stated: an empty cell, never zero.
  assert.equal(toCsv(normalize(fetched), "zcta"), "zcta,name,population,margin_of_error\n00601,ZCTA5 00601,16721,\n85701,ZCTA5 85701,5498,734\n");
  assert.throws(() => normalize({ ...fetched, rows: [fetched.rows[0], ["ZCTA5 1", "-1", "0", "00001"]] }), /not a count/);
  assert.throws(() => normalize({ ...fetched, rows: [fetched.rows[0], ["ZCTA5 1", null, "0", "00001"]] }), /not a count/);
});


/* ================================================================== *
 * Lumen Edge on the admin only, with the reader legend's colours
 * ================================================================== */

test("ADM-21: the admin stylesheet carries the four Lumen signals, the reader legend's level colours in both themes, and no font import", () => {
  const layout = src("app/(admin)/layout.tsx");
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
    // Level colours reference the reader legend's `--accent-*` token, with its value as the fallback.
    assert.match(layout, new RegExp(`--lvl-${level}: var\\(--accent-${accent}, ${dark}\\);`), `dark ${level} references the reader legend, legend value as fallback`);
    assert.match(layout, new RegExp(`--lvl-${level}: var\\(--accent-${accent}, ${lit}\\);`), `light ${level} references the reader legend, legend value as fallback`);
  }
  assert.match(layout, /\.admin \.card\.lvl-state::after \{ background: linear-gradient\(90deg, transparent 0%, var\(--lvl-state\) 50%, transparent 100%\)/, "the horizon carries the hue");
  // The admin's own `--ce-*` recipe tokens never leak into the reader stylesheet.
  assert.doesNotMatch(globals, /--ce-surface|--ce-void|--ce-graphite|--ce-panel-raised/);
  assert.equal(existsSync(join(ROOT, "DESIGN.md")), false, "no DESIGN.md at the repo root");
  assert.equal(existsSync(join(ROOT, "css", "system.css")), false);
});
