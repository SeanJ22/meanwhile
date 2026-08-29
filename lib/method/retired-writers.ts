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
