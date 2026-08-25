/**
 * The failing run's own last words, turned into something a reader starts warm
 * from. (Adopted 2026-08-25, the one-session brief item 2.)
 *
 * ## Why this is a module and not four lines inside the watcher
 *
 * RULING 101's reasoning, applied again: a helper that lives inside a script
 * which can only be exercised by calling the GitHub API is a helper nothing
 * tests. The **shaping** of a log tail is pure — bytes in, bytes out — so it
 * lives here and `tests/watch-workflows.test.ts` walks it against a recorded
 * log. Only the `gh` call stays in the script.
 *
 * ## What Sean's complaint actually asked for
 *
 * "Night jobs keep tripping and nobody learns why." A row naming the run id and
 * the failing step is a row that tells a reader WHERE to go looking. It does
 * not tell them what happened, so every diagnosis starts by fetching a log —
 * which is the cost that makes the next occurrence start from the same nothing
 * `JOB03` was opened over.
 *
 * ## Three disciplines the shaping has to keep
 *
 * 1. **A tail that could not be read is not an empty tail** (RULING 24). The
 *    caller distinguishes them; this module refuses to invent either.
 * 2. **A partial tail says it is partial** (RULING 100). The row states how
 *    many lines the run printed and how many are shown, so a reader can never
 *    mistake twelve lines for the whole story.
 * 3. **Nothing printed may carry a credential value** (RULING 127). The
 *    redaction is the caller's, applied to this module's output before it
 *    reaches a row; the shaping never widens a line past its cap, which is the
 *    other way a secret escapes a truncating reader.
 */

/** Lines shown in a row. Enough to carry a stack or a refusal, short enough to read. */
export const TAIL_LINES = 14;

/** Per-line cap. A single 4,000-character JSON blob is not a readable tail. */
export const TAIL_LINE_CHARS = 240;

export interface ShapedTail {
  /** The lines to show, oldest first. */
  lines: string[];
  /** How many meaningful lines the run printed in total. */
  totalLines: number;
  /** True when `lines` is fewer than `totalLines` — stated, never implied. */
  clipped: boolean;
  /**
   * Lines that NAME the failure, wherever in the log they sit.
   *
   * The tail alone is not enough and the first live run proved it: the daily
   * refresh printed 1,842 lines, and the last fourteen were a node stack trace
   * while the sentence a reader needs — the assertion message — sat a screen
   * above the window. A tail is where a failure ENDS; it is not reliably where
   * a failure is EXPLAINED.
   */
  causes: string[];
}

/**
 * What a line that names a failure looks like. **Shapes, not strings**
 * (RULING 110): `##[error]` is a shape, and so is "an assertion that failed" —
 * neither is the particular words any one job happens to use.
 */
const CAUSE_SHAPES = [
  /^##\[error\]/,
  /\bAssertionError\b/,
  /^\s*Error:/,
  /\bELIFECYCLE\b/,
  /\bFAILED\b/,
  /\brefused\b/i,
  /\bHTTP [45]\d\d\b/,
  /\bexit code \d+/,
];

/**
 * Lines that can never be the naming of a failure, however cause-shaped they
 * look. Both were found by running this against the real log rather than by
 * reasoning about it (RULING 110's other half — show the instrument working).
 *
 * - A **stack frame** is a consequence of a failure, never the naming of one.
 * - A **PASSING TEST** is the loud case: `✔ PLANTED: a readonly connection
 *   string in the RIGHT variable is refused` matches the `refused` shape
 *   perfectly and is a guard reporting success. The first live run surfaced
 *   four of those and pushed the real assertion to the bottom of the list.
 */
const NOT_A_CAUSE = [
  /^\s*at\s/,
  // node:test's pass/skip/info glyphs, and TAP's `ok`.
  /^\s*[✔✓ℹ]/,
  /^\s*ok\s+\d+/,
];

export const CAUSE_LINES = 5;

/**
 * `gh run view --log` emits `<job>\t<step>\t<ISO timestamp> <message>`. Strip
 * the scaffolding so the row carries the message and not the transport.
 *
 * The timestamp is dropped rather than kept: every line of one run carries
 * nearly the same one, so fourteen of them spend a third of the width on
 * information the run id already gives.
 */
export function stripLogScaffolding(line: string): string {
  // The job and step columns, when present. `--log-failed` sometimes reports
  // the step as the literal `UNKNOWN STEP`, which is still a column.
  let out = line.replace(/^[^\t]*\t[^\t]*\t/, "");
  // A BOM survives the first line of a `gh` log and renders as a stray glyph.
  out = out.replace(/^﻿/, "");
  // The leading ISO timestamp GitHub stamps on every line.
  out = out.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/, "");
  // ANSI colour, which reads as `^[[36;1m` in a CSV cell.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\[[0-9;]*m/g, "");
  return out.trimEnd();
}

