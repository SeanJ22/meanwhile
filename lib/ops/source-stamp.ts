/**
 * **A GENERATOR'S STAMP IS CARRIED FROM ITS SOURCES, NEVER READ OFF THE CLOCK.**
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
 * ## Why the git commit date
 *
 * It is the day the data entered this repo — which for a committed corpus IS
 * the carried read stamp, because nothing about the file has changed since. It
 * is deterministic, identical on every machine, and it moves only when the data
 * moves. That is exactly the property the purity check needs and exactly the
 * meaning the freshness rule wants.
 *
 * ## There is no clock fallback, and that is the point
 *
 * Where git cannot answer, this THROWS. Filling in a plausible date is the
 * fabrication rule, and it is precisely what the lines this replaces did on
 * every single run.
 */
import { execFileSync } from "node:child_process";

/**
 * The newest commit date across a generator's committed inputs, `YYYY-MM-DD`.
 *
 * The NEWEST, because an artifact is only as current as its most recently
 * updated input — taking the oldest would understate it and taking an average
 * would be a number describing nothing.
 */
export function carriedSourceStamp(files: readonly string[], cwd = process.cwd()): string {
  if (files.length === 0) {
    throw new Error(
      "carriedSourceStamp was given no source files. A stamp carried from nothing is a stamp " +
        "invented, which is the failure this function exists to prevent.",
    );
  }

  const dates: string[] = [];
  for (const file of files) {
    let out: string;
    try {
      out = execFileSync("git", ["log", "-1", "--format=%ad", "--date=short", "--", file], {
        cwd,
        encoding: "utf8",
      }).trim();
    } catch (e) {
      throw new Error(
        `could not ask git for the commit date of ${file}: ${(e as Error).message}. ` +
          "There is no clock fallback here — a plausible date is a fabrication " +
          "(CLAUDE.md, the date rule).",
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) {
      throw new Error(
        `git returned no commit date for ${file}. Either the path is wrong or the file is ` +
          "untracked; both are worth knowing about, and neither is worth a guessed date.",
      );
    }
    dates.push(out);
  }
  return dates.sort()[dates.length - 1];
}
