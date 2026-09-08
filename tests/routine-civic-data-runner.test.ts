import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import { SOURCE_AUTHORITIES, authorityFor } from "../lib/civic-data/source-authority.ts";

test("the standing portfolio invokes data-plane scripts only", () => {
  assert.deepEqual(ROUTINE_SOURCE_TASKS.map((task) => task.id), [
    "fec-funding",
    "nh-members",
    "census-acs-population",
  ]);
  const commands = ROUTINE_SOURCE_TASKS.flatMap((task) => task.command).join(" ");
  assert.doesNotMatch(commands, /(?:^|\s)(?:git|gh|next|netlify)(?:\s|$)|\.github|browser|deploy/i);
  assert.equal(new Set(ROUTINE_SOURCE_TASKS.map((task) => `${task.recordClass}:${task.scope}`)).size, ROUTINE_SOURCE_TASKS.length);
  const implementation = [
    "scripts/routine-civic-data-runner.mts",
    "scripts/routine-civic-data-live-acceptance.mts",
    ...ROUTINE_SOURCE_TASKS.map((task) => task.command[0]),
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(implementation, /test\.meanwhileusa\.com/);
  assert.doesNotMatch(implementation, /spawnSync\([^)]*(?:git|gh|next|netlify|browser)/i);
});

test("one canonical registry owns every supported authority and refuses arbitrary gov hosts", () => {
  assert.deepEqual(Object.keys(SOURCE_AUTHORITIES), [
    "fec-open-api",
    "census-data-api",
    "census-bulk-products",
    "az-legislature",
    "nh-general-court",
    "nj-legislature",
    "legiscan",
    "plural-openstates",
  ]);
  for (const [id, source] of Object.entries(SOURCE_AUTHORITIES)) {
    assert.equal(source.id, id);
    assert.ok(source.publisher && source.routePrefixes.length && source.allowedFinalHosts.length);
    assert.ok(source.jurisdictions.length && source.recordClasses.length && source.competentFacts !== undefined);
    assert.ok(source.expectedIdentifierKeys.length && source.expectedTemporalFields.length);
    assert.ok(source.horizonSemantics && source.parserVersion && source.freshnessExpectation);
  }
  const arbitrary = authorityFor("az-legislature", "STATE_ROLL_CALL", "https://example.gov/roll/1");
  assert.equal(arbitrary.ok, false);
  if (!arbitrary.ok) assert.equal(arbitrary.code, "FINAL_HOST_NOT_AUTHORIZED");
  const intermediary = authorityFor("legiscan", "STATE_ROLL_CALL", "https://api.legiscan.com/?op=getRollCall&id=1");
  assert.equal(intermediary.ok, false);
  if (!intermediary.ok) assert.equal(intermediary.code, "SOURCE_NOT_AUTO_PROMOTABLE");
});

test("routine release output labels the seven-zero constant as structural, never observed", () => {
  assert.deepEqual(ZERO_RELEASE_EVENTS, {
    testSitePromotions: 0,
    gitDataCommits: 0,
    pullRequests: 0,
    githubActionsRuns: 0,
    netlifyDeploys: 0,
    nextBuilds: 0,
    fullSiteBrowserWalks: 0,
  });
  for (const path of [
    "scripts/fetch-fec.mts",
    "scripts/nh-gencourt-members.mts",
    "scripts/acs-population-promote.mts",
    "scripts/routine-civic-data-runner.mts",
    "scripts/routine-civic-data-live-acceptance.mts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /structuralReleaseContract:\s*ZERO_RELEASE_EVENTS/, `${path} must label the constant as structural`);
    assert.doesNotMatch(source, /\breleaseEvents:\s*ZERO_RELEASE_EVENTS/, `${path} must not report a constant as observed release events`);
  }
  const canary = readFileSync("scripts/routine-civic-data-live-acceptance.mts", "utf8");
  for (const flag of ["fec-prior", "fec-good", "state-prior", "state-good", "census-prior", "census-good"]) {
    assert.match(canary, new RegExp(`requiredVersionFlag\\(\\"${flag}\\"\\)`), `RCD-10 canary must require --${flag}`);
  }
  assert.match(canary, /observedReleaseEvents:\s*"REQUIRED_SEPARATELY"/);
  assert.match(canary, /rcd10Complete:\s*false/);
});

test("cadence and retry are source-local", () => {
  const [fec, nh, census] = ROUTINE_SOURCE_TASKS;
  const now = Date.parse("2026-09-07T12:00:00.000Z");
  const oneHour = 60 * 60 * 1_000;
  assert.equal(routineTaskDue(fec, undefined, now), true);
  assert.equal(routineTaskDue(fec, { lastAttemptedAt: new Date(now - oneHour).toISOString() }, now), false);
  assert.equal(routineTaskDue(fec, { lastAttemptedAt: new Date(now - 7 * oneHour).toISOString() }, now), true);
  assert.equal(routineTaskDue(fec, {
    lastAttemptedAt: new Date(now - oneHour).toISOString(),
    lastSucceededAt: new Date(now - 8 * 24 * oneHour).toISOString(),
  }, now), false, "a failed due refresh waits for the FEC-specific retry interval");
  assert.equal(routineTaskDue(fec, {
    lastAttemptedAt: new Date(now - 7 * oneHour).toISOString(),
    lastSucceededAt: new Date(now - 8 * 24 * oneHour).toISOString(),
  }, now), true, "the failed source becomes due when its own retry interval elapses");
  assert.equal(routineTaskDue(nh, { lastAttemptedAt: new Date(now - 2 * oneHour).toISOString(), lastSucceededAt: new Date(now - 2 * oneHour).toISOString() }, now), false);
  assert.equal(routineTaskDue(census, { lastAttemptedAt: new Date(now - 31 * 24 * oneHour).toISOString(), lastSucceededAt: new Date(now - 31 * 24 * oneHour).toISOString() }, now), true);
});
