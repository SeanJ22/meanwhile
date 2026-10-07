/** Builds the River return record and fix-list entry for a failed stream. Pure; the same stream, check and failure give the same subject id. */
import { ADD_TO_QUEUE_OPTION, fixConsequence, fixSubjectId } from "./fix-queue.ts";

export const RETURN_OUTPUT_LINES = 60;

export interface RiverReturnInput {
  readonly lane: string;
  readonly check: string;
  readonly output: string;
  readonly readySha: string | null;
  readonly steps: readonly string[];
  readonly riverSha: string | null;
  readonly at: string;
}

export interface RiverReturn {
  readonly lane: string;
  readonly branch: string;
  readonly owner: string;
  readonly writer: string;
  readonly check: string;
  readonly readySha: string | null;
  readonly steps: readonly string[];
  readonly riverSha: string | null;
  readonly at: string;
  readonly headline: string;
  readonly output: string;
  readonly fix: {
    readonly subjectId: string;
    readonly chosenOption: string;
    readonly where: string;
    readonly says: string;
    readonly consequenceShown: string;
  };
}

const FAILURE_LINE = /\b(?:fail(?:ed|ing|ure)?|error|not ok|conflict|refused|✖|AssertionError)\b/i;

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
