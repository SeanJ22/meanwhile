/** Plain-English rendering of machine codes, money, model ids and ages, and which state a unit of work belongs to. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PLAIN_WORDS,
  ageWords,
  count,
  hasPlainMeaning,
  isEnvVarName,
  modelName,
  plainCode,
  plainMeaning,
  plainText,
  usdCents,
  usdOf,
} from "../lib/control-plane/plain-words.ts";
import { stateCodeOf, unitBelongsToState } from "../lib/control-plane/unit-state.ts";
import { unitCarriesState } from "../lib/control-plane/scheduler/dispatch-target.ts";
import { spendWindowRows } from "../lib/control-plane/cost-panel.ts";
import { FLEET_SAFETY_BOUNDS, type FleetSafetySnapshot } from "../lib/control-plane/fleet-safety.ts";

/* ------------------------------------------------------- machine codes */

test("ADM-25 · no constant the owner photographed renders with an underscore", () => {
  const photographed = [
    "CYCLE_DEFERRED",
    "WALL_CLOCK_CEILING",
    "NOT_READY",
    "SHOWN_TO_READER",
    "NOT_WALKED",
    "UNRESOLVED_INVESTIGATION",
    "DETERMINISTIC_REPLAYS",
    "REFUSED_BY_HOST",
    "ADVERSARIAL_AUDITOR",
    "NEVER_DISPATCHED",
    "UPSTREAM_ERROR",
    "TRANSPORT_FAILED",
    "INDEPENDENTLY_REPRODUCED",
    "NOT_CONFIGURED",
    "PARTIAL_OR_STALE",
    "ARGUED_ABSENT",
    "GATED_ON_OPERATOR",
    "BOUNDED_MODEL_WORKER",
    "OWNER_DECISION_REQUIRED",
  ];
  assert.equal(photographed.length, 19, "the denominator this test sweeps");
  for (const code of photographed) {
    const words = plainCode(code);
    assert.ok(!words.includes("_"), `${code} still renders an underscore: ${words}`);
    assert.notEqual(words, code, `${code} was not translated at all`);
    assert.match(words, /^[A-Z]/, `${code} should render in sentence case, got ${words}`);
  }
});

test("ADM-25 · an unknown constant still loses its underscores", () => {
  assert.equal(plainCode("SOME_BRAND_NEW_STATE"), "Some brand new state");
});

test("ADM-25 · text that is not a machine constant is left alone", () => {
  assert.equal(plainCode("Atlantic County, New Jersey"), "Atlantic County, New Jersey");
  assert.equal(plainCode(""), "");
  assert.equal(plainCode(null), "");
});

test("ADM-25 · POSITIVE CONTROL — the runner's own stop sentence loses every code", () => {
  const asPhotographed =
    "CYCLE_DEFERRED: the cycle's dispatch budget was spent at September 6, 2026, 9:10 PM ET " +
    "before this item was reached. It keeps its next-due and is dispatched by a later cycle; " +
    "WALL_CLOCK_CEILING: insufficient cycle wall time remained; work remains owed.";
  const plain = plainText(asPhotographed);
  assert.ok(!/[A-Z][A-Z0-9]*_[A-Z0-9]/.test(plain), `a screaming-snake code survived: ${plain}`);
  assert.ok(plain.includes("Cycle time used".toLowerCase()), plain);
});

test("ADM-25 · an environment variable never renders its own name", () => {
  assert.ok(isEnvVarName("WTP_WORKERS_ANTHROPIC_API_KEY"));
  assert.ok(isEnvVarName("GOOGLE_OAUTH_CLIENT_SECRET"));
  assert.ok(isEnvVarName("WTP_STAGING_MANIFEST_COOKIE"));
  assert.ok(!isEnvVarName("REFUSED_BY_HOST"));
  const line = plainText("Worker credential WTP_WORKERS_ANTHROPIC_API_KEY: configured true");
  assert.ok(!line.includes("WTP_"), line);
  assert.ok(line.includes("a credential held on the server"), line);
});

/* ----------------------------------------------- money, models, counts */

