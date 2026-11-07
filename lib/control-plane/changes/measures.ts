/**
 * The four release numbers (rulings §5, "Every release makes Meanwhile better"),
 * as the plain-English block River writes into each release pull request and
 * Admin's Changes view reads back. Pure: the same lines both ways.
 *
 * ```
 *   Facts reaching readers: 12,081 a day before, after: measuring
 *   ZIPs usable in under 3 seconds (of 10): phone 21→measuring, tablet 30→measuring, desktop 33→measuring
 *   Database reads: 3.42 GB an hour before, after: measuring
 *   Lines of code: 696,315 before, 695,402 after (−913)
 * ```
 */

export const MEASURES_START = "<!-- release-measures -->";
export const MEASURES_END = "<!-- /release-measures -->";
export const DEVICES = ["phone", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

type Pair = { readonly before: number | null; readonly after: number | null };
export interface Measures {
  readonly facts: Pair & { readonly early: { readonly perHour: number; readonly hours: number } | null };
  readonly zips: Readonly<Record<Device, Pair>>;
  readonly reads: Pair;
  readonly lines: Pair;
}

const whole = (n: number | null, pending: string) => (n === null ? pending : n.toLocaleString("en-US"));
const gb = (n: number | null, pending: string) => (n === null ? pending : `${n} GB`);

/** The four lines, in the fixed wording Admin parses. */
export function measureLines(m: Measures): string[] {
  const early = m.facts.early ? ` (first ${m.facts.early.hours} hours: ${whole(m.facts.early.perHour, "")} an hour)` : "";
  const facts = m.facts.after === null ? `after: measuring${early}` : `${whole(m.facts.after, "")} after`;
  const change = m.lines.before === null || m.lines.after === null ? ""
    : ` (${m.lines.after === m.lines.before ? "no change" : `${m.lines.after > m.lines.before ? "+" : "−"}${whole(Math.abs(m.lines.after - m.lines.before), "")}`})`;
  return [
    `Facts reaching readers: ${whole(m.facts.before, "not measured")} a day before, ${facts}`,
    `ZIPs usable in under 3 seconds (of 10): ${DEVICES.map((d) => `${d} ${whole(m.zips[d].before, "not measured")}→${whole(m.zips[d].after, "measuring")}`).join(", ")}`,
    `Database reads: ${gb(m.reads.before, "not measured")} an hour before, ${m.reads.after === null ? "after: measuring" : `${gb(m.reads.after, "")} after`}`,
    `Lines of code: ${whole(m.lines.before, "not measured")} before, ${whole(m.lines.after, "not measured")} after${change}`,
  ];
}

/** The block for a release body: the four lines, then River's notes (slowest ZIPs, definitions). */
export function measuresBlock(m: Measures, notes: readonly string[]): string {
  return [MEASURES_START, "### Every release makes Meanwhile better", "", ...measureLines(m).map((line) => `- ${line}`), "", ...notes, MEASURES_END].join("\n");
}

const num = (text: string | undefined): number | null => {
  if (text === undefined || !/^\d[\d,]*(\.\d+)?$/.test(text)) return null;
  return Number(text.replaceAll(",", ""));
};
const N = "(\\d[\\d,]*(?:\\.\\d+)?|not measured|measuring)";

/** The four numbers from a release body, or null when it carries no block. */
export function parseMeasures(body: string | null | undefined): Measures | null {
  const block = body?.split(MEASURES_START)[1]?.split(MEASURES_END)[0];
  if (block === undefined) return null;
  const facts = new RegExp(`^- Facts reaching readers: ${N} a day before, (?:after: measuring(?: \\(first (\\d+) hours: ([\\d,]+) an hour\\))?|${N} after)$`, "m").exec(block);
  const zips = new RegExp(`^- ZIPs usable in under 3 seconds \\(of 10\\): ${DEVICES.map((d) => `${d} ${N}→${N}`).join(", ")}$`, "m").exec(block);
  const reads = new RegExp(`^- Database reads: (?:${N} GB|not measured) an hour before, (?:after: measuring|${N} GB after)$`, "m").exec(block);
  const lines = new RegExp(`^- Lines of code: ${N} before, ${N} after`, "m").exec(block);
  if (!facts || !zips || !reads || !lines) return null;
  const pair = (before?: string, after?: string): Pair => ({ before: num(before), after: num(after) });
  return {
    facts: { ...pair(facts[1], facts[4]), early: facts[2] ? { hours: Number(facts[2]), perHour: num(facts[3]) ?? 0 } : null },
    zips: { phone: pair(zips[1], zips[2]), tablet: pair(zips[3], zips[4]), desktop: pair(zips[5], zips[6]) },
    reads: pair(reads[1], reads[2]),
    lines: pair(lines[1], lines[2]),
  };
}
