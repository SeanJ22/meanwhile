import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { today } from "../scripts/doc-dates.mjs";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

/**
 * F01-continued session 2, item 0B (2026-08-19) — a document that dates
 * itself in the wrong zone.
 *
 * `scripts/photo-census.mts` stamped its own section with
 * `new Date().toISOString().slice(0, 10)`. That is UTC, and Phoenix is
 * UTC−7 all year, so for the seven hours after 5pm local the script wrote
 * TOMORROW'S DATE onto a document about what is true today. It wrote
 * "2026-08-20" at 18:19 on 2026-08-19. <!-- expected-future: the wrong date the UTC bug produced, quoted as evidence -->
 *
 * `CLAUDE.md` is explicit that this is not a cosmetic slip: a date is a claim
 * about when something was measured, and an agent that produces a plausible
 * one instead of reading one has done the same thing as generating a
 * candidate position. `pnpm stamp` exists for exactly this, and nothing
 * audited whether the doc-writing scripts used it.
 *
 * Two checks, because there are two ways to get it wrong: computing the day
 * in the wrong zone, and keeping a private copy of the right computation that
 * is free to drift from it.
 */

const ROOT = join(import.meta.dirname, "..");

/** Every script that writes or appends a file. */
function documentWritingScripts(): string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT, paths: ["scripts"] })
    .filter((f) => /\.(mts|mjs|ts)$/.test(f))
    .filter((f) => {
      const s = readFileSync(join(ROOT, f), "utf8");
      return /writeFileSync|appendFileSync/.test(s);
    });
}

test("0B: no document-writing script derives its day from a UTC slice", () => {
  const scripts = documentWritingScripts();
  // The denominator, stated — a scan over an empty corpus passes forever.
  assert.ok(
    scripts.length > 10,
    `only ${scripts.length} document-writing scripts found — the scan lost its corpus`,
  );

  const offenders: string[] = [];
  for (const file of scripts) {
    const text = readFileSync(join(ROOT, file), "utf8");
    text.split("\n").forEach((line, i) => {
      // Skip the prose: several of these files EXPLAIN the defect, and a
      // check that flags its own explanation is a check somebody switches
      // off. `trimStart` rather than a regex over the whole line — the files
      // are CRLF, and in JavaScript `.` does not match `\r`, so a `.*$`
      // strip silently does nothing on every line of them.
      const lead = line.trimStart();
      if (lead.startsWith("//") || lead.startsWith("*") || lead.startsWith("/*")) return;
      if (/toISOString\(\)\s*\.?\s*slice\(\s*0\s*,\s*10\s*\)/.test(line)) {
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "a UTC slice reads a day ahead of America/Phoenix after 5pm local, so a " +
      "document stamped this way claims to describe tomorrow:\n" +
      offenders.join("\n"),
  );
});

test("0B: the Phoenix day is never ahead of the day a UTC slice would write", () => {
  // The concrete instant the defect was caught at: 2026-08-20T01:19Z is
  // 18:19 on 2026-08-19 in Phoenix. UTC says the 20th; Phoenix says the 19th.
  const evening = new Date("2026-08-20T01:19:00Z");
  assert.equal(today(evening), "2026-08-19");
  assert.equal(evening.toISOString().slice(0, 10), "2026-08-20");

  // And it holds at the edges rather than only at one convenient instant.
  // 07:00Z is exactly midnight Phoenix; 06:59:59Z is still the day before.
  assert.equal(today(new Date("2026-08-20T07:00:00Z")), "2026-08-20");
  assert.equal(today(new Date("2026-08-20T06:59:59Z")), "2026-08-19");

  // Phoenix does not observe DST, so the same holds in January.
  assert.equal(today(new Date("2026-01-15T06:59:59Z")), "2026-01-14");
  assert.equal(today(new Date("2026-01-15T07:00:00Z")), "2026-01-15");
});

test("0B: no script keeps its own private copy of the Phoenix formatter", () => {
  // Four scripts carried byte-identical copies of the same eight-line
  // `today()`. All four were correct on the day they were written, which is
  // the point: N copies of a rule is N places for it to drift, and the copy
  // that drifts is the one that stops disagreeing with anything.
  const scripts = filesThatWouldBeCommitted({ cwd: ROOT, paths: ["scripts"] })
    .filter((f) => /\.(mts|mjs|ts)$/.test(f));

  const offenders: string[] = [];
  for (const file of scripts) {
    // `scripts/doc-dates.mjs` is the module that owns the zone, and
    // `scripts/stamp.mts` is the CLI over it — they are the definition, not
    // a copy of it.
    if (file === "scripts/doc-dates.mjs" || file === "scripts/stamp.mts") continue;
    const text = readFileSync(join(ROOT, file), "utf8");
    if (/timeZone:\s*"America\/Phoenix"/.test(text)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these scripts compute the Phoenix day themselves instead of importing " +
      "`today` from scripts/doc-dates.mjs:\n" +
      offenders.join("\n"),
  );
});
