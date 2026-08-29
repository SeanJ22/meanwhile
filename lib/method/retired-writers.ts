/**
 * **RETIRING A WRITER THAT WOULD RE-SEED A CORRECTED CONCLUSION.** (2026-08-28.)
 *
 * ## The defect, and why duplicate-id protection was not the fix
 *
 * `scripts/learn-schedule-vs-events.mts` seeded two real routes on 2026-08-28
 * and wrote a substantive conclusion into their prose that the same day proved
 * false: that Pima County's September sittings existed only as a recurring rule
 * and were not individually published, and that one route's reconciled window
 * was complete rather than merely untruncated. Both were withdrawn properly, in
 * `lib/method/pima-claim-classes.ts`, as typed C and D claims with successors.
 *
 * The script stayed executable. The argument that it was harmless is that
 * `learnRoute` refuses a duplicate id, so re-running it against today's
 * populated store changes nothing — and that argument is true and does not
 * cover the cases that matter. **It is an argument about ONE store's current
 * contents, not about the writer.** A fresh store, a migration, a test copy, a
 * replay, or a future control-plane import that offers those routes to an empty
 * or legacy-shaped store all take the `learned` branch, and the false sentence
 * lands as current project knowledge with no retraction attached to it — because
 * a retraction lives on a claim, and the seeded prose carries no claims at all.
 *
 * A writer whose safety depends on the store already containing its output is
 * not safe. It is one `emptyKnowledge()` away from teaching a false fact about a
 * government, which is the failure the root constitution says this product
 * cannot survive.
 *
 * ## Why hard retirement rather than a corrected replay
 *
 * The alternative was to convert the script into a replay that seeds only valid
 * A/B observations plus typed SUPERSEDED C/D history. That work is already done
 * and already has an owner: `pnpm method:learn-legistar-insite` writes the
 * corrected route knowledge, and `pnpm method:amend-claim-classes-pima` writes
 * the typed classification and the two retractions. Rebuilding either inside a
 * second script would give one canonical store two independent writers of the
 * same facts, which is the shape `CLAUDE.md` refuses in as many words, and it
 * would leave a reader with two commands and no way to tell which is current.
 *
 * **So there is ONE OBVIOUS CURRENT COMMAND, and the retired path points at it
 * instead of running.** Nothing is deleted: the routes, their outcomes, their
 * sub-branches and the withdrawn claims all stay in the canonical store exactly
 * as recorded, and the original script's text stays in git history where a
 * superseded thing belongs.
 *
 * The refusal exits non-zero and writes nothing. It is deliberately loud: a
 * retired writer that printed a warning and then ran would be worse than one
 * that never warned, because it would look supervised.
 */

import { stripComments } from "../ops/duplicate-implementations.ts";

/** One retired writer, described well enough that its refusal teaches. */
export interface RetiredWriter {
  /** The command as a person types it, e.g. `pnpm method:learn-schedule-vs-events`. */
  command: string;
  /** The script file, so the refusal is traceable to a path. */
  scriptPath: string;
  /** ISO date, from `pnpm stamp`. */
  retiredOn: string;
  /**
   * What this writer would assert that is FALSE, described rather than quoted.
   *
   * Described on purpose. Re-embedding the exact superseded sentences here would
   * put the text back on an executable path and back in front of every
   * repository sweep that greps for it — the thing this retirement exists to
   * stop. The exact wording is preserved, typed and retracted, on the claims
   * named below.
   */
  falseAssertions: string[];
  /** The claim ids carrying the withdrawn text and its correction. */
  supersededClaims: string[];
  /** THE ONE CURRENT COMMAND for this knowledge. */
  currentCommand: string;
  /** Any second command that completes the current path. */
  alsoRun: string[];
  /** Where a consumer reads what it inherits, instead of running a writer. */
  readInstead: string;
}

/**
 * **THE PIMA SCHEDULE-VS-EVENTS WRITER.**
 *
 * Retired because it seeds two substantive assertions that were corrected the
 * same day they were written. The routes themselves were never wrong and are
 * still in project knowledge, still inherited, still usable.
 */
