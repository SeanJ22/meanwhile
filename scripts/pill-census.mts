/**
 * `pnpm pills` — every pill the product renders, measured against the others.
 *
 * A static census of the stylesheet rather than a browser sweep: the stylesheet
 * holds every pill, so the denominator is knowable and stated.
 *
 * Uniform means uniform in height-determining properties (`padding`,
 * `font-size`, `min-height`), never in colour or width, which carry meaning.
 * The reference is the voting pill; a pill that differs from it without a
 * stated reason is reported.
 *
 * If the stylesheet parse finds no pills at all, this throws rather than
 * printing `0 differ`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(import.meta.dirname, "..");

/** The properties that decide how tall a pill sits and how big its text is. */
const SIZING = ["padding", "padding-block", "padding-top", "padding-bottom", "min-height", "height", "font-size"] as const;

export interface PillRule {
  selector: string;
  /** Only the sizing properties. Colour and width are deliberately ignored. */
  sizing: Record<string, string>;
  /** The line the rule opens on, so a finding points at something. */
  line: number;
}

export function pillRules(css: string): PillRule[] {
  const out: PillRule[] = [];
  const lines = css.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    // A top-level rule whose selector names a pill. Modifier selectors
    // (`--yes`, `:hover`) are included: a modifier that changes padding is
    // exactly how one pill ends up taller than its sibling.
    const m = /^(\.[A-Za-z0-9_-]*pill[A-Za-z0-9_-]*(?:[^,{]*)?)\s*\{/.exec(line);
    if (!m) continue;
    const selector = m[1]!.trim();
    const sizing: Record<string, string> = {};
    for (let j = i + 1; j < lines.length; j += 1) {
      const body = lines[j]!;
      if (/^\s*\}/.test(body)) break;
      const d = /^\s*([a-z-]+)\s*:\s*([^;]+);/.exec(body);
      if (!d) continue;
      const prop = d[1]!;
      if ((SIZING as readonly string[]).includes(prop)) sizing[prop] = d[2]!.trim();
    }
    out.push({ selector, sizing, line: i + 1 });
  }
  return out;
}

/** The reference treatment: BAL-22 names the voting pill. */
export const REFERENCE_SELECTOR = ".vote-pill";

export interface PillCensus {
  measured: PillRule[];
  reference: PillRule | null;
  /** Rules that set a sizing property and disagree with the reference. */
  differing: { selector: string; prop: string; value: string; reference: string }[];
}

export function pillCensus(css: string): PillCensus {
  const measured = pillRules(css);
  const reference = measured.find((r) => r.selector === REFERENCE_SELECTOR) ?? null;
  const differing: PillCensus["differing"] = [];
  if (reference) {
    for (const rule of measured) {
      if (rule.selector === REFERENCE_SELECTOR) continue;
      for (const [prop, value] of Object.entries(rule.sizing)) {
        const ref = reference.sizing[prop];
        if (ref === undefined) continue; // the reference says nothing about it
        if (ref !== value) differing.push({ selector: rule.selector, prop, value, reference: ref });
      }
    }
  }
  return { measured, reference, differing };
}

export interface PillReasons {
  reference: string;
  reasons: { selector: string; props: string[]; reason: string }[];
}

/**
 * Three numbers, each with its denominator: uniform, different with a reason,
 * and different with no reason (the only defect). `stale` is a recorded reason
 * for a difference that no longer exists.
 */
export function splitCensus(census: PillCensus, reasons: PillReasons) {
  const excused = new Set(
    reasons.reasons.flatMap((r) => r.props.map((p) => `${r.selector}::${p}`)),
  );
  const unexcused = census.differing.filter(
    (d) => !excused.has(`${d.selector}::${d.prop}`),
  );
  const stale = [...excused].filter(
    (k) => !census.differing.some((d) => `${d.selector}::${d.prop}` === k),
  );
  return { unexcused, excused: census.differing.length - unexcused.length, stale };
}

if (import.meta.filename === process.argv[1]) {
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  const census = pillCensus(css);
  const reasons = JSON.parse(
    readFileSync(join(ROOT, "tests", "pill-sizing-reasons.json"), "utf8"),
  ) as PillReasons;
  const split = splitCensus(census, reasons);

  const result = floored(
    "pill declarations that differ from the voting pill with NO stated reason",
    "app/globals.css",
    census.measured.length,
    split.unexcused.length,
  );

  console.log("pill census (BAL-12) — app/globals.css\n");
  console.log(`  reference: ${REFERENCE_SELECTOR}`);
  if (census.reference) {
    for (const [k, v] of Object.entries(census.reference.sizing)) console.log(`    ${k}: ${v}`);
  } else {
    console.log("    NOT FOUND — the reference pill is gone, so nothing can be compared to it");
  }

  console.log("\n  THE THREE-WAY SPLIT:");
  console.log(
    `    UNIFORM with the reference       ${census.measured.length - census.differing.length} of ${census.measured.length} rule(s)`,
  );
  console.log(`    DIFFERENT, with a stated reason  ${split.excused} declaration(s)`);
  console.log(`    DIFFERENT, with NO reason        ${split.unexcused.length} declaration(s)`);
  for (const d of split.unexcused) {
    console.log(`      ${d.selector} ${d.prop}: ${d.value}   (reference ${d.reference})`);
  }
  if (split.stale.length > 0) {
    console.log(`    STALE reasons (now uniform, remove them): ${split.stale.join(", ")}`);
  }

  console.log(`\n  ${floorLine(result)}`);
  console.log(`  pill rules measured: ${census.measured.length}`);
}
