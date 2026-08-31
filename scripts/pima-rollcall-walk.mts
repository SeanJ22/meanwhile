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
 * is that walk, over the committed outcomes store, and its output is the record
 * a later session should read instead of the sentence it replaces.
 *
 * It reads the STORE rather than the network. The routes were walked when the
 * store was built and every route is named in each sitting's `routesWalked`;
 * re-fetching would measure today's tenant rather than the run that produced
 * the rows the Ask engine actually answers from.
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

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "outcomes", "legistar-outcomes.json");
const OUT = join(ROOT, "data", "health", "rollcall-walks");

interface Sitting {
  startsAt: string;
  bodyName: string;
  meetingId: string;
  sourceOrg?: string;
  rollCalls?: { votes?: unknown[]; members?: unknown[] }[];
  failedRollCallExtractions?: unknown[];
  voteRequestFailures?: unknown[];
  /* Strings, as the store writes them: ["WEBAPI_EVENTS", "WEBAPI_EVENTITEMS", ...]. */
  routesWalked?: string[];
}

const store = JSON.parse(readFileSync(STORE, "utf8")) as {
  generatedAt?: string;
  tenants: string[];
  sittings: Sitting[];
};

const rowsOf = (s: Sitting): number =>
  (s.rollCalls ?? []).reduce((n, r) => n + (r.votes ?? r.members ?? []).length, 0);

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

console.log(`rollcall:walk · ${STORE}`);
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
for (const s of [...store.sittings].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))) {
  console.log(
    `    ${s.startsAt.slice(0, 10)}  ${s.bodyName.slice(0, 30).padEnd(30)} ` +
      `rolls ${String((s.rollCalls ?? []).length).padStart(3)}  ` +
      `rows ${String(rowsOf(s)).padStart(4)}  ` +
      `failed ${String((s.failedRollCallExtractions ?? []).length).padStart(2)}`,
  );
}

/*
 * THE SENTENCE THIS REPLACES, stated so the correction travels with the data.
 */
console.log(
  `\n  THE CLAIM THIS WALK CORRECTS: "we hold no Pima roll-call votes", offered with the owner's\n` +
    `  COULD NOT TELL row F2 as corroboration. This store holds ${totalRolls} roll call(s) and\n` +
    `  ${totalRows} per-person vote row(s). An unverified workbook row is not evidence in either\n` +
    "  direction, and the statement it was offered in support of is false.",
);

mkdirSync(OUT, { recursive: true });
const path = join(OUT, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(
  path,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      store: "data/outcomes/legistar-outcomes.json",
      tenants: store.tenants,
      sittings: store.sittings.length,
      sittingsWithRolls: withRolls,
      rollCallsHeld: totalRolls,
      personVoteRowsHeld: totalRows,
      failedRollCallExtractions: totalFailed,
      voteRequestFailures: totalReqFail,
      routesWalked: Object.fromEntries([...perRoute].map(([k, v]) => [k, v.sittings])),
      perSitting: store.sittings.map((s) => ({
        startsAt: s.startsAt,
        bodyName: s.bodyName,
        meetingId: s.meetingId,
        rollCalls: (s.rollCalls ?? []).length,
        personVoteRows: rowsOf(s),
        failedRollCallExtractions: (s.failedRollCallExtractions ?? []).length,
      })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  record: ${path}`);
