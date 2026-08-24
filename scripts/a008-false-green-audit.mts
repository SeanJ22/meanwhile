/**
 * A-008 · HOW MANY OF THE LAST 20 GREEN READINGS ON `main` WERE FALSE?
 *
 * Session: audit-remediation-0824. Claim served: the close-out figure "N of 20
 * recent GREENs were false", required by the brief's Item 1 after the release
 * gate's false-green path was found and fixed.
 *
 * The gate at `scripts/main-green.mjs` discarded its stillborn list unless
 * EVERY check on a commit was stillborn, so one required check that executed
 * zero steps beside one that passed returned `green`. This walks the recent
 * history of `main`, asks GitHub for each commit's check runs, and replays BOTH
 * verdict functions against the same bytes:
 *
 *   old — the shipped logic, reimplemented here EXACTLY as it was, read out of
 *         `git show 336a3eb:scripts/main-green.mjs`. It is reimplemented rather
 *         than imported because importing the fixed module cannot answer a
 *         question about the broken one, and checking out an old file to run it
 *         would be a worse kind of guess.
 *   new — the shipped fix, IMPORTED, so the comparison cannot drift from what
 *         actually runs.
 *
 * A commit is a FALSE GREEN when old says green and new does not.
 *
 * Every commit is reported, including the ones with no checks at all — a
 * denominator that silently drops the awkward rows is the partial this repo
 * names most often (RULING 100).
 */
import { spawnSync } from "node:child_process";

import { neverStarted, verdictFromCheckRuns } from "./main-green.mjs";

const REPO = "SeanJ22/we-the-people";
/**
 * `indexOf` returns -1 when the flag is absent, and `argv[-1 + 1]` is the node
 * binary's own path — which is truthy, so a `||` default never fires and
 * `Number()` of it is NaN. The first version of this file shipped that and git
 * refused `--max-count=NaN`, which surfaced as "could not read origin/main":
 * an argument bug wearing a wall's clothing.
 */
const countAt = process.argv.indexOf("--count");
const WANTED = countAt === -1 ? 20 : Number(process.argv[countAt + 1]);

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string;
  completed_at?: string;
  steps?: unknown[];
}

function run(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? "").trim();
}

/**
 * THE SHIPPED LOGIC, AS IT WAS. Copied from `336a3eb:scripts/main-green.mjs`,
 * verbatim in structure — the only edit is TypeScript parameter types.
 *
 * `neverStarted` is IMPORTED rather than copied: the fix did not touch it, and
 * a second copy of it here would be a duplicate implementation (RULING 103)
 * that could drift and quietly make this audit wrong.
 */
function oldVerdict(checkRuns: CheckRun[]): string {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) return "unknown";
  const stillborn = checkRuns.filter(neverStarted).map((c) => c.name);
  if (stillborn.length > 0 && stillborn.length === checkRuns.length) return "unknown";
  const pending = checkRuns.filter((c) => c.status !== "completed");
  const failed = checkRuns.filter(
    (c) =>
      c.status === "completed" &&
      !["success", "neutral", "skipped"].includes(c.conclusion as string) &&
      !neverStarted(c),
  );
  if (failed.length > 0) return "red";
  if (pending.length > 0) return "pending";
  return "green";
}

const log = run("git", [
  "log",
  "--first-parent",
  `--max-count=${WANTED * 3}`,
  "--format=%H %s",
  "origin/main",
]);
if (log === null) {
  console.error("could not read origin/main — this audit did not run");
  process.exit(2);
}

const rows: {
  sha: string;
  subject: string;
  old: string;
  next: string;
  stillborn: string[];
  checks: number;
}[] = [];

for (const line of log.split("\n")) {
  if (rows.filter((r) => r.old === "green").length >= WANTED) break;
  const sha = line.slice(0, 40);
  const subject = line.slice(41);
  const out = run("gh", [
    "api",
    `repos/${REPO}/commits/${sha}/check-runs`,
    "--jq",
    "[.check_runs[] | {name, status, conclusion, started_at, completed_at, steps: (.steps // [])}]",
  ]);
  if (out === null) {
    rows.push({ sha, subject, old: "could-not-ask", next: "could-not-ask", stillborn: [], checks: 0 });
    continue;
  }
  let runs: CheckRun[];
  try {
    runs = JSON.parse(out);
  } catch {
    rows.push({ sha, subject, old: "unparseable", next: "unparseable", stillborn: [], checks: 0 });
    continue;
  }
  rows.push({
    sha,
    subject,
    old: oldVerdict(runs),
    next: verdictFromCheckRuns(runs).verdict,
    stillborn: runs.filter(neverStarted).map((c) => c.name),
    checks: runs.length,
  });
}

const greens = rows.filter((r) => r.old === "green");
const falseGreens = greens.filter((r) => r.next !== "green");

console.log(`\nA-008 · replaying ${rows.length} commit(s) on origin/main\n`);
for (const r of rows) {
  const flag = r.old === "green" && r.next !== "green" ? "FALSE GREEN" : "";
  console.log(
    `  ${r.sha.slice(0, 8)}  old=${r.old.padEnd(13)} new=${r.next.padEnd(13)} checks=${String(r.checks).padStart(2)}  ${flag}  ${r.subject.slice(0, 58)}`,
  );
  if (r.stillborn.length > 0) console.log(`            never started: ${r.stillborn.join(", ")}`);
}

console.log(
  `\n  ${falseGreens.length} of ${greens.length} GREEN reading(s) were FALSE — a required check had executed nothing.`,
);
console.log(
  `  ${rows.length - greens.length} commit(s) in the window were not green under the old logic and are not part of that denominator.`,
);
