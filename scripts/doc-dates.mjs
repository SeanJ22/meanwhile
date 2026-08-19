/**
 * The date scanner shared by `tests/doc-dates.test.ts` and the pre-commit
 * hook (`.githooks/pre-commit`).
 *
 * It exists because of the defect that named it: `CLAUDE.md` carried three
 * rules stamped "Adopted 2026-08-16", "2026-08-17" and "2026-08-19", all of
 * them later than the file's own last modification and later than every
 * commit in the repo. Nobody typed a wrong date; an agent produced a
 * *plausible* one instead of reading one. A fabricated stamp is not a
 * cosmetic error in this project — a date is a claim about when a decision
 * was made, and a document full of unearned claims is the same failure mode
 * the tracker rules exist to prevent.
 *
 * Two consumers, one scanner, deliberately: a rule enforced by two
 * independently-written checks drifts, and the version that drifts is always
 * the one that stops failing.
 *
 * The timezone is load-bearing. `new Date().toISOString().slice(0, 10)` reads
 * a day ahead of `America/Phoenix` after 5pm local, which is this bug's
 * smaller sibling and would let a stamp written this evening pass as
 * yesterday's. Everything here compares against the Phoenix day.
 */

import { readFileSync } from "node:fs";

/** Any ISO-ish date this millennium. Deliberately blunt — it is a net. */
export const DATE_RE = /20\d\d-\d\d-\d\d/g;

/**
 * Today in `America/Phoenix`, `YYYY-MM-DD`.
 *
 * `en-CA` formats as ISO, which is the only reason it is used here; the
 * locale is a formatting trick, not a claim about where anyone is.
 */
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Every date in a plain-text or Markdown body, with its 1-based line number.
 */
export function scanText(text) {
  const lines = text.split("\n");
  const hits = [];
  let line = 1;
  let cursor = 0;
  DATE_RE.lastIndex = 0;
  for (const match of text.matchAll(DATE_RE)) {
    const at = match.index;
    for (let i = cursor; i < at; i++) if (text[i] === "\n") line++;
    cursor = at;
    // R16: a date on an annotated line is an expected future, not a
    // tolerated one. Per LINE, because that is the unit a reader sees the
    // annotation in — an annotation three paragraphs away would excuse
    // dates nobody meant it to cover.
    hits.push({
      date: match[0],
      line,
      expected: isExpectedFutureLine(lines[line - 1]),
    });
  }
  return hits;
}

/**
 * A CSV reader that keeps physical line numbers.
 *
 * `docs/tracker.csv` has quoted Notes fields running to hundreds of
 * characters with embedded commas and newlines, so a `split(",")` reader is
 * wrong twice over — it mis-columns the row *and* reports a line number that
 * points at nothing. Records are returned with the physical line each field
 * started on, which is what a failure message has to cite to be actionable.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let fieldLine = 1;
  let line = 1;
  let quoted = false;
  let started = false;

  const endField = () => {
    row.push({ value: field, line: fieldLine });
    field = "";
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!started) {
      fieldLine = line;
      started = true;
    }

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\r") continue;
    else if (ch === "\n") {
      endField();
      rows.push(row);
      row = [];
      line++;
    } else field += ch;
  }

  if (started || row.length > 0) {
    endField();
    rows.push(row);
  }

  return rows;
}

/**
 * Dates in the free-prose columns of the tracker.
 *
 * Only Notes and Detail are scanned: those are the columns a person writes
 * sentences into, and therefore the ones a fabricated stamp lands in. Target
 * is excluded on purpose — it holds intended future dates, which is the
 * whole point of a target.
 */
export function scanTrackerCsv(text, columns = ["Notes", "Detail"]) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((c) => c.value.trim());
  const indices = columns
    .map((name) => ({ name, index: header.indexOf(name) }))
    .filter((c) => c.index !== -1);

  const hits = [];
  for (const row of rows.slice(1)) {
    for (const { name, index } of indices) {
      const cell = row[index];
      if (!cell) continue;
      for (const hit of scanText(cell.value)) {
        hits.push({
          date: hit.date,
          line: cell.line + hit.line - 1,
          column: name,
          // R16: in a CSV prose column an HTML comment would render as text,
          // so the bracketed form is used and it must TRAIL the date it
          // annotates — a Notes cell can run to hundreds of characters and
          // hold several dates, and a marker anywhere in the cell would
          // excuse all of them.
          expected: isExpectedFutureLine(
            cell.value.slice(
              cell.value.indexOf(hit.date),
              cell.value.indexOf(hit.date) + 160,
            ),
          ),
        });
      }
    }
  }
  return hits;
}

/**
 * Read the allowlist out of `tests/doc-dates.test.ts`.
 *
 * The list is a literal at the top of the test file because that is where a
 * person looking for "why is this future date tolerated" will look for it.
 * The hook needs the same list, and duplicating it would guarantee the two
 * disagree — so the hook reads the test's copy rather than keeping one.
 *
 * Extraction is deliberately dumb: everything between the `ALLOWLIST = [`
 * marker and its closing `];`, matched for `{ file, date, count }` triples.
 * A malformed or missing list throws — the hook fails closed. A check that
 * quietly passes when it cannot find its own rules is not a check.
 */
export function readAllowlist(path) {
  return parseAllowlistSource(readFileSync(path, "utf8"), path);
}