/**
 * Lines that say nothing about why a job failed. Post-job cleanup is the
 * largest single block in a failed run's log and it is identical every time —
 * a tail made of it is a tail that has told the reader nothing, which is the
 * exact failure this upgrade exists to end.
 */
const NOISE = [
  /^\[command\]\/usr\/bin\/git /,
  /^Post job cleanup\.?$/,
  /^Cleaning up orphan processes$/,
  /^Removing (SSH command configuration|HTTP extra header|credentials config)/,
  /^Removing includeIf entries/,
  /^includeif\.gitdir:/,
  /^Temporarily overriding HOME=/,
  /^Adding repository directory to the temporary git global config/,
  /^git version /,
  /^\/home\/runner\/work\/_temp\/git-credentials-/,
  /^\/github\/runner_temp\/git-credentials-/,
];

function isNoise(line: string): boolean {
  return NOISE.some((re) => re.test(line));
}

/**
 * Shape a raw `gh run view --log` payload into a readable tail.
 *
 * Returns `null` for input carrying no meaningful line at all. That is a
 * DISTINCT answer from "could not read", which the caller owns — this module
 * never converts one into the other (RULING 24, and the render-default rule
 * one floor down).
 */
export function shapeFailureTail(
  raw: string,
  { lines: want = TAIL_LINES, lineChars = TAIL_LINE_CHARS }: { lines?: number; lineChars?: number } = {},
): ShapedTail | null {
  const meaningful = raw
    .split(/\r?\n/)
    .map(stripLogScaffolding)
    .filter((l) => l.trim() !== "")
    .filter((l) => !isNoise(l));

  if (meaningful.length === 0) return null;

  const cap = (l: string): string => (l.length > lineChars ? `${l.slice(0, lineChars - 1)}…` : l);
  const tail = meaningful.slice(-want).map(cap);

  /*
   * The LAST few cause-shaped lines, deduped, and never one already visible in
   * the tail — repeating a line a reader can already see spends the row's width
   * on nothing.
   */
  const inTail = new Set(tail);
  const causes: string[] = [];
  for (let i = meaningful.length - 1; i >= 0 && causes.length < CAUSE_LINES; i -= 1) {
    const line = meaningful[i];
    if (NOT_A_CAUSE.some((re) => re.test(line))) continue;
    if (!CAUSE_SHAPES.some((re) => re.test(line))) continue;
    const capped = cap(line);
    if (inTail.has(capped) || causes.includes(capped)) continue;
    causes.push(capped);
  }
  causes.reverse();

  return { lines: tail, totalLines: meaningful.length, clipped: meaningful.length > tail.length, causes };
}

/**
 * Render a shaped tail as the sentence a tracker row carries.
 *
 * The clip is STATED with both numbers rather than implied by an ellipsis —
 * the two-numbers rule, applied to a log excerpt. A reader who cannot tell a
 * fourteen-line run from the last fourteen lines of a nine-hundred-line one
 * has been handed a partial that reconciles.
 */
export function renderFailureTail(tail: ShapedTail | null, unreadableReason?: string): string {
  if (unreadableReason) {
    // RULING 24: a check that could not reach its subject must never print
    // like one that did. This is not "the run printed nothing".
    return `The run's log COULD NOT BE READ (${unreadableReason}), so this row carries no tail. That is a fact about this watcher, not about the run.`;
  }
  if (!tail) {
    return "The run's log was read and carried no meaningful line — it died before anything printed.";
  }
  const header = tail.clipped
    ? `The last ${tail.lines.length} of ${tail.totalLines} line(s) the run printed:`
    : `All ${tail.totalLines} line(s) the run printed:`;
  const body = `${header}\n${tail.lines.map((l) => `  | ${l}`).join("\n")}`;
  if (tail.causes.length === 0) return body;
  return `The line(s) that NAME the failure:\n${tail.causes.map((l) => `  ! ${l}`).join("\n")}\n\n${body}`;
}

/**
 * The whole job, minus the network. `fetchLog` is injected so a test can walk
 * this against a recorded log — the seam RULING 130 asks for, declared rather
 * than discovered.
 */
export function failureTail(runId: number, fetchLog: (runId: number) => string): string {
  let raw: string;
  try {
    raw = fetchLog(runId);
  } catch (error) {
    return renderFailureTail(null, (error as Error).message.split("\n")[0].slice(0, 160));
  }
  return renderFailureTail(shapeFailureTail(raw));
}
