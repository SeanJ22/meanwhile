/**
 * A stream that fails River's checks goes back to the lane that wrote it, and
 * onto the fix list (RL-06, BR-03).
 *
 * River runs as a script with no control-plane database connection, so this
 * module only BUILDS the record: the `returns/<lane>.md` file River writes on
 * `board/river`, and the fix-list entry in exactly the shape "Add this to the
 * queue" records today (`fix-queue.ts`: subject from where + what, the queue
 * option, the where — says consequence). The write into the control plane is
 * the BR-03 hook: once `fix-list.ts` exists, its `fix.add` takes `fix` as is.
 *
 * The same failure on the same stream and check gives the same subject id, so a
 * repeated return is one fix-list item, not a new one every River run.
 *
 * PURE: no store, no clock, no environment.
 */
import { ADD_TO_QUEUE_OPTION, fixConsequence, fixSubjectId } from "./fix-queue.ts";

/** Lines of failing output kept in the record: enough to act on, small enough to read. */
export const RETURN_OUTPUT_LINES = 60;

export interface RiverReturnInput {
  /** `adapter-<kind>` or a builder lane, as in `stream/<lane>`. */
  readonly lane: string;
  /** The River check that failed: `fold`, `gates`, `adapter-path`, … */
  readonly check: string;
  /** The failing check's output, as printed. */
  readonly output: string;
  readonly readySha: string | null;
  readonly steps: readonly string[];
  readonly riverSha: string | null;
  readonly at: string;
}

export interface RiverReturn {
  readonly lane: string;
  readonly branch: string;
  /** Who repairs it: the lane that wrote the stream. */
  readonly owner: string;
  readonly writer: string;
  readonly check: string;
  readonly readySha: string | null;
  readonly steps: readonly string[];
  readonly riverSha: string | null;
  readonly at: string;
  /** The first line that names the failure, used as the fix item's sentence. */
  readonly headline: string;
  /** The last {@link RETURN_OUTPUT_LINES} lines of the output. */
  readonly output: string;
  /** The fix-list entry: an "Add this to the queue" decision, ready for BR-03's `fix.add`. */
  readonly fix: {
    readonly subjectId: string;
    readonly chosenOption: string;
    readonly where: string;
    readonly says: string;
    readonly consequenceShown: string;
  };
}

const FAILURE_LINE = /\b(?:fail(?:ed|ing|ure)?|error|not ok|conflict|refused|✖|AssertionError)\b/i;

/** The adapter engineer writes `adapter-*` streams; every other stream belongs to its lane. */
export function streamWriter(lane: string): string {
  return lane.startsWith("adapter-") ? "the runner's adapter engineer" : `the ${lane} lane`;
}

export function riverReturn(input: RiverReturnInput): RiverReturn {
  const lines = input.output.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd());
  const kept = lines.filter((line, i) => line !== "" || (i > 0 && lines[i - 1] !== "")).slice(-RETURN_OUTPUT_LINES);
  const headline = (lines.find((line) => FAILURE_LINE.test(line)) ?? lines.find((line) => line.trim() !== "") ?? `${input.check} failed`).trim().slice(0, 240);
  const branch = `stream/${input.lane}`;
  const where = `River · ${branch}`;
  // No SHA or time in the sentence: the same failure returned twice is one item.
  const says = `${input.check} failed for ${input.lane}: ${headline}`;
  return {
    lane: input.lane,
    branch,
    owner: input.lane,
    writer: streamWriter(input.lane),
    check: input.check,
    readySha: input.readySha,
    steps: [...input.steps],
    riverSha: input.riverSha,
    at: input.at,
    headline,
    output: kept.join("\n").trim(),
    fix: {
      subjectId: fixSubjectId(where, says),
      chosenOption: ADD_TO_QUEUE_OPTION,
      where,
      says,
      consequenceShown: fixConsequence(where, says),
    },
  };
}

/** `returns/<lane>.md` on `board/river`: status-style fields, then the output. */
export function riverReturnMarkdown(record: RiverReturn): string {
  const fence = record.output.includes("```") ? "~~~~" : "```";
  return [
    `# Returned: ${record.lane}`,
    "",
    `lane: ${record.lane}`,
    `owner: ${record.owner}`,
    `writer: ${record.writer}`,
    `check: ${record.check}`,
    `ready: ${record.steps.join(", ") || "no step ids"} ${record.readySha ?? "unknown"}`,
    `river: ${record.riverSha ?? "unknown"}`,
    `at: ${record.at}`,
    "state: returned",
    `fix_subject: ${record.fix.subjectId}`,
    `fix: ${record.fix.consequenceShown}`,
    "",
    "## Failure",
    "",
    fence,
    record.output || record.headline,
    fence,
    "",
    "## Repair",
    "",
    `Fix on ${record.branch} and publish a new READY commit; River folds the new READY and clears this return when it integrates.`,
    "",
  ].join("\n");
}
