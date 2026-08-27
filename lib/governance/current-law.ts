/**
 * `currentLawText()` — the whole of current law, as text, wherever it files.
 *
 * ## Why this exists
 *
 * Before 2026-08-26 every guard asking "is X law?" read `CLAUDE.md`, because
 * `CLAUDE.md` was where all law lived. That coupled a dozen guards to a FILE
 * LAYOUT rather than to the question they were actually asking, and the moment
 * the constitution delegated its detail to domain policies, seven of them went
 * red about rules that had not changed by one word.
 *
 * A guard that fails when law MOVES is a guard that makes law hard to
 * reorganize, and the cheapest way to make it green again is to weaken it. So
 * the guards ask this function instead, and it answers from the root
 * constitution plus every registered policy module — which is the definition of
 * current law under RULING 173 and RULING 185.
 *
 * **It deliberately does NOT include history.** A guard asserting that a rule
 * is in force must not be satisfied by finding it in `history.md`, where every
 * superseded rule also lives. That would make "is X law?" unanswerable, which
 * is the failure this whole architecture exists to fix.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./ledger.ts";
import { DOMAINS } from "./schema.ts";

export interface LawSource {
  path: string;
  text: string;
}

/** Every file that carries CURRENT law, in precedence order (RULING 185). */
export function currentLawSources(root: string = ROOT): LawSource[] {
  const out: LawSource[] = [];
  const constitution = join(root, "CLAUDE.md");
  if (existsSync(constitution)) {
    out.push({ path: "CLAUDE.md", text: readFileSync(constitution, "utf8") });
  }
  for (const d of DOMAINS) {
    const p = join(root, "docs", "governance", "policies", `${d}.md`);
    if (existsSync(p)) {
      out.push({ path: `docs/governance/policies/${d}.md`, text: readFileSync(p, "utf8") });
    }
  }
  return out;
}

/**
 * All current law as one string.
 *
 * Sources are joined with a separator carrying the path, so a guard that wants
 * to say WHERE it found something still can, and so a match cannot accidentally
 * span two files.
 */
export function currentLawText(root: string = ROOT): string {
  return currentLawSources(root)
    .map((s) => `\n\n<!-- current-law source: ${s.path} -->\n\n${s.text}`)
    .join("\n");
}

/** Which current-law file carries a string, if any. */
export function whereInLaw(needle: string | RegExp, root: string = ROOT): string | null {
  for (const s of currentLawSources(root)) {
    const hit = typeof needle === "string" ? s.text.includes(needle) : needle.test(s.text);
    if (hit) return s.path;
  }
  return null;
}