test("ADM-26 · dollars render to the cent, never to four places", () => {
  assert.equal(usdCents(0.4394), "$0.44");
  assert.equal(usdCents(25), "$25.00");
  assert.equal(usdCents(0), "$0.00");
  assert.equal(usdOf(0.4394, 25), "$0.44 of $25.00");
  // A real but sub-cent amount must not claim nothing was spent.
  assert.equal(usdCents(0.0004), "<$0.01");
});

test("ADM-33 · a model id renders as a name", () => {
  assert.equal(modelName("claude-opus-5"), "Claude Opus 5");
  assert.equal(modelName("claude-opus-5-5"), "Claude Opus 5.5", "the current frontier renders its minor version, not 'Opus 5 5'");
  assert.equal(modelName("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
  assert.equal(modelName("claude-sonnet-5"), "Claude Sonnet 5");
  assert.equal(modelName("no model (deterministic work)"), "No model — plain code");
});

test("counts read as a person reads them", () => {
  assert.equal(count(2985), "2,985");
  assert.equal(count(0), "0");
});

test("ADM-30 · an age in hours reads as ordinary time", () => {
  assert.equal(ageWords(0.5), "under an hour");
  assert.equal(ageWords(1), "1 hour");
  assert.equal(ageWords(118), "4 days");
  assert.equal(ageWords(577), "3 weeks");
});

/* ------------------------------------------------- state attribution */

test("ADM-29 · POSITIVE CONTROL — a New Jersey candidate named De Venezia is not Delaware", () => {
  const id =
    "freshness:candidate-enrichment:nj:2026:state-nj-place-boonton:member-of-the-town-council-ward-2:de-venezia-marie#candidate-wikipedia-api";
  const subject = "nj:2026:state-nj-place-boonton:member-of-the-town-council-ward-2:de-venezia-marie";
  assert.equal(stateCodeOf(id, subject), "nj");
  assert.ok(!unitBelongsToState(id, subject, "de"), "this row must never dispatch to Delaware");
});

test("ADM-29 · Arizona ballot campaign finance is Arizona, not 'other'", () => {
  const id = "freshness:campaign-finance:ballot-az-pima:prop-423#AZ_SEETHEMONEY_LIVE_BROWSER";
  assert.equal(stateCodeOf(id, "ballot-az-pima:prop-423"), "az");
});

test("ADM-29 · every real id shape in the store attributes correctly", () => {
  const cases: readonly [string, string, string | null][] = [
    ["freshness:jurisdiction:nh:city:city-of-berlin", "nh:city:city-of-berlin", "nh"],
    ["freshness:candidate-enrichment:az:2026:x", "az:2026:general-web-index-availability", "az"],
    ["freshness:campaign-finance:az-sos-cfs-2026#az-sos-cfs-bulk-ftp", "az-sos-cfs-2026", "az"],
    ["freshness:campaign-finance:nh-sos-cfs-2026#nh-cfs-transaction-detail", "nh-sos-cfs-2026", "nh"],
    ["freshness:meetings:ocd-division/country:us/state:az/county:pima#x", "ocd-division/country:us/state:az/county:pima", "az"],
    ["freshness:meetings:curated:az/pima-community-college#governing", "curated:az/pima-community-college", "az"],
    ["proof-mthbrw87-due-0", "ocd-division/proof:0", null],
  ];
  assert.equal(cases.length, 7, "the denominator this test sweeps");
  for (const [id, subject, want] of cases) {
    assert.equal(stateCodeOf(id, subject), want, `${id} attributed wrongly`);
  }
});

test("ADM-29 · the dispatch matcher and the attribution agree, by construction", () => {
  const hay = "freshness:campaign-finance:ballot-az-pima:prop-423 ballot-az-pima:prop-423";
  assert.ok(unitCarriesState(hay, "az"));
  assert.ok(!unitCarriesState(hay, "de"));
  const nj = "freshness:candidate-enrichment:nj:2026:state-nj-place-boonton:x:de-venezia-marie ";
  assert.ok(unitCarriesState(nj, "nj"));
  assert.ok(!unitCarriesState(nj, "de"));
});

/* ------------------------------------------------------ spend windows */

const SAFETY: FleetSafetySnapshot = {
  formatVersion: 1,
  status: "ACTIVE",
  bounds: FLEET_SAFETY_BOUNDS,
  cycle: { startedAt: "2026-09-07T04:24:00.000Z", modelUsd: 0, requests: 0, payloadBytes: 0, dispatches: 0, elapsedMs: 720_000 },
  operationalNight: { active: false, start: "", end: "", startsOnSaturday: false, modelUsd: 0 },
  rolling24Hours: { modelUsd: 0.4394, asOf: "2026-09-07T04:36:00.000Z" },
  stoppedBecause: [
    "CYCLE_DEFERRED: the cycle's dispatch budget was spent at 2026-09-07T04:31:00.000Z before this item was reached",
    "WALL_CLOCK_CEILING: insufficient cycle wall time remained; work remains owed",
  ],
  deferred: [
    { work: "a", code: "CYCLE_DEFERRED", why: "budget" },
    { work: "b", code: "CYCLE_DEFERRED", why: "budget" },
    { work: "c", code: "WALL_CLOCK_CEILING", why: "time" },
  ],
  providerCircuits: [],
  lastSuccessfulActivity: "2026-09-06T22:26:00.000Z",
};

test("a cycle-time stop never borrows the paid-pause timestamp or claims a dollar limit", () => {
  assert.equal(plainCode("CYCLE_DEFERRED"), "Cycle time used");
  assert.match(plainMeaning("CYCLE_DEFERRED")!, /not a dollar spending limit/);
});

/** The cost panel owns the three windows; the runner card renders the same rows. */
const windowsOf = (safety: FleetSafetySnapshot) =>
  spendWindowRows({
    cycleUsd: safety.cycle.modelUsd,
    operationalNightUsd: safety.operationalNight.modelUsd,
    rolling24HourUsd: safety.rolling24Hours.modelUsd,
    ceilings: { rolling24HourModelUsd: safety.bounds.rolling24HourModelUsd },
  });

test("ADM-26 · the spend windows are a three-row table to the cent, each framed against the one daily ceiling", () => {
  const rows = windowsOf(SAFETY);
  assert.equal(rows.length, 3);
  // Every window is framed against the single rolling daily ceiling, read from the constant.
  const ceiling = usdCents(FLEET_SAFETY_BOUNDS.rolling24HourModelUsd);
  assert.equal(rows[0].shown, `$0.00 of ${ceiling}`);
  assert.equal(rows[1].shown, `$0.00 of ${ceiling}`);
  assert.equal(rows[2].shown, `$0.44 of ${ceiling}`);
  assert.ok(rows[1].defines?.toLowerCase().includes("overnight"), "an operational night must be defined");
  for (const r of rows) assert.ok(!/\.\d{3}/.test(r.shown), `four decimal places survived: ${r.shown}`);
});

test("an unmeasured window says so instead of showing $0.00", () => {
  const rows = windowsOf({ ...SAFETY, cycle: { ...SAFETY.cycle, modelUsd: null } });
  assert.match(rows[0].shown, /not measured/);
  assert.equal(rows[0].unmeasured, true);
});

/* -------------------------------------------------------- the dictionary */

test("every dictionary entry is sentence case and free of underscores", () => {
  const keys = Object.keys(PLAIN_WORDS);
  assert.ok(keys.length >= 60, `the dictionary is thin: ${keys.length} entries`);
  for (const key of keys) {
    const entry = PLAIN_WORDS[key];
    assert.ok(!entry.words.includes("_"), `${key} → ${entry.words}`);
    assert.ok(entry.words.length > 0, `${key} has no words`);
    if (entry.means) {
      assert.ok(!/\bour\b/i.test(entry.means), `${key}'s meaning says "our" (ADM-19)`);
      assert.match(entry.means, /[.!]$/, `${key}'s meaning is not a sentence`);
    }
  }
});

test("a cause the owner will read has a meaning, not only a label", () => {
  for (const cause of ["REFUSED_BY_HOST", "UPSTREAM_ERROR", "TRANSPORT_FAILED", "NEVER_DISPATCHED", "CYCLE_DEFERRED"]) {
    assert.ok(hasPlainMeaning(cause), `${cause} has no owner sentence`);
    assert.ok((plainMeaning(cause) ?? "").length > 30, cause);
  }
});