/**
 * The same extraction, against text already in hand — which is what the
 * pre-commit hook needs, because it must read the list out of the STAGED
 * copy of the test file rather than the one on disk.
 *
 * 2026-08-19 (g20): this used to be a second implementation living in
 * `scripts/check-staged-dates.mjs`. The header above says duplicating the
 * list would guarantee the two disagree — and the PARSER was duplicated,
 * which is the same defect one level down. It bit exactly as predicted:
 * `readAllowlist` was taught to tell an empty list from a broken parse, the
 * hook's private copy was not, and the hook refused the very commit that
 * emptied the list. One implementation now, imported by both.
 */
export function parseAllowlistSource(source, label) {
  // The marker tolerates a TYPE ANNOTATION between the name and the `=`.
  // An empty literal has no element type for TypeScript to infer, so the
  // declaration needs one — and a strict `indexOf("ALLOWLIST = [")` would
  // then stop finding its own list, which is the check silently losing its
  // rules rather than failing on them.
  const opener = /ALLOWLIST(?:\s*:[^=\n]*)?\s*=\s*\[/.exec(source);
  const start = opener ? opener.index : -1;
  if (start === -1) {
    throw new Error(`${label}: no ALLOWLIST literal found — cannot check anything`);
  }
  const end = source.indexOf("\n];", start);
  if (end === -1) {
    throw new Error(`${label}: ALLOWLIST literal is not closed`);
  }
  const block = source.slice(start, end);

  const entries = [];
  const entryRe =
    /file:\s*"([^"]+)"[\s\S]*?date:\s*"(\d{4}-\d{2}-\d{2})"[\s\S]*?count:\s*(\d+)/g;
  for (const m of block.matchAll(entryRe)) {
    entries.push({ file: m[1], date: m[2], count: Number(m[3]) });
  }
  // 2026-08-19 (g20): "zero entries means the extractor broke" was true for
  // as long as the list was expected to hold something, and it stopped being
  // true the day the last entry's date passed and the list emptied honestly.
  // The two cases have to be told apart, or the hook fails closed on the
  // healthiest possible state — nothing tolerated at all.
  //
  // The discriminator is the block's own text: an entry that failed to parse
  // still leaves its `file:` key behind, so `file:` present with no entry
  // extracted is a real extraction failure and still throws. `file:` absent
  // means the literal is genuinely empty, which is legitimate and is asserted
  // as such in tests/doc-dates.test.ts.
  if (entries.length === 0 && /\bfile:/.test(block)) {
    throw new Error(`${label}: ALLOWLIST parsed to zero entries — extraction is broken`);
  }
  return entries;
}

/**
 * Split a file's hits into allowed and failing.
 *
 * An allowlist entry carries a count, and the count is the point: it pins the
 * inventory as it stood when the entry was written, so re-using an already
 * tolerated date to write a *new* fabricated stamp still fails. Tolerating a
 * string forever would have made the allowlist a hole rather than a record.
 */
export function classify(hits, allowlist, file, todayStr) {
  const budget = new Map();
  for (const entry of allowlist) {
    if (entry.file !== file) continue;
    budget.set(entry.date, (budget.get(entry.date) ?? 0) + entry.count);
  }

  const expected = [];
  const allowed = [];
  const failures = [];
  for (const hit of hits) {
    if (hit.date <= todayStr) continue;
    // R16: an annotated date is a different species and leaves the budget
    // entirely. See EXPECTED_FUTURE_RE.
    if (hit.expected) {
      expected.push({ ...hit, file });
      continue;
    }
    const left = budget.get(hit.date) ?? 0;
    if (left > 0) {
      budget.set(hit.date, left - 1);
      allowed.push({ ...hit, file });
    } else {
      failures.push({ ...hit, file });
    }
  }
  return { expected, allowed, failures };
}

/**
 * The marker that says "this date is SUPPOSED to be in the future" (R16,
 * 2026-08-15).
 *
 * The inventory this scan found was never one thing. Election day is a date
 * that will postdate every scan until it happens, and warning about it every
 * run — forever, until November — teaches a reader to ignore the warning,
 * which is the only way this check can actually fail. Session-label residue
 * is the opposite: unexplained, and the reason the check exists.
 *
 * So an expected-future date is ANNOTATED, on its own line, with the reason
 * and the source it was verified against:
 *
 *   The general election is **2026-11-03** <!-- expected-future: general
 *   election day, verified against the Arizona Secretary of State's 2026
 *   election calendar, 2026-08-15 -->
 *
 * The annotation lives in the document rather than in a registry beside it
 * on purpose. A reader who wonders why a future date is tolerated finds the
 * answer where the date is, and the two cannot drift apart — which is
 * exactly what a second list would eventually do.
 *
 * The marker takes an HTML comment in Markdown and a bracketed form in the
 * tracker's prose columns, where an HTML comment would render as text.
 * Both require a non-empty reason: a bare marker would be an escape hatch,
 * and this project does not keep those.
 */
export const EXPECTED_FUTURE_RE =
  /(?:<!--\s*expected-future:\s*\S[^>]*-->|\[expected-future:\s*\S[^\]]*\])/i;

/** Does this line carry an expected-future annotation? */
export function isExpectedFutureLine(line) {
  return EXPECTED_FUTURE_RE.test(line ?? "");
}

/**
 * Files whose future dates are their subject rather than a defect.
 *
 * Exactly one, and it earns it: `docs/stamp-audit.md` is the report generated
 * by `pnpm verify-stamps`, and quoting the three fabricated stamps is the
 * only thing it does. Scanning the audit for the dates it exists to name
 * would fail the suite for doing its job.
 */
export const SCAN_EXEMPT = ["docs/stamp-audit.md"];
