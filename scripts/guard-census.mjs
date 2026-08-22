/**
 * **RULING 62 — A TEST FILE MAY NOT LOSE GUARDS SILENTLY** (built 2026-08-21,
 * NH Hunt 6 item 1).
 *
 * ## What went wrong
 *
 * A session wrote `tests/<name>.test.ts` for a new guard. A file of that name
 * already existed, so the write REPLACED it, and eight unrelated guards stopped
 * existing. `pnpm test` reported `fail 0` — because a deleted test is not a
 * failing test. It is not a test. Every other protection in this project runs
 * through that suite, so a guard vanishing unnoticed silently weakens all of
 * them, and the suite is constitutionally unable to report it.
 *
 * ## Why the test COUNT is too weak an instrument on its own
 *
 * Three reasons, and any one of them is enough:
 *
 * 1. **The count moves for legitimate reasons.** Every session that adds a
 *    guard moves it. A number that changes on every normal commit cannot be an
 *    alarm — it is noise, and the one commit where it moved for a bad reason
 *    looks exactly like the twenty where it moved for a good one.
 * 2. **A count is blind to substitution.** The write that caused this deleted
 *    eight guards and added guards of its own. Had it added eight, the total
 *    would have been IDENTICAL and the loss undetectable by arithmetic.
 * 3. **A count says nothing about WHICH.** Even a drop only tells you a number
 *    got smaller. It cannot name what stopped running, so it cannot be acted on
 *    without a hunt through the history — which is what it cost last time.
 *
 * **Names are the instrument. The count is a summary of the instrument.**
 *
 * ## The mechanism
 *
 * `tests/guard-census.json` is a COMMITTED census: every test file, and every
 * guard NAME inside it. `tests/guard-census.test.ts` recomputes the census from
 * the filesystem on every run and fails when a recorded name is no longer
 * there.
 *
 * The census is not a lock — a guard is allowed to leave. It makes leaving
 * **EXPLICIT**, which is the whole of RULING 62:
 *
 * - An ACCIDENT — an overwrite, a bad merge, a file deleted — does not touch
 *   the census, so the suite goes red and NAMES every guard that stopped
 *   running. That is the case this exists for, and it is the case a count
 *   cannot see.
 * - A DELIBERATE removal runs `pnpm guard:census --write`, which prints every
 *   name it is about to drop and refuses to drop any without `--allow-removals`.
 *   The census diff then carries the removed names as deleted lines, in the
 *   same commit as the removal, where a reader sees them.
 *
 * So the census cannot silently agree with a silent deletion: making it agree
 * is itself a diff that says which guards left.
 *
 * ## What counts as a guard
 *
 * A `test(...)`, `it(...)` or `describe(...)` call with a string literal name,
 * plus their `.only` / `.skip` / `.todo` forms. Names are recorded per file and
 * sorted, so reordering a file is not a change. A dynamically-named test (a
 * template literal with an interpolation, a variable) has no stable name and is
 * counted but not named — the file's `dynamic` count carries it, and a drop in
 * that number fails the same way.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CENSUS_PATH = join(ROOT, "tests", "guard-census.json");
const TESTS_DIR = join(ROOT, "tests");

/** Every `*.test.ts` under `tests/`, repo-relative and slash-separated. */
export function testFiles(dir = TESTS_DIR) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...testFiles(full));
      continue;
    }
    if (entry.endsWith(".test.ts")) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out.sort();
}

/*
 * `test`, `it` and `describe`, optionally suffixed with a modifier, followed by
 * an opening paren and a string literal. Anchored at a line start (allowing
 * indentation) so the word `test` inside prose or inside an identifier is not a
 * hit.
 */
const NAMED =
  /^[ \t]*(?:test|it|describe)(?:\.(?:only|skip|todo|concurrent))?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gm;
