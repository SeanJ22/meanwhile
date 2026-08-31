/**
 * `pnpm walk:wait-audit` — EVERY WAIT IN THE WALK, AGAINST TODAY'S DOM.
 * (Session B, W3.7, 2026-08-30.)
 *
 * ## The defect class this hunts
 *
 * A.1 found `appSettled` waiting on `.coverage-notice` — a selector that no
 * longer renders on the surface it was waiting on. The wait could never be
 * satisfied, so every call spent its full timeout and returned false, and
 * **nothing read the false**. The walk was 1463.4s. Removing that one wait took
 * it to 321.2s at identical coverage.
 *
 * That is not a slow test. It is an INSTRUMENT DEFECT with two halves, and
 * either one alone is enough to make a wait a lie:
 *
 * ```
 *   UNSATISFIABLE   the condition names something today's DOM never produces
 *   UNCONSUMED      the boolean result is discarded, so the walk proceeds
 *                   exactly as if the wait had succeeded
 * ```
 *
 * A wait that is unsatisfiable AND consumed fails loudly, which is fine. A wait
 * that is satisfiable and unconsumed is merely sloppy. The pair is what costs
 * nineteen minutes and reports nothing.
 *
 * ## What this checks, and what it deliberately does not
 *
 * It extracts every selector every `until` / `untilPresent` call site waits on,
 * and asks whether that selector exists ANYWHERE in the product's own source.
 * A selector present in the source may still be unreachable on the surface the
 * walk waits on it from — that is a stronger claim and needs the live walk to
 * make — but a selector that appears in NO component is unsatisfiable
 * everywhere, which is the A.1 case exactly and is decidable without a browser.
 *
 * It also reports which call sites DISCARD the result, because that is the
 * half that turns an unsatisfiable wait from a failure into a delay.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const WALK = join(ROOT, "scripts", "walk-all.mts");

/** Every source file a selector could legitimately be produced by. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(path);
  }
  return out;
}

const product = [join(ROOT, "app"), join(ROOT, "components"), join(ROOT, "lib")]
  .flatMap((d) => sourceFiles(d))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

const walk = readFileSync(WALK, "utf8");
const lines = walk.split(/\r?\n/);

interface Wait {
  readonly line: number;
  readonly kind: "until" | "untilPresent";
  readonly selectors: readonly string[];
  readonly consumed: boolean;
  readonly text: string;
}

/**
 * A comment is not a call site.
 *
 * The first cut of this scanned a six-line window from each match and pulled
 * every quoted string in it, which swept up prose from the doc comments this
 * file is full of and reported a sentence as an unsatisfiable selector. An
 * audit that produces false positives is an audit whose real findings stop
 * being read, so the extraction is narrowed rather than the threshold loosened.
 */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

const waits: Wait[] = [];
for (const [i, raw] of lines.entries()) {
  if (isComment(raw)) continue;
  const isPresent = /\bawait\s+untilPresent\(/.test(raw);
  const isUntil = /\bawait\s+until\(/.test(raw);
  if (!isPresent && !isUntil) continue;

  /* The call may span lines. Take the window up to its closing paren, and drop
     comment lines inside it. */
  const window: string[] = [];
  let depth = 0;
  for (let j = i; j < Math.min(i + 8, lines.length); j += 1) {
    if (!isComment(lines[j])) window.push(lines[j]);
    depth += (lines[j].match(/\(/g) ?? []).length - (lines[j].match(/\)/g) ?? []).length;
    if (j > i && depth <= 0) break;
  }
  const joined = window.join(" ");
  const quoted = [...joined.matchAll(/["'`]([^"'`\n]*[.#[][^"'`\n]*)["'`]/g)]
    .map((m) => m[1])
    /* A selector, not a sentence: no spaces around prose, and it must open with
       a selector character somewhere plausible. */
    .filter((s) => s.length > 0 && s.length < 90 && !/\s{2,}/.test(s));
  /* Consumed when the result is bound or tested rather than dropped. */
  const consumed =
    /(const|let|var)\s+\w+\s*=\s*await\s+until/.test(raw) ||
    /if\s*\(\s*!?\s*await\s+until/.test(raw) ||
    /return\s+await\s+until/.test(raw) ||
    /=\s*await\s+untilPresent/.test(raw);
  waits.push({
    line: i + 1,
    kind: isPresent ? "untilPresent" : "until",
    selectors: [...new Set(quoted)],
    consumed,
    text: raw.trim().slice(0, 110),
  });
}

/** Does the product's own source produce anything matching this selector? */
function selectorExists(selector: string): boolean {
  /* A compound selector is satisfiable if ANY of its alternatives is. */
  return selector.split(",").some((part) => {
    const one = part.trim();
    if (one.length === 0) return true;
    const tokens = [...one.matchAll(/\[([a-zA-Z-]+)[^\]]*\]|\.([\w-]+)|#([\w-]+)/g)];
    if (tokens.length === 0) return true;
    return tokens.every((t) => {
      const attr = t[1];
      const cls = t[2];
      const id = t[3];
      if (attr) return product.includes(attr);
      if (cls) return product.includes(cls);
      if (id) return product.includes(id);
      return true;
    });
  });
}

const dead: { wait: Wait; selector: string }[] = [];
for (const wait of waits) {
  for (const selector of wait.selectors) {
    if (!selectorExists(selector)) dead.push({ wait, selector });
  }
}

console.log(`walk:wait-audit · ${WALK}`);
console.log(
  `  ${floorLine(
    floored(
      "waits whose condition today's product source can satisfy",
      "scripts/walk-all.mts",
      waits.length,
      waits.length - dead.length,
      waits.length === 0 ? "the walk contains no until() waits at all" : undefined,
    ),
  )}`,
);
console.log(
  `  ${floorLine(
    floored(
      "waits whose RESULT is read rather than discarded",
      "scripts/walk-all.mts",
      waits.length,
      waits.filter((w) => w.consumed).length,
      waits.length === 0 ? "the walk contains no until() waits at all" : undefined,
    ),
  )}`,
);

if (dead.length > 0) {
  console.log(`\n  UNSATISFIABLE — the selector appears in no product source:`);
  for (const d of dead) {
    console.log(
      `    walk-all.mts:${d.wait.line}  ${JSON.stringify(d.selector)}` +
        `${d.wait.consumed ? "  (result IS read, so this fails loudly)" : "  (result DISCARDED — this is the A.1 shape: a full timeout nobody reads)"}`,
    );
    console.log(`        ${d.wait.text}`);
  }
} else {
  console.log(
    "\n  No wait in the walk names a selector the product source cannot produce. That is the " +
      "A.1 class, checked; it does not rule out a selector that exists but is unreachable from " +
      "the surface the wait runs on, which only a live walk can establish.",
  );
}

const unconsumed = waits.filter((w) => !w.consumed);
if (unconsumed.length > 0) {
  console.log(
    `\n  RESULT DISCARDED at ${unconsumed.length} of ${waits.length} call site(s). Each is a ` +
      "wait that cannot fail: if its condition is never met, the walk spends the timeout and " +
      "proceeds identically. Listed so the count is a fact rather than an impression:",
  );
  for (const w of unconsumed) console.log(`    walk-all.mts:${w.line}  ${w.text}`);
}

if (dead.length > 0) process.exit(1);
