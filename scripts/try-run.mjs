import { execFileSync } from "node:child_process";

/**
 * **A COMMAND WHOSE FAILURE IS AN ANSWER RATHER THAN A CRASH.**
 *
 * One implementation. It was written twice — `scripts/handoff.mjs` and
 * `scripts/session-start.mjs` — and `tests/duplicate-implementations.json`
 * carried the pair as a recorded group. RULING 103: the cheapest way to have no
 * duplicate is to move the original rather than keep two careful copies.
 *
 * ## `maxBuffer` IS A CORRECTNESS SETTING HERE, NOT A TUNING KNOB
 *
 * Node defaults `execFileSync`'s `maxBuffer` to 1 MB, and output past it makes
 * the call THROW — which this function catches and turns into `null`. A caller
 * reading `null` as *that version does not match* is then reading a buffer limit
 * as a fact about a file.
 *
 * That is exactly what happened on 2026-08-25. `docs/state.md` had grown past a
 * megabyte, so every `git show <rev>:docs/state.md` in the handoff's mirror
 * guard threw, every revision was skipped, and the guard reported **state.md
 * matches no version in this file's history — not overwritten, diff it by hand**
 * about a mirror copy that is BYTE-IDENTICAL to `5ddf038`. It failed the
 * handoff, which under RULING 75 is a gate.
 *
 * It would have begun the day `state.md` crossed a megabyte and would only get
 * worse, because `state.md` only grows — RULING 106 removed its cap on purpose,
 * and the limit it eventually hit was one nobody had written down.
 * `docs/tracker.csv` is over a megabyte too.
 *
 * 256 MB, because the thing being read is a committed document: the failure mode
 * of a too-small buffer is a silent wrong answer, and the failure mode of a
 * large one is memory this process has anyway.
 *
 * @param {string} cmd
 * @param {readonly string[]} args
 * @param {Parameters<typeof execFileSync>[2] & { cwd?: string }} [opts]
 * @returns {string | null} trimmed stdout, or `null` if the command failed
 */
export function tryRun(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}
