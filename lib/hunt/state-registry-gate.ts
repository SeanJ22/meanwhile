/**
 * A STATE WITH NO SOURCE REGISTRY CANNOT BEGIN A HUNT.
 * (2026-08-26, the sources-and-incumbency session. Item 2's gate, and Item 9's
 * wiring. It is **RULING 86** — per-state source enumeration precedes the hunt
 * — made enforceable rather than remembered.)
 *
 * RULING 86 says the enumeration is *a written research step producing a
 * written list, and it happens before the first entity is touched*. It has been
 * law since 2026-08-22 and nothing anywhere could tell whether a session had
 * done it. **A rule with no instrument is a rule that gets skipped by the
 * session under the most time pressure**, which is the session that can least
 * afford to rediscover a state's sources mid-hunt.
 *
 * So: a hunt asks this first, and a refusal is LOUD — it throws, it names the
 * state, it names the file that is missing, and it says what to do. Not a
 * warning and not a log line, because both of those are things a run scrolls
 * past.
 *
 * **FAIL CLOSED IN EVERY DIRECTION** (RULING 159 — zero is a result that must
 * be EARNED):
 *
 *   - no `states/<code>/` directory        -> refused
 *   - no `sources.md` in it                -> refused
 *   - a `sources.md` that is EMPTY         -> refused
 *   - a `sources.md` with no source rows   -> refused
 *   - a state code that is not a state     -> refused
 *
 * The empty case is the one that looks harmless. A registry file with a heading
 * and nothing under it is not a registry; it is a session having created the
 * file and stopped, and letting it through would make the gate a formality that
 * one `touch` defeats.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RegistryVerdict = "REGISTERED" | "NO_FOLDER" | "NO_REGISTRY" | "EMPTY_REGISTRY" | "NOT_A_STATE";

export interface RegistryCheck {
  readonly state: string;
  readonly verdict: RegistryVerdict;
  readonly path: string;
  /** Written to be read by somebody who is not looking for it. */
  readonly reason: string;
  /** How many source rows the reader could find. 0 unless REGISTERED. */
  readonly sources: number;
}

/** The 50 states, DC, and the five inhabited territories. */
const STATE_CODES = new Set(
  (
    "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd " +
    "oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc as gu mp pr vi"
  ).split(" "),
);

/**
 * How many SOURCE ROWS a registry holds.
 *
 * Counted by SHAPE rather than by a marker the file has to remember to carry
 * (RULING 110): a registry writes its sources either as a markdown table row
 * whose first cell is bold, or as a two-column definition table under a
 * heading. Both forms are counted, and the count is what the gate asserts —
 * not the file's own claim about itself, which a stub could make just as
 * loudly.
 */
export function countSourceRows(text: string): number {
  let rows = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    // Separator rows and header rows are not sources.
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    const cells = t.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    // A source row names something and says something about it.
    if (cells[0].length === 0) continue;
    if (/^(name|url|publisher|division|source|file|entry|state|mechanism|tool)$/i.test(cells[0])) continue;
    rows += 1;
  }
  return rows;
}

/** The minimum a registry must hold before a hunt may begin. */
export const MINIMUM_SOURCE_ROWS = 5;

export function checkStateRegistry(state: string, root: string): RegistryCheck {
  const code = state.trim().toLowerCase();
  const path = `states/${code}/sources.md`;

  if (!STATE_CODES.has(code)) {
    return {
      state: code,
      verdict: "NOT_A_STATE",
      path,
      sources: 0,
      reason:
        `"${state}" is not a US state, district or territory code. The gate refuses rather than ` +
        "guessing, because a typo that read as an unregistered state and a typo that read as a " +
        "registered one would fail in completely different places.",
    };
  }

  const folder = join(root, "states", code);
  if (!existsSync(folder)) {
    return {
      state: code,
      verdict: "NO_FOLDER",
      path,
      sources: 0,
      reason:
        `There is no states/${code}/ folder. RULING 86: before any state's hunt begins, the session ` +
        `enumerates that state's free sources into a written list. Create states/${code}/sources.md ` +
        "using states/nh/sources.md as the field contract, then hunt.",
    };
  }

  const file = join(root, "states", code, "sources.md");
  if (!existsSync(file)) {
    return {
      state: code,
      verdict: "NO_REGISTRY",
      path,
      sources: 0,
      reason:
        `states/${code}/ exists but carries no sources.md. The dossier is not the registry: one says ` +
        "how the state works, the other says what may be walked and under what licence. RULING 86 " +
        "requires the second before the first entity is touched.",
    };
  }

  const text = readFileSync(file, "utf8");
  const sources = countSourceRows(text);
  if (sources < MINIMUM_SOURCE_ROWS) {
    return {
      state: code,
      verdict: "EMPTY_REGISTRY",
      path,
      sources,
      reason:
        `${path} holds ${sources} source row(s), below the minimum of ${MINIMUM_SOURCE_ROWS}. A file ` +
        "with a heading and nothing under it is not a registry — it is a session having created the " +
        "file and stopped, and a gate one `touch` defeats is not a gate (RULING 159).",
    };
  }

  return {
    state: code,
    verdict: "REGISTERED",
    path,
    sources,
    reason: `${path} holds ${sources} source row(s).`,
  };
}

/**
 * The gate itself. THROWS on anything that is not REGISTERED.
 *
 * Throwing rather than returning a flag is the fail-closed direction: a caller
 * that forgot to check a returned boolean would hunt anyway, and the whole
 * point is that the hunt does not begin.
 */
export function requireStateRegistry(state: string, root: string): RegistryCheck {
  const check = checkStateRegistry(state, root);
  if (check.verdict !== "REGISTERED") {
    throw new Error(
      `HUNT REFUSED — ${check.state.toUpperCase()} has no usable source registry.\n` +
        `  verdict  ${check.verdict}\n` +
        `  file     ${check.path}\n` +
        `  ${check.reason}`,
    );
  }
  return check;
}
