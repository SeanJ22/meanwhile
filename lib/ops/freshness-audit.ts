/**
 * **The sweep behind RULING 107.**
 *
 * `lib/ops/freshness.ts` states the rule and gives callers a way to obey it.
 * This finds the places that do not, in code already written — which is all of
 * them, because every existing stamp site is a plain string assignment written
 * before the branded types existed.
 *
 * ## What it looks for, and why a regex rather than a type check
 *
 * The branded types in `freshness.ts` stop the mistake being written in NEW
 * code. They cannot see the existing code, because a plain `string` field
 * assigned a plain `string` type-checks perfectly. So the sweep reads source
 * text and asks one question per site: **is this freshness field being handed a
 * value that came from the clock?**
 *
 * A site is a defect when a {@link FRESHNESS_FIELDS} name is assigned, on the
 * same line or the next, from a {@link CLOCK_EXPRESSIONS} expression — with one
 * carve-out stated below.
 *
 * ## The carve-out, stated rather than hidden
 *
 * **An adapter that stamps the moment it fetched is not restamping.** A meetings
 * source that writes `collectedAt: new Date().toISOString()` in the same
 * function that performed the HTTP GET is the code path that did the read, and
 * that is exactly what the ruling asks for. The distinction is not cosmetic and
 * it is not guessable from the field name, so it is DECLARED: a file states
 * `@freshness-reads-here` in its header when its clock stamps sit in the
 * reading path, and the sweep reports those separately rather than silently
 * passing them.
 *
 * Declaring is a diff. That is the whole mechanism — the same one
 * `tests/guard-census.json` uses to let a guard leave, and the same reason
 * `pnpm guard:census --write` refuses to erase a name without a flag. A
 * carve-out nobody has to write down is a carve-out that grows.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { CLOCK_EXPRESSIONS, FRESHNESS_FIELDS } from "./freshness.ts";

/** The marker a file uses to declare its clock stamps sit in the reading path. */
export const READS_HERE = "@freshness-reads-here";

export interface StampSite {
  /** Repo-relative path, forward-slashed. */
  file: string;
  /** 1-based line number of the assignment. */
  line: number;
  /** The freshness field being written. */
  field: string;
  /** The clock expression feeding it. */
  clock: string;
  /** The source line, trimmed, so a report can show the evidence. */
  text: string;
  /**
   * True when the file declares {@link READS_HERE} — the stamp is minted by the
   * code path that performed the read, which is the rule being obeyed rather
   * than broken.
   */
  declaredReading: boolean;
}

const FIELD_ASSIGN = new RegExp(
  String.raw`\b(${FRESHNESS_FIELDS.join("|")})\b\s*[:=]\s*([^,;\n]*)`,
  "g",
);

/**
 * Every stamp site in one file's source text.
 *
 * `next` is folded in because a formatter routinely breaks
 * `collectedAt:\n  new Date()...` across two lines, and a sweep that reads only
 * the assignment line would report nothing found without having looked — the
 * failure this project names most often.
 */
export function sitesIn(file: string, source: string): StampSite[] {
  const declaredReading = source.includes(READS_HERE);
  const lines = source.split("\n");
  const out: StampSite[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const here = lines[i] as string;
    const next = lines[i + 1] ?? "";
    // A comment describing the rule is not a stamp site.
    const code = here.trimStart();
    if (code.startsWith("*") || code.startsWith("//")) continue;
    FIELD_ASSIGN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FIELD_ASSIGN.exec(here)) !== null) {
      const field = m[1] as string;
      const rhs = (m[2] as string).trim();
      const window = rhs.length === 0 ? next : rhs;
      const clock = CLOCK_EXPRESSIONS.find((c) => window.includes(c));
      if (clock === undefined) continue;
      out.push({
        file,
        line: i + 1,
        field,
        clock,
        text: here.trim(),
        declaredReading,
      });
    }
  }
  return out;
}

/** {@link sitesIn} for a list of repo-relative paths, resolved against `root`. */
export function sweep(root: string, files: string[]): StampSite[] {
  const out: StampSite[] = [];
  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(`${root}/${f}`, "utf8");
    } catch {
      continue;
    }
    out.push(...sitesIn(f, src));
  }
  return out;
}

export interface AuditVerdict {
  /** Sites where the stamp is minted by a declared reading path — allowed. */
  reading: StampSite[];
  /** Sites where a freshness field takes a clock value with no read declared. */
  restamping: StampSite[];
}

/** Split a sweep into the two states a report has to keep apart. */
export function judge(sites: StampSite[]): AuditVerdict {
  return {
    reading: sites.filter((s) => s.declaredReading),
    restamping: sites.filter((s) => !s.declaredReading),
  };
}

/**
 * Every TypeScript-ish source file under `dirs`, repo-relative and
 * forward-slashed.
 *
 * It lives here rather than in the script and the test separately because
 * RULING 103's own guard caught those two copies the moment they were written
 * — a sweep that compares the SHAPE of code with identifiers set aside, doing
 * exactly what it was built for, to the session that built it.
 */
export function sourceFilesUnder(root: string, dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git" || name === ".next") continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(?:ts|mts|tsx|mjs)$/.test(name)) {
        out.push(relative(root, abs).split(sep).join("/"));
      }
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out;
}
