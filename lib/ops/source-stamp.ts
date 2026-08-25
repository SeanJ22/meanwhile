/**
 * **A GENERATOR'S STAMP IS DECLARED AND VERIFIED, NEVER READ OFF THE CLOCK.**
 * (2026-08-24. RULING 107, applied to the generators rather than to the
 * register they write into.)
 *
 * ## The class this closes, measured rather than asserted
 *
 * `lib/ops/generated-register.ts` declares 7 of its 15 artifacts **PURE** —
 * reproducible from committed inputs — and `tests/generated-artifacts.test.ts`
 * holds each one byte-identical to what its generator produces now. **2 of
 * those 7 called `today()`**, so their output moved every day on its own and
 * the purity check could only pass on the day somebody last ran them. It failed
 * the first time a date rolled over mid-session, which is how the class was
 * found.
 *
 * That is two separate defects wearing one line of code:
 *
 * 1. **The artifact is not reproducible.** A "pure" generator whose output
 *    changes without its inputs changing is not pure, and a byte-identity test
 *    over it is a test that fails for the wrong reason and gets ignored.
 * 2. **The date claims a currency the data does not have.** RULING 107 keeps
 *    two kinds of date apart: a READ stamp answers *how current is this DATA*
 *    and is mintable only from evidence of a read or CARRIED from one; a RUN
 *    stamp answers *when did this PROGRAM run* and **may never be written into
 *    a freshness field**. A generator over committed inputs that prints today
 *    is a run stamp doing a read stamp's job.
 *
 * `build-nj-rosters.mts` had the sharper form of the second: `collectedAt:
 * page?.walkedAt ?? AS_OF` — a freshness field falling back to the clock, so a
 * roster page with no recorded walk date got today's, and a record nobody had
 * read since it was committed would have read as walked this morning. RULING 53
 * exists because a confident wrong date is worse than `UNKNOWN`: a missing date
 * sends a session back to the source, and a wrong one stops it permanently.
 *
 * ## THE FIRST FIX WAS WRONG IN THE SAME WAY, AND CI CAUGHT IT
 *
 * This function originally asked git: `git log -1 --format=%ad -- <file>`, the
 * day the data last changed in the repo. That is the right IDEA and it produced
 * the right answer on a developer's machine.
 *
 * **`actions/checkout` clones with `fetch-depth: 1`.** On a shallow clone there
 * is exactly one commit in history, so `git log -1 -- <any file>` returns the
 * TIP's date for every file — today's — and returns it with no error and no
 * warning. `main` went red at `a6c72a7` with the artifact stamped `2026-08-20`
 * locally and regenerated as `2026-08-24` on the runner.
 *
 * **So the first fix committed the exact failure its own docstring warns
 * about**: a confident wrong date, produced by a mechanism that cannot tell it
 * is wrong. The lesson is not "check for shallow clones". It is that **a stamp
 * derived from the environment can be wrong in an environment nobody tested**,
 * and a stamp that is DECLARED cannot.
 *
 * ## What it does now
 *
 * The date is **declared beside the sources it describes**, in the generator,
 * as a constant. It is deterministic on every machine and in every clone depth
 * because it is not derived from anything.
 *
 * `verifyAgainstGit` is the belt: where full history IS available it checks the
 * declaration against what git says and reports a disagreement. It **returns a
 * verdict rather than throwing**, and it says `UNVERIFIABLE` on a shallow clone
 * instead of guessing — which is the whole distinction this file is about.
 */
import { execFileSync } from "node:child_process";

/** A declared source-read stamp: the day the committed inputs were read. */
export interface DeclaredStamp {
  /** `YYYY-MM-DD`. Declared, never derived. */
  readOn: string;
  /** The committed files it describes, repo-relative. */
  sources: readonly string[];
}

/**
 * The declared stamp, shape-checked.
 *
 * The only thing that can go wrong with a declared constant is that somebody
 * types it wrong, so that is the only thing checked — and it FAILS rather than
 * coercing, because a malformed date silently becoming a valid-looking one is
 * how this whole class of defect works.
 */
export function declaredSourceStamp(stamp: DeclaredStamp): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp.readOn)) {
    throw new Error(
      `declared source stamp "${stamp.readOn}" is not a YYYY-MM-DD date. It is DECLARED rather ` +
        "than derived precisely so it cannot be wrong by accident, and a malformed one is not " +
        "rounded into a plausible one (CLAUDE.md, the date rule).",
    );
  }
  if (stamp.sources.length === 0) {
    throw new Error(
      "a declared source stamp names no source files. A stamp that describes nothing is a stamp " +
        "nobody can check.",
    );
  }
  return stamp.readOn;
}

