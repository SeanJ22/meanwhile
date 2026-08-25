#!/usr/bin/env tsx
/**
 * `pnpm kelly` — **the distance to done for 07866, as a number.**
 *
 * RULING 143 says every candidate on this ballot is either at Kelly depth in
 * full or carries an argued absence, and that the distance remaining is reported
 * as a number against 272 every session, because that number decides when
 * Arizona starts. This computes it.
 *
 * ```
 * pnpm kelly                 the count, plus the per-field split
 * pnpm kelly --owed          every candidate still owed something, named
 * pnpm kelly --json          the whole scoreboard as data
 * ```
 *
 * ## Where each of the five fields is READ FROM, and why it is read rather than stored
 *
 * | field | source of record |
 * |---|---|
 * | photo | `data/ballot/candidate-cards-2026.json` → `photoUrl`, and the asset must exist on disk |
 * | phone | the same card → `phone` |
 * | contact | the same card → `email`, or the clerk's filed email in `nj-morris-2026-contacts.json` |
 * | verified page | `data/ballot/candidate-links-2026.json` → `official` |
 * | campaign site | the same file → `campaign` |
 *
 * A `kellyDepth` column on the candidate record would be a claim that goes stale
 * the moment any of those files moves, with nothing noticing. So nothing is
 * stored; the answer is derived every time it is asked.
 *
 * ## The three-way split, never a bare count (RULING 105)
 *
 * HELD, ARGUED ABSENT with its expiry, and OWED. The middle number is what keeps
 * the report honest: without it there is no way to tell a field this project
 * has established is not there from a field nobody has looked for, and those
 * need completely different responses.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { today } from "./doc-dates.mjs";

import { KELLY_FIELDS, type KellyReading, type KellyField } from "../lib/hunt/kelly-depth.ts";
import { BALLOTS, kellyRows, loadKellyInputs } from "../lib/hunt/coverage-matrix.ts";

const ROOT = process.cwd();

/**
 * @freshness-reads-here — the day an expiry is compared AGAINST, never a value
 * written into a freshness field.
 *
 * From `scripts/doc-dates.mjs` rather than a local `Intl.DateTimeFormat`:
 * a second copy of the Phoenix formatter is a duplicate implementation
 * (RULING 103), and the two would drift the first time one was corrected.
 */
const TODAY = today();

/**
 * **THE LOADING AND THE LOOP MOVED TO `lib/hunt/coverage-matrix.ts`.**
 * (2026-08-25, Item 12.)
 *
 * `pnpm matrix` must produce a Kelly verdict equal to this scoreboard's
 * EXACTLY. Two programs computing one judgement is the thing that can disagree
 * — RULING 103 — and `kellyFieldHeld`'s own note records that two such
 * implementations already did disagree once here. So there is one loader and
 * one loop, and both callers use them; the matrix does not agree with this
 * scoreboard, it IS this scoreboard.
 */
const ZIP = (process.argv.find((a) => a.startsWith("--zip=")) ?? "--zip=07866").slice(
  "--zip=".length,
);
if (!BALLOTS[ZIP]) {
  console.error(`pnpm kelly --zip=<${Object.keys(BALLOTS).join("|")}>`);
  process.exit(2);
}

const inputs = loadKellyInputs(ROOT, ZIP);
const ballot = { contests: inputs.contests, candidacies: inputs.candidacies };
const rows: KellyReading[] = kellyRows(inputs, TODAY);
const absencesOnFile = inputs.absenceCount;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ measuredOn: TODAY, total: rows.length, rows }, null, 1));
  process.exit(0);
}

const done = rows.filter((r) => r.done).length;
console.log(`KELLY DEPTH at ${inputs.label} — RULING 143, measured ${TODAY}\n`);
console.log(
  "  The five Kelly fields are photo, phone, contact, a specific verified page and a\n" +
    "  campaign site. That is NOT the four-field denominator earlier NH reports used\n" +
    "  (photo, own words, contact, site), and the two numbers are different measurements\n" +
    "  of different things — stated rather than reconciled, because a single figure in\n" +
    "  front of two measurements is the shape the two-numbers rule forbids.\n",
);
console.log(`  ${done} of ${rows.length} candidates are DONE (every field held or argued absent)`);
console.log(`  ${rows.length - done} still owe at least one field\n`);

console.log("  per field — HELD / ARGUED ABSENT / OWED, each of " + rows.length);
for (const f of KELLY_FIELDS) {
  const h = rows.filter((r) => r.fields[f].state === "HELD").length;
  const a = rows.filter((r) => r.fields[f].state === "ARGUED_ABSENT").length;
  const o = rows.filter((r) => r.fields[f].state === "OWED").length;
  console.log(`    ${f.padEnd(14)} ${String(h).padStart(4)} / ${String(a).padStart(4)} / ${String(o).padStart(4)}`);
}

const voided = rows.flatMap((r) =>
  KELLY_FIELDS.filter((f) => {
    const s = r.fields[f];
    return s.state === "OWED" && /^(VOID|STALE)/.test(s.why);
  }).map((f) => ({ subject: r.subject, field: f, why: (r.fields[f] as { why: string }).why })),
);
console.log(
  `\n  absence records on file: ${absencesOnFile} · returned to OWED as void or stale: ${voided.length}`,
);
for (const v of voided.slice(0, 20)) console.log(`    ${v.subject} · ${v.field} · ${v.why.slice(0, 90)}`);

if (process.argv.includes("--owed")) {
  console.log("\n  STILL OWED, by candidate:");
  for (const r of rows.filter((x) => !x.done)) {
    console.log(`    ${r.subject.padEnd(34)} ${r.owed.join(", ")}`);
  }
}
