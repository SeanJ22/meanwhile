/**
 * `pnpm rollcall:walk` — WHAT THE PIMA ROLL-CALL ROUTES ACTUALLY RETURNED.
 * (Session B closure, 2026-08-31, the author's correction.)
 *
 * ## Why this exists
 *
 * A Session B report stated *"we hold no Pima roll-call votes"* and cited the
 * owner's workbook row F2 — status COULD NOT TELL — as corroboration. Both
 * halves were wrong: an unverified row is not evidence in either direction,
 * and the statement itself was false.
 *
 * The correction's operative instruction was to **walk the roll-call routes
 * with counts per route before any statement about what Pima publishes**. This
 * is that walk, over the promoted outcomes projection, and its output is the record
 * a later session should read instead of the sentence it replaces.
 *
 * It reads the canonical projection rather than the network. The routes were
 * walked when that version was built and every route is named in each sitting's
 * `routesWalked`; re-fetching would measure today's tenant rather than the
 * version the Ask engine actually answers from.
 *
 * ## What a zero here would mean
 *
 * Ours, not theirs. If this reports no rolls, the honest reading is that OUR
 * retrieval produced nothing — never that a government stopped publishing. The
 * `failedRollCallExtractions` column is the standing example: the attendance
 * item's own flag says a roll was taken and the votes route returns nothing for
 * it, once per sitting, and that is recorded as a FAILED EXTRACTION rather than
 * tuned away into a clean report.
 */

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { getOutcomeSnapshot, readOutcomeProjection } from "../lib/outcomes/store.ts";
import type { PersistedSittingOutcomes } from "../lib/outcomes/types.ts";

const projection = await readOutcomeProjection();
if (projection.kind !== "PROMOTED") {
  throw new Error(`Pima outcome projection is ${projection.kind}; a roll-call proof requires the canonical production pointer.`);
}
const store = getOutcomeSnapshot();

const rowsOf = (s: PersistedSittingOutcomes): number =>
  s.rollCalls.reduce((n, r) => n + r.votes.length, 0);

/* --------------------------------------------------------- per route --- */

const perRoute = new Map<string, { sittings: number }>();
for (const s of store.sittings) {
  for (const r of s.routesWalked ?? []) {
    const key = String(r);
    const row = perRoute.get(key) ?? { sittings: 0 };
    row.sittings += 1;
    perRoute.set(key, row);
  }
}

const totalRolls = store.sittings.reduce((n, s) => n + (s.rollCalls ?? []).length, 0);
const totalRows = store.sittings.reduce((n, s) => n + rowsOf(s), 0);
const totalFailed = store.sittings.reduce(
  (n, s) => n + (s.failedRollCallExtractions ?? []).length,
  0,
);
const totalReqFail = store.sittings.reduce((n, s) => n + (s.voteRequestFailures ?? []).length, 0);
const withRolls = store.sittings.filter((s) => (s.rollCalls ?? []).length > 0).length;

console.log(`rollcall:walk · canonical ${projection.metadata.recordClass}/${projection.metadata.scope} @ ${projection.metadata.versionId}`);
console.log(`  tenants: ${store.tenants.join(", ")} · generated ${store.generatedAt ?? "unstamped"}`);
console.log(
  `  ${floorLine(
    floored(
      "sitting(s) that returned at least one per-person roll call",
      "the sittings this store holds",
      store.sittings.length,
      withRolls,
      store.sittings.length === 0 ? "the store holds no sittings" : undefined,
    ),
  )}`,
);
console.log(`\n  ROUTES WALKED, and how many sittings each was walked for`);
for (const [route, row] of [...perRoute].sort()) {
  console.log(`    ${route.padEnd(26)} ${row.sittings} sitting(s)`);
}

console.log(`\n  WHAT CAME BACK`);
console.log(`    roll calls held              ${totalRolls}`);
console.log(`    per-person vote rows held    ${totalRows}`);
console.log(`    failed roll-call extractions ${totalFailed}   (OURS — the attendance item)`);
console.log(`    vote request failures        ${totalReqFail}`);

console.log(`\n  PER SITTING`);
for (const s of [...store.sittings].sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""))) {
  console.log(
    `    ${(s.startsAt ?? "UNKNOWN").slice(0, 10)}  ${s.bodyName.slice(0, 30).padEnd(30)} ` +
      `rolls ${String((s.rollCalls ?? []).length).padStart(3)}  ` +
      `rows ${String(rowsOf(s)).padStart(4)}  ` +
      `failed ${String((s.failedRollCallExtractions ?? []).length).padStart(2)}`,
  );
}

/*
 * THE SENTENCE THIS REPLACES, stated so the correction travels with the evidence.
 */
console.log(
  `\n  THE CLAIM THIS WALK CORRECTS: "we hold no Pima roll-call votes", offered with the owner's\n` +
    `  COULD NOT TELL row F2 as corroboration. This store holds ${totalRolls} roll call(s) and\n` +
    `  ${totalRows} per-person vote row(s). An unverified workbook row is not evidence in either\n` +
    "  direction, and the statement it was offered in support of is false.",
);

console.log(`\n  immutable version: ${projection.metadata.versionId}`);