export const SCHEDULE_VS_EVENTS_RETIRED: RetiredWriter = {
  command: "pnpm method:learn-schedule-vs-events",
  scriptPath: "scripts/learn-schedule-vs-events.mts",
  retiredOn: "2026-08-28",
  falseAssertions: [
    "that Pima County's September 2026 sittings existed only as a recurring rule on the county's own site and were not individually published anywhere — all three were individually published on the county's Legistar InSite portal at the time, one of them a Study Session the rule text could not have produced",
    "that the gap was the publisher's rather than the route's — it was the route's; the vendor's own web UI held the sittings its API could not return",
    "that a reconciled fetched/normalized denominator established the window as complete rather than merely untruncated — reconciling proves nothing was DROPPED and never proves enough was ASKED FOR (RULING 100)",
  ],
  supersededClaims: [
    "body-publishes-its-schedule-separately-from-its-agendas#pima-september-only-as-rule (CORRECTED)",
    "reconcile-the-adapter-before-suspecting-it#pima-window-complete (SUPERSEDED)",
    "vendor-api-and-vendor-web-ui-are-different-records#pima-september-individually-published (the current truth)",
    "reconciled-is-not-complete#reconciliation-answers-loss-not-sufficiency (the current truth)",
  ],
  currentCommand: "pnpm method:learn-legistar-insite",
  alsoRun: ["pnpm method:amend-claim-classes-pima"],
  readInstead:
    "projectMethodFor() in lib/method/projection.ts — the method-inheritance read path, which hands over route identity, observations as tuples, and only the substantive claims whose retraction and validation state permit inheritance",
};

/**
 * The refusal, as a string, so a test can assert on it without spawning a
 * process and a caller can print it however it likes.
 */
export function retiredWriterRefusal(w: RetiredWriter): string {
  const lines: string[] = [
    "=".repeat(74),
    `REFUSED — ${w.command} IS RETIRED (${w.retiredOn}). NOTHING WAS WRITTEN.`,
    "=".repeat(74),
    "",
    `  ${w.scriptPath}`,
    "",
    "  It would seed substantive assertions that were CORRECTED the same day they",
    "  were written. Duplicate-id protection makes a re-run harmless against a store",
    "  that already holds them; it does nothing for a fresh, migrated, replayed or",
    "  test-copied store, where the false text lands as current with no retraction",
    "  attached to it — a retraction lives on a claim, and seeded prose carries none.",
    "",
    "  WHAT IT WOULD ASSERT THAT IS FALSE:",
  ];
  for (const f of w.falseAssertions) lines.push(`    - ${f}`);
  lines.push("", "  WHERE THE WITHDRAWN TEXT AND ITS CORRECTION ACTUALLY LIVE, TYPED:");
  for (const c of w.supersededClaims) lines.push(`    - ${c}`);
  lines.push(
    "",
    "  THE ONE CURRENT COMMAND FOR THIS KNOWLEDGE:",
    `    ${w.currentCommand}`,
  );
  for (const a of w.alsoRun) lines.push(`    ${a}`);
  lines.push(
    "",
    "  TO READ WHAT A WORKER INHERITS, DO NOT RUN A WRITER AT ALL:",
    `    ${w.readInstead}`,
    "",
    "  Nothing was deleted. The routes, their outcomes and their sub-branches remain",
    "  in data/method/knowledge.json exactly as recorded, and this script's original",
    "  text remains in git history, which is where a superseded thing belongs.",
    "=".repeat(74),
  );
  return lines.join("\n");
}

/**
 * Print the refusal and stop with a non-zero status.
 *
 * `process.exitCode` plus a thrown error rather than `process.exit()`, so the
 * stream is flushed before the process ends and a caller that imports this
 * module in-process gets an exception rather than a silently killed test runner.
 */
export function refuseRetiredWriter(w: RetiredWriter): never {
  console.error(retiredWriterRefusal(w));
  process.exitCode = 1;
  throw new Error(`${w.command} is retired (${w.retiredOn}); run ${w.currentCommand} instead`);
}

