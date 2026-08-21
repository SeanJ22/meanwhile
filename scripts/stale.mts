/**
 * `pnpm stale` — **RULING 53: recorded absences expire.** (NH Hunt 3,
 * 2026-08-21.)
 *
 * An absence is a measurement with a shelf life, not a conclusion. This reads
 * every dated measurement the product holds in a machine-readable place and
 * reports which are past their window, so re-walking is driven by the data
 * rather than by whoever happens to remember.
 *
 * Run:
 *   pnpm stale                 # the report
 *   pnpm stale --json          # the same, as data
 *   pnpm stale --asof=<iso>    # as it would have read on that day
 *
 * ## Why this reports and does not re-walk
 *
 * Re-walking is a hunt, and a hunt is a session's work with a session's
 * judgement in it. What was missing was not the walking — it was anything at
 * all that could say WHICH records were owed one. Kearsarge's board emails sat
 * recorded-absent through two sessions because nothing anywhere said the
 * measurement had aged.
 *
 * ## What it deliberately does NOT do
 *
 * It does not mark anything, edit anything, or downgrade anything. **Stale is
 * not wrong.** A stale record is a record whose claim on being current has
 * lapsed; the record itself stands until somebody re-walks it and writes down
 * what they found. Silently demoting a fact because it aged would be the
 * render-default failure with a calendar attached.
 *
 * ## The honest limit, stated rather than implied
 *
 * It sees dated measurements in the places listed in `SOURCES` below and
 * nowhere else. Prose in `docs/` carrying dates in sentences is not read — a
 * regex over English would produce a number nobody could check, and a number
 * nobody can check is worse here than an absent one. What is NOT covered is
 * printed on every run, because a coverage gap that is not stated reads as
 * coverage.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RECALL_WINDOW_DAYS,
  type RecallKind,
  staleness,
} from "../lib/hunt/discovery.ts";
import { today } from "./doc-dates.mjs";

const JSON_OUT = process.argv.includes("--json");
const asofArg = process.argv.find((a) => a.startsWith("--asof="));
const AS_OF = asofArg ? asofArg.slice("--asof=".length) : today();

if (!/^\d{4}-\d{2}-\d{2}$/.test(AS_OF)) {
  console.error(`stale: --asof must be YYYY-MM-DD, got ${JSON.stringify(AS_OF)}`);
  process.exit(2);
}

interface Measurement {
  what: string;
  kind: RecallKind;
  checkedAt: string | null;
}

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** Where dated measurements live, and what kind of thing each one measures. */
const SOURCES: { label: string; collect: () => Measurement[] }[] = [
  {
    label: "source wiring rows (lib/registry/source-wiring.ts)",
    collect: () => {
      /*
       * Read as SOURCE, deliberately. Importing the module would drag the whole
       * registry graph — and node:fs with it — into a script whose only job is
       * to read dates. The shape is `verifiedAt: "YYYY-MM-DD"` beside a
       * `bodyId`, and both are pinned by `tests/stale.test.ts`.
       */
      const src = read("lib", "registry", "source-wiring.ts");
      const out: Measurement[] = [];
      let lastBody = "(unnamed row)";
      for (const line of src.split("\n")) {
        const body = /bodyId:\s*$|bodyId:\s*"([^"]+)"/.exec(line);
        if (body?.[1]) lastBody = body[1];
        else if (/"(ocd-division[^"]+)"/.test(line) && lastBody === "(unnamed row)") {
          lastBody = /"(ocd-division[^"]+)"/.exec(line)?.[1] ?? lastBody;
        }
        const v = /verifiedAt:\s*"(\d{4}-\d{2}-\d{2})"/.exec(line);
        if (v) {
          out.push({ what: lastBody, kind: "bodyOrRoster", checkedAt: v[1]! });
          lastBody = "(unnamed row)";
        }
      }
      return out;
    },
  },
  {
    label: "candidate hunt state (data/ballot/candidate-hunt-state.json)",
    collect: () => {
      const file = JSON.parse(read("data", "ballot", "candidate-hunt-state.json")) as {
        candidates: Record<string, Record<string, { state: string; checkedAt?: string }>>;
      };
      const out: Measurement[] = [];
      for (const [candidate, fields] of Object.entries(file.candidates ?? {})) {
        for (const [field, record] of Object.entries(fields)) {
          /*
           * WHICH STATES ARE MEASUREMENTS, AND WHY FOUND JOINED THEM.
           * (NH Hunt 5, 2026-08-21.)
           *
           * NOT_HUNTED is still excluded and the original reasoning holds: it
           * was never a measurement, so it is owed a FIRST walk rather than a
           * re-walk, and counting it here would drown the signal in 406 rows
           * that this instrument has nothing to say about.
           *
           * FOUND was excluded too, silently, and that was wrong. A found
           * field IS a measurement — "this candidate's campaign site was at
           * this URL on the day we looked" — and RULING 53 gives candidate
           * fields a seven-day window precisely because campaign sites go
           * down, photos get pulled, and phone numbers get disconnected
           * between a filing deadline and an election. A FOUND record that
           * has aged past its window has the same problem a stale absence
           * has: it no longer carries a claim on being current.
           *
           * The visible symptom of the exclusion was this source reporting
           * "0 stale of 0 measured" while holding 544 field records — a
           * zero-row read presented as a clean board, which is the shape this
           * repo has now sighted six times.
           */
          if (record.state === "NOT_HUNTED") continue;
          out.push({
            what: `${candidate} · ${field} [${record.state}]`,
            kind: "candidateField",
            checkedAt: record.checkedAt ?? null,
          });
        }
      }
      return out;
    },
  },
];

