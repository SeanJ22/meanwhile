import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 6b (wall clock 2026-08-14 second session): reader-facing dates must be
 * wall clock. The Booker card's citation read "read 2026-08-17" — a
 * future date — because the session-label convention (sequence labels
 * that ran ahead of the clock, state.md §18) leaked into curated
 * provenance fields. The sweep mapped labels to real dates via git
 * history (08-15/16 → 08-13; 08-17/18/19 → 08-14) and this guard keeps
 * it fixed: a provenance claim ("we read/collected/verified this on X")
 * can never be later than today. Event dates — meetings, elections —
 * are legitimately in the future and are not provenance.
 */

const ROOT = join(import.meta.dirname, "..");

/** Field names that claim WHEN WE did something. */
const PROVENANCE_FIELDS = [
  "collectedAt",
  "verifiedAt",
  "readAt",
  "retrievedAt",
  "attemptedAt",
  "curatedAt",
  "writtenAt",
  "checkedAt",
  "issuedAt",
  "generatedAt",
];

const FIELD_RE = new RegExp(
  `["']?(?:${PROVENANCE_FIELDS.join("|")})["']?\\s*[:=]\\s*["'](\\d{4}-\\d{2}-\\d{2})`,
  "g",
);
/** Prose provenance: "read 2026-08-14", "Fetched 2026-08-13". */
const PROSE_RE = /\b(?:read|Fetched|fetched)\s+(\d{4}-\d{2}-\d{2})/g;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      yield* walk(path);
    } else if (/\.(ts|tsx|json)$/.test(name)) {
      yield path;
    }
  }
}

test("no provenance date anywhere in lib/, data/, app/, or components/ is in the future", () => {
  const today = new Date().toISOString().slice(0, 10);
  let checked = 0;
  for (const base of ["lib", "data", "app", "components"]) {
    for (const file of walk(join(ROOT, base))) {
      const source = readFileSync(file, "utf8");
      for (const re of [FIELD_RE, PROSE_RE]) {
        re.lastIndex = 0;
        for (const match of source.matchAll(re)) {
          checked++;
          assert.ok(
            match[1] <= today,
            `${file}: provenance date ${match[1]} is in the future — a claim about work not yet done`,
          );
        }
      }
    }
  }
  // The denominator: the scan must actually find provenance fields — a
  // regex that silently matched nothing would pass while checking
  // nothing. Hundreds exist today.
  assert.ok(checked > 200, `only ${checked} provenance dates scanned — the sweep broke`);
});
