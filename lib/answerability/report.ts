/**
 * **THE MEASURED TABLE.** Stage, numerator, denominator — for a named scope
 * and a named question class.
 *
 * The thing this replaces is a single completion percentage. One number over
 * a seven-stage pipeline necessarily reports the stage it was computed at and
 * implies all the others, and the stage it is usually computed at is the
 * cheapest one. A table cannot do that: a row that reads
 * `READER_VERIFIED 0 / 231` is not disguisable as progress.
 *
 * Rendering only. Every number here comes from `stages.ts`; nothing is
 * derived, rounded, or summarised into a headline. Pure and offline.
 */

import {
  DENOMINATOR_NOT_ESTABLISHED,
  type Denominator,
  type LadderMeasurement,
} from "./stages.ts";

/** How a denominator prints. The named state prints its NAME, never a number. */
export function formatDenominator(denominator: Denominator): string {
  return typeof denominator === "number" ? String(denominator) : DENOMINATOR_NOT_ESTABLISHED;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

/**
 * One scope, one question class, seven rows.
 *
 * The `blocked` column is not decoration: it is what keeps a low numerator
 * from reading as an absence. "8 stopped at EXTRACTED · EXTRACTION_FAILED"
 * is a fact about our extractor; "78 stopped at ACQUIRED ·
 * NO_DOCUMENT_URL_PUBLISHED" is a fact about a government. They may never be
 * printed as the same sentence, so they are printed with their codes.
 */
export function renderLadderTable(measurement: LadderMeasurement): string {
  const lines: string[] = [];
  lines.push(`SCOPE:    ${measurement.scope}`);
  lines.push(`QUESTION: ${measurement.questionClass}`);
  lines.push(
    `ANSWERABLE FROM THE CLASSES HELD: ${measurement.classRuling.answerable ? "YES" : "NO"}` +
      ` (needs one of: ${measurement.requiredRecordClasses.join(", ") || "(none defined)"})`,
  );
  if (!measurement.classRuling.answerable) {
    for (const refused of measurement.classRuling.refusedSubstitutions) {
      lines.push(`  REFUSED SUBSTITUTION · ${String(refused.held)}: ${refused.reason}`);
    }
  }
  lines.push("");

  const stageWidth = Math.max(
    18,
    ...measurement.stages.map((row) => row.stage.length),
  );
  lines.push(
    `${pad("STAGE", stageWidth)}  ${padLeft("NUM", 6)}  ${pad("DENOMINATOR", 26)}  STOPPED HERE`,
  );
  lines.push("-".repeat(stageWidth + 6 + 26 + 20));

  for (const row of measurement.stages) {
    const blocked = Object.entries(row.blocked)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => `${count} ${code}`)
      .join(", ");
    lines.push(
      `${pad(row.stage, stageWidth)}  ${padLeft(String(row.numerator), 6)}  ` +
        `${pad(formatDenominator(row.denominator), 26)}  ${blocked || "-"}`,
    );
  }

  lines.push("");
  for (const row of measurement.stages) {
    lines.push(`  ${row.stage} denominator = ${row.denominatorBasis}`);
  }

  if (measurement.refusedRecords.length > 0) {
    lines.push("");
    lines.push(
      `RECORDS EXCLUDED BY CLASS: ${measurement.refusedRecords.length} ` +
        "(held, and not evidence for this question)",
    );
    const first = measurement.refusedRecords[0];
    lines.push(`  e.g. ${first.documentId}: ${first.reason}`);
  }

  if (measurement.invariantViolations.length > 0) {
    lines.push("");
    lines.push(
      `INVARIANT VIOLATIONS (impossible states in the evidence): ${measurement.invariantViolations.length}`,
    );
    for (const violation of measurement.invariantViolations.slice(0, 10)) {
      lines.push(`  ${violation}`);
    }
  }

  if (measurement.uncreditedDownstreamPasses.length > 0) {
    lines.push("");
    lines.push(
      `UNCREDITED DOWNSTREAM PASSES: ${measurement.uncreditedDownstreamPasses.length} ` +
        "(a later stage's own test passed over a failed earlier one; ordered but orthogonal, " +
        "so named rather than counted)",
    );
    lines.push(`  e.g. ${measurement.uncreditedDownstreamPasses[0]}`);
  }

  return lines.join("\n");
}

/**
 * Several measurements, printed as one report.
 *
 * Deliberately no total, no average and no headline. Averaging a notice
 * ladder with an outcome ladder is exactly the conflation this module exists
 * to end: it would let 231 agendas hide the fact that the same body has one
 * outcome record.
 */
export function renderScopeReport(
  title: string,
  measurements: readonly LadderMeasurement[],
): string {
  const blocks = measurements.map((measurement) => renderLadderTable(measurement));
  return [
    "=".repeat(78),
    title,
    "=".repeat(78),
    "",
    blocks.join(`\n\n${"-".repeat(78)}\n\n`),
    "",
  ].join("\n");
}