/** Named on every run, because a coverage gap that is not stated reads as coverage. */
const NOT_COVERED = [
  "prose in docs/ carrying dates in sentences — a regex over English would " +
    "produce a number nobody could check",
  "docs/source-ladder.md attemptedAt entries — per-body evidence, not a " +
    "machine-readable store yet",
  "officials rosters — verifiedAt is per officeholder and lives in the " +
    "generated registry files; wiring it here needs the roster build to carry it",
];

const rows: { source: string; m: Measurement; stale: boolean; ageDays: number | null }[] = [];
const unreadable: string[] = [];

for (const source of SOURCES) {
  let found: Measurement[];
  try {
    found = source.collect();
  } catch (error) {
    // COULD NOT READ is not "nothing stale". They print differently.
    unreadable.push(`${source.label}: ${(error as Error).message.split("\n")[0]}`);
    continue;
  }
  for (const m of found) {
    const s = staleness(m.kind, m.checkedAt, AS_OF);
    rows.push({ source: source.label, m, stale: s.stale, ageDays: s.ageDays });
  }
}

const stale = rows.filter((r) => r.stale);

if (JSON_OUT) {
  console.log(JSON.stringify({ asOf: AS_OF, windows: RECALL_WINDOW_DAYS, rows, unreadable }, null, 1));
  process.exit(unreadable.length > 0 ? 2 : 0);
}

console.log(`\nstale — RULING 53, as of ${AS_OF}\n`);
console.log(
  `  windows: candidate fields ${RECALL_WINDOW_DAYS.candidateField}d · ` +
    `bodies and rosters ${RECALL_WINDOW_DAYS.bodyOrRoster}d · ` +
    `walled sources ${RECALL_WINDOW_DAYS.walledSource}d\n`,
);

for (const source of SOURCES) {
  const mine = rows.filter((r) => r.source === source.label);
  const s = mine.filter((r) => r.stale);
  // The PAIR, always — a bare "3 stale" hides whether that is 3 of 4 or 3 of 400.
  console.log(`  ${s.length} stale of ${mine.length} measured — ${source.label}`);
}

if (unreadable.length > 0) {
  console.log(`\n  COULD NOT READ ${unreadable.length} source(s) — not a clean board:`);
  for (const u of unreadable) console.log(`    ${u}`);
}

if (stale.length > 0) {
  console.log(`\n  PAST THEIR WINDOW — re-walk before relying on these:\n`);
  for (const r of stale.slice(0, 40)) {
    const age = r.ageDays === null ? "no readable date" : `${r.ageDays}d old`;
    console.log(`    ${age.padEnd(18)} ${r.m.what}`);
  }
  if (stale.length > 40) {
    // A deliberate clip is stated with both numbers so it does not read as the total.
    console.log(`    … and ${stale.length - 40} more, of ${stale.length} stale in all`);
  }
}

console.log(`\n  NOT COVERED by this instrument, so the number above is a floor:`);
for (const gap of NOT_COVERED) console.log(`    - ${gap}`);

console.log(`\n  TOTAL: ${stale.length} stale of ${rows.length} dated measurement(s) read.\n`);

// Stale is not a failure. It is work. Exit 0 unless something could not be read.
process.exit(unreadable.length > 0 ? 2 : 0);
