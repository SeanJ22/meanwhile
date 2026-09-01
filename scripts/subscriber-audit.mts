/**
 * **THE SUBSCRIBER SWEEP INSTRUMENT.** (Part A remainder of `WGH-22`,
 * 2026-08-31.)
 *
 * `WGH-22` fixed ONE store that wrote without publishing to its subscribers.
 * That is a CLASS, not an instance, and a class needs a DENOMINATOR: how many
 * browser-stored values this tree has, how many of them are read through
 * `useSyncExternalStore`, and which of those can be moved by a mutation the
 * subscriber never hears about.
 *
 * ## Why this is a script and not a ripgrep line
 *
 * Two ways a text sweep reports "nothing found" without having looked, both
 * already paid for in this repository:
 *
 * - **ripgrep skips hidden paths**, so a subscriber under a dot-directory is
 *   invisible to `rg` and present in the bundle.
 * - **a source file holding a literal NUL byte is classified BINARY and
 *   skipped SILENTLY.** Both ballot pick surfaces used to join their snapshot
 *   keys on a literal NUL, which is exactly a file on the ballot surface that
 *   no class sweep could see.
 *
 * So the file list comes from `git ls-files` plus the untracked set — an
 * untracked file is invisible to every repo sweep until it is added — and each
 * file is read as BYTES and decoded, never classified. The counts this prints
 * are the denominator, and they are printed rather than asserted so the number
 * in a session report is the number the tree produced.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Tracked plus untracked, because an untracked file is in no repo sweep. */
function sourceFiles(): string[] {
  // `execFileSync` throws past its 1 MB default buffer and a catch-all would
  // turn that into a false fact about the tree, so the buffer is raised rather
  // than the failure swallowed.
  const listed = execFileSync(
    "git",
    ["-C", ROOT, "ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\.(ts|tsx|mts|js|jsx)$/.test(line))
    .filter((line) => !line.startsWith("node_modules/"));
}

/**
 * The SHIPPED client graph — the only place a missed notification can reach a
 * reader. `scripts/` drives browsers and seeds storage through `page.evaluate`,
 * and `tests/` stubs it; both mutate storage constantly and neither has a
 * subscriber to fail to notify. Excluding them is a scope statement, so it is
 * printed with the counts rather than hidden inside them.
 */
const SHIPPED = /^(app|components|hooks|lib)\//;

export interface SubscriberFinding {
  file: string;
  /** `useSyncExternalStore(` call sites in this file. */
  subscriberCalls: number;
  /** It hands a subscribe function that can never fire. */
  inertSubscribe: boolean;
  /** It writes to `localStorage`/`sessionStorage`. */
  mutates: boolean;
  /** It publishes to a listener set or dispatches a same-tab event. */
  publishes: boolean;
}

const CALL = /useSyncExternalStore\s*\(/g;
/**
 * `setItem` and `removeItem` are Storage-only names. An earlier draft also
 * matched `.clear(`, which is a `Map` and `Set` method — it put five files that
 * never touch browser storage on the silent-mutator list, and a denominator
 * with five wrong rows in it is a wrong denominator.
 */
const MUTATION = /\.(setItem|removeItem)\s*\(/;
const PUBLISH =
  /(for\s*\(\s*const\s+\w+\s+of\s+\[?\.{0,3}listeners\]?\s*\)|dispatchEvent\s*\(|publishToListeners\s*\(|publishStorageEvent\s*\(|commitStorageWrite\s*\(|publish\s*\(\s*\)|notify\s*\(\s*\))/;
/**
 * A subscribe argument that subscribes to nothing: a `const` bound to
 * `() => () => {}`.
 *
 * Anchored on the ASSIGNMENT rather than on the name. An earlier draft matched
 * the bare identifiers `emptySubscribe` and `noSubscribe`, which made every doc
 * comment that NAMES the defect it removed read as the defect — the file fixed
 * in this pass reported itself, because its comment explains what it used to
 * hand `useSyncExternalStore`.
 */
const INERT = /(?:const|let)\s+\w+\s*=\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{\s*\}/;

/** Comments stripped, for the same reason `tests/read-code.ts` strips them. */
function codeOnly(text: string): string {
  return text
    .replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), " ")
    .replace(new RegExp("(^|[^:])//[^\\n]*", "gm"), "$1 ");
}

/**
 * Two files that HOLD the defect text on purpose and would report themselves:
 * this one names every pattern it hunts, and the proof script reintroduces two
 * defects to watch the guards go red.
 */
const SELF = new Set([
  "scripts/subscriber-audit.mts",
  "scripts/prove-subscriber-guards.mts",
]);

export function auditSubscribers(files: string[]): SubscriberFinding[] {
  const out: SubscriberFinding[] = [];
  for (const file of files) {
    if (SELF.has(file)) continue;
    // Bytes, then decode. A file is never classified before it is read.
    const text = codeOnly(readFileSync(path.join(ROOT, file)).toString("utf8"));
    const calls = text.match(CALL);
    const mutates = MUTATION.test(text);
    if (!calls && !mutates) continue;
    out.push({
      file,
      subscriberCalls: calls ? calls.length : 0,
      inertSubscribe: (calls?.length ?? 0) > 0 && INERT.test(text),
      mutates,
      publishes: PUBLISH.test(text),
    });
  }
  return out;
}

function main(): void {
  const files = sourceFiles();
  const findings = auditSubscribers(files);
  const withCalls = findings.filter((f) => f.subscriberCalls > 0);
  const calls = withCalls.reduce((n, f) => n + f.subscriberCalls, 0);
  const mutators = findings.filter((f) => f.mutates && SHIPPED.test(f.file));
  const silentMutators = mutators.filter((f) => !f.publishes);
  const inert = withCalls.filter((f) => f.inertSubscribe);

  const lines: string[] = [];
  lines.push(`files scanned (tracked + untracked, bytes-decoded): ${files.length}`);
  lines.push(`files with a useSyncExternalStore call: ${withCalls.length}`);
  lines.push(`useSyncExternalStore call sites: ${calls}`);
  lines.push(`shipped-graph files that mutate browser storage: ${mutators.length}`);
  lines.push(`  of those, with no same-tab publish: ${silentMutators.length}`);
  lines.push(`subscriber files handing an inert subscribe: ${inert.length}`);
  lines.push("");
  lines.push("SUBSCRIBER CALL SITES");
  for (const f of withCalls.sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(
      `  ${f.file}  calls=${f.subscriberCalls}` +
        `${f.inertSubscribe ? "  INERT_SUBSCRIBE" : ""}` +
        `${f.mutates ? "  mutates" : ""}` +
        `${f.publishes ? "  publishes" : ""}`,
    );
  }
  lines.push("");
  lines.push("SHIPPED-GRAPH STORAGE MUTATORS WITH NO SAME-TAB PUBLISH");
  for (const f of silentMutators.sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(`  ${f.file}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