const ANY_CALL = /^[ \t]*(?:test|it|describe)(?:\.(?:only|skip|todo|concurrent))?\(/gm;

/** The guard names and the dynamic-guard count for one file's source. */
export function guardsIn(source) {
  const names = [];
  for (const m of source.matchAll(NAMED)) {
    // A backtick name carrying an interpolation has no stable identity.
    if (m[1] === "`" && m[2].includes("${")) continue;
    names.push(m[2]);
  }
  const total = [...source.matchAll(ANY_CALL)].length;
  return { names: names.slice().sort(), dynamic: total - names.length };
}

/** Recompute the whole census from what is on disk right now. */
export function computeCensus() {
  const files = {};
  for (const file of testFiles()) {
    files[file] = guardsIn(readFileSync(join(ROOT, file), "utf8"));
  }
  return files;
}

export function readCensus() {
  if (!existsSync(CENSUS_PATH)) return null;
  return JSON.parse(readFileSync(CENSUS_PATH, "utf8"));
}

/**
 * What the recorded census has that the filesystem no longer does.
 *
 * Deliberately one-directional: a guard ADDED is never a problem and never
 * blocks anything, and a rule that made it one would be a rule against writing
 * tests. Only losses are reported.
 */
export function lostGuards(recorded, computed) {
  const losses = [];
  for (const [file, entry] of Object.entries(recorded.files ?? {})) {
    const now = computed[file];
    if (!now) {
      losses.push({ file, kind: "file-gone", names: entry.names, dynamic: entry.dynamic ?? 0 });
      continue;
    }
    const missing = entry.names.filter((n) => !now.names.includes(n));
    const dynamicLost = Math.max(0, (entry.dynamic ?? 0) - (now.dynamic ?? 0));
    if (missing.length > 0 || dynamicLost > 0) {
      losses.push({ file, kind: "guards-gone", names: missing, dynamic: dynamicLost });
    }
  }
  return losses;
}

export function totals(files) {
  let named = 0;
  let dynamic = 0;
  for (const entry of Object.values(files)) {
    named += entry.names.length;
    dynamic += entry.dynamic ?? 0;
  }
  return { files: Object.keys(files).length, named, dynamic };
}

/* ─────────────────────────────── CLI ────────────────────────────────────── */

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split(sep).join("/").replace(/^[A-Za-z]:/, ""));

if (invokedDirectly) {
  const write = process.argv.includes("--write");
  const allowRemovals = process.argv.includes("--allow-removals");
  const computed = computeCensus();
  const recorded = readCensus();
  const t = totals(computed);

  if (!recorded) {
    if (!write) {
      console.error("no census recorded — run: corepack pnpm guard:census --write");
      process.exit(1);
    }
  } else {
    const losses = lostGuards(recorded, computed);
    if (losses.length > 0) {
      console.log("GUARDS THAT STOPPED EXISTING — RULING 62\n");
      for (const loss of losses) {
        console.log(`  ${loss.file}  (${loss.kind})`);
        for (const n of loss.names) console.log(`      ${n}`);
        if (loss.dynamic > 0) console.log(`      + ${loss.dynamic} dynamically-named`);
      }
      console.log("");
      if (write && !allowRemovals) {
        console.error(
          "REFUSED. Rewriting the census would erase the record that these guards\n" +
            "existed. If the removal is intended, re-run with --allow-removals so the\n" +
            "names above land in the census diff where a reader sees them.",
        );
        process.exit(1);
      }
      if (!write) process.exit(1);
    } else if (!write) {
      console.log(`census clean — ${t.files} files, ${t.named} named guards, ${t.dynamic} dynamic`);
    }
  }

  if (write) {
    const payload = {
      note:
        "RULING 62. Every test file and every guard NAME inside it. A guard that " +
        "leaves must leave HERE too, in the same commit, so the removal is a diff " +
        "a reader sees rather than a silence. Written by corepack pnpm guard:census " +
        "--write; never by hand.",
      totals: t,
      files: computed,
    };
    writeFileSync(CENSUS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`census written — ${t.files} files, ${t.named} named guards, ${t.dynamic} dynamic`);
  }
}