/* ------------------------------------------------ THE UNGOVERNED-WRITE DETECTOR */

/**
 * **A WRITER RETIRED BY NAME IS ONE WRITER. THE CLASS IS "ANY WRITER AT ALL".**
 * (2026-08-29.)
 *
 * Everything above retires ONE script because its output was known to be wrong.
 * That is a fact about that script. The class-wide version of the same problem
 * is structural and has nothing to do with correctness of content: **the
 * canonical method store had, and has, more than one write path.**
 *
 * `writeMethodStore` in `lib/method/candidate.ts` is now the governed one. It
 * checks the version precondition, runs the canonical validators, refuses on any
 * issue it would introduce, and writes by temp-and-rename. Every one of those
 * protections is worth exactly nothing to a caller that opens the file and
 * writes it, and this repository's own history says that is not hypothetical —
 * `pnpm method:ingest` once took the store from 88 routes at version 27 down to
 * 62 at version 0 and printed a success.
 *
 * So the rule needs a detector, because a rule with no detector is a preference.
 * This one is deliberately DUMB and TEXTUAL: a source file that both names the
 * method store and calls a filesystem write is reported. It cannot prove the two
 * are connected, and it says so — what it can do is make a new bypass impossible
 * to add quietly, which is the property that was missing.
 *
 * **Comments are stripped before the sweep** (`stripComments` from
 * `lib/ops/duplicate-implementations.ts`, reused rather than re-written). A
 * guard that fires on a paragraph explaining the guard is a guard somebody
 * weakens, and `scripts/hunt-vail-novus.mts` mentions the store only in prose.
 */

export const GOVERNED_METHOD_WRITER = {
  module: "lib/method/candidate.ts",
  fn: "writeMethodStore",
  store: "data/method/knowledge.json",
} as const;

/**
 * Files the sweep does not examine, and why each one is legitimate.
 *
 * Two entries, both of which would be the detector reporting itself: the gate,
 * which must write, and this file, which has to contain the patterns in order to
 * look for them.
 */
export const GOVERNED_WRITE_ALLOWLIST: readonly string[] = [
  "lib/method/candidate.ts",
  "lib/method/retired-writers.ts",
];

/**
 * A file that writes the canonical method store WITHOUT the gate, that we know
 * about, have not fixed, and are not pretending is fine.
 *
 * This is a RATCHET, not an allowlist. The set may shrink and may never grow:
 * `tests/method-concurrency.test.ts` fails on any bypass not named here, and the
 * `wanted` field says what each one has to become. Naming a wall is the only
 * honest alternative to asserting it is not there.
 */
export interface KnownUngovernedWriter {
  readonly file: string;
  readonly why: string;
  readonly wanted: string;
}

export const KNOWN_UNGOVERNED_METHOD_WRITERS: readonly KnownUngovernedWriter[] = [
  {
    file: "scripts/method-ingest.mts",
    why: "the deliberate re-bootstrap path behind --reset-to-manifest; it writes version 0 from the legacy manifest, which is a DELIBERATE overwrite rather than an admission, so the version precondition does not describe it",
    wanted:
      "route through writeMethodStore with an explicit acknowledged-overwrite argument, so the re-bootstrap is a typed decision rather than a raw writeFileSync",
  },
  {
    file: "scripts/ladder-monotonicity.mts",
    why: "records route outcomes directly into the store",
    wanted: "read with readMethodStore and write through writeMethodStore with the version it read",
  },
  {
    file: "scripts/learn-legistar-insite.mts",
    why: "a learn script that predates runLearnBatch and writes the store itself",
    wanted: "call runLearnBatch, which is now the validated admission path",
  },
  {
    file: "scripts/manifest-walk.mts",
    why: "writes recorded outcomes back into the store after a walk",
    wanted: "read with readMethodStore and write through writeMethodStore with the version it read",
  },
  {
    file: "scripts/descent.mts",
    why: "writes the store as part of a descent run",
    wanted: "read with readMethodStore and write through writeMethodStore with the version it read",
  },
  {
    file: "scripts/recover-redirected-directory.mts",
    why: "writes recovered route knowledge directly",
    wanted: "read with readMethodStore and write through writeMethodStore with the version it read",
  },
];