export type GitVerdict =
  /** Git has full history and agrees with the declaration. */
  | {
      kind: "AGREES";
      newest: string;
      /**
       * The declaration is the day BEFORE the newest commit — a session that
       * read the source and committed after midnight. Stated rather than
       * smoothed, so a reader can tell an exact match from a tolerated one.
       */
      oneDayBehind?: true;
    }
  /** Git has full history and disagrees. The declaration still wins; this reports. */
  | { kind: "DISAGREES"; newest: string; declared: string }
  /**
   * Git cannot answer, so nothing is claimed either way.
   *
   * A shallow clone is the live case and it is NOT an error: `actions/checkout`
   * uses `fetch-depth: 1` by default, so CI is always here. Reporting
   * `UNVERIFIABLE` is the point — the alternative is a check that reads as
   * passing while measuring nothing (RULING 24's could-not-tell).
   */
  | { kind: "UNVERIFIABLE"; why: string };

/** Whether this clone has enough history for a per-file `git log` to mean anything. */
export function isShallowClone(cwd = process.cwd()): boolean {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd,
        encoding: "utf8",
      }).trim() === "true"
    );
  } catch {
    return true;
  }
}

/**
 * Check a declared stamp against git, where git can answer.
 *
 * Deliberately NOT used to produce the value. It exists so a declaration that
 * has drifted from its data can be noticed on a machine that has the history,
 * without the artifact's contents ever depending on clone depth.
 */
export function verifyAgainstGit(stamp: DeclaredStamp, cwd = process.cwd()): GitVerdict {
  if (isShallowClone(cwd)) {
    return {
      kind: "UNVERIFIABLE",
      why: "this is a shallow clone — `git log -1 -- <file>` returns the TIP's date for every file here",
    };
  }
  const dates: string[] = [];
  for (const file of stamp.sources) {
    let out: string;
    try {
      out = execFileSync("git", ["log", "-1", "--format=%ad", "--date=short", "--", file], {
        cwd,
        encoding: "utf8",
      }).trim();
    } catch (e) {
      return { kind: "UNVERIFIABLE", why: `git failed on ${file}: ${(e as Error).message}` };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) {
      return { kind: "UNVERIFIABLE", why: `git returned no commit date for ${file}` };
    }
    dates.push(out);
  }
  // The NEWEST, because an artifact is only as current as its most recently
  // updated input.
  const newest = dates.sort()[dates.length - 1];
  return judgeStamp(stamp.readOn, newest);
}

/**
 * The verdict, as a pure function of the two dates — the ONLY place the
 * comparison is made, so no caller can arrive at a different answer.
 *
 * ## A COMMIT DATE IS NOT A READ DATE, AND A SESSION THAT CROSSES MIDNIGHT PROVES IT
 *
 * A read always precedes the commit that carries it, so the two agree only when
 * both land on the same calendar day. The unattended sessions this repo runs
 * routinely do not. On 2026-08-25 the NJ depth session walked 39 municipal
 * sites, wrote `walkedAt: "2026-08-24"` into the artifact from evidence of the
 * read, and committed at 00:38 America/Phoenix — so git said 2026-08-25 while
 * the declaration said 2026-08-24. Nothing had drifted. The guard was measuring
 * the distance to midnight, and it took the whole local suite red.
 *
 * So a declaration ONE DAY BEHIND the newest commit is the ordinary case and is
 * reported as agreement, with `oneDayBehind` set so a reader can tell a
 * tolerated match from an exact one. Two days behind is drift and still fails,
 * because the tolerance is for a clock boundary rather than for a stale
 * declaration.
 *
 * **The other direction is never tolerated, at any distance.** A declaration
 * NEWER than any commit claims a read whose evidence is not in the tree, and
 * that is the fabrication direction RULING 107 exists to refuse: a confident
 * wrong date does not merely fail to help, it suppresses the re-walk that would
 * have caught the staleness.
 */
export function judgeStamp(declared: string, newest: string): GitVerdict {
  if (newest === declared) return { kind: "AGREES", newest };
  if (dayBefore(newest) === declared) {
    return { kind: "AGREES", newest, oneDayBehind: true };
  }
  return { kind: "DISAGREES", newest, declared };
}

/** The calendar day before `YYYY-MM-DD`, as `YYYY-MM-DD`. */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