export interface UngovernedWriteFinding {
  /** Repo-relative, forward slashes. */
  readonly file: string;
  /** 1-based lines carrying a filesystem write call. */
  readonly writeCallLines: readonly number[];
  /** 1-based lines naming the canonical method store. */
  readonly storeReferenceLines: readonly number[];
  readonly why: string;
}

/** The write calls this detector knows how to see. Never a complete list. */
const WRITE_CALL =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|cpSync|renameSync)\s*\(/;
/** How a file names the canonical method store. */
const STORE_REFERENCE = /knowledge\.json/;

/**
 * Which of these files writes the method store without the gate?
 *
 * Pure: the caller supplies the sources, so this library never reads a
 * filesystem and the sweep can be run over a synthetic file — which is exactly
 * what the positive control in `tests/method-concurrency.test.ts` does.
 */
export function findUngovernedMethodWrites(
  files: Iterable<{ path: string; source: string }>,
): UngovernedWriteFinding[] {
  const out: UngovernedWriteFinding[] = [];
  for (const f of files) {
    const path = f.path.split("\\").join("/");
    if (GOVERNED_WRITE_ALLOWLIST.includes(path)) continue;

    const lines = stripComments(f.source).split("\n");
    const storeReferenceLines: number[] = [];
    const writeCallLines: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (STORE_REFERENCE.test(lines[i])) storeReferenceLines.push(i + 1);
      if (WRITE_CALL.test(lines[i])) writeCallLines.push(i + 1);
    }
    if (storeReferenceLines.length === 0 || writeCallLines.length === 0) continue;

    out.push({
      file: path,
      writeCallLines,
      storeReferenceLines,
      why:
        `${path} names ${GOVERNED_METHOD_WRITER.store} and calls a filesystem write in the same file. ` +
        `Every canonical method write goes through ${GOVERNED_METHOD_WRITER.fn}() in ` +
        `${GOVERNED_METHOD_WRITER.module}, which checks the version precondition, runs the canonical ` +
        "validators before writing, and renames into place.",
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Findings that are NOT on the named ratchet. This set must be empty. */
export function unnamedUngovernedWrites(
  findings: readonly UngovernedWriteFinding[],
): UngovernedWriteFinding[] {
  const known = new Set(KNOWN_UNGOVERNED_METHOD_WRITERS.map((w) => w.file));
  return findings.filter((f) => !known.has(f.file));
}

/** The refusal, as a string, so a caller can print it and a test can assert it. */
export function ungovernedWriteRefusal(findings: readonly UngovernedWriteFinding[]): string {
  const lines = [
    "=".repeat(74),
    `REFUSED — ${findings.length} UNGOVERNED WRITER(S) OF THE CANONICAL METHOD STORE.`,
    "=".repeat(74),
    "",
    `  THE ONE GOVERNED WRITE PATH: ${GOVERNED_METHOD_WRITER.fn}() in ${GOVERNED_METHOD_WRITER.module}`,
    "",
    "  It refuses a store that moved under the writer (naming the version expected and the",
    "  version found), refuses a write that would introduce a validator issue, and renames",
    "  into place so a half-written store is never read. None of that reaches a caller that",
    "  opens the file itself.",
    "",
  ];
  for (const f of findings) {
    lines.push(`    ${f.file}`);
    lines.push(`      writes at line(s) ${f.writeCallLines.join(", ")}`);
    lines.push(`      names the store at line(s) ${f.storeReferenceLines.join(", ")}`);
  }
  lines.push(
    "",
    "  A file that legitimately cannot use the gate yet is NAMED in",
    "  KNOWN_UNGOVERNED_METHOD_WRITERS with the reason and the change wanted. That list is a",
    "  ratchet: it may shrink and it may never grow.",
    "=".repeat(74),
  );
  return lines.join("\n");
}
