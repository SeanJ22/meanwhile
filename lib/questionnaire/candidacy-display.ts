/**
 * **A CANDIDACY ID IS NOT A NAME, AND A CONTEST ID IS NOT AN OFFICE.**
 * (Overnight depth hunt, 2026-08-23, item 7.)
 *
 * `CLAUDE.md`: *identifiers, enum values and internal keys never render outside
 * a technical-details disclosure.* The first version of the questionnaire page
 * put `ballot-nj-morris:mendham-township-member-of-the-township-committee-place-
 * mendham-township:kapner-gary` in front of the candidate as their own name,
 * which is that rule broken on the one surface where the reader is the person
 * being named.
 *
 * So this resolves an id to what a person is actually called and what the seat
 * is actually called, out of the committed ballot files.
 *
 * ## The gap is NAMED, never guessed
 *
 * Where an id resolves to nothing, this returns `null` and the caller renders a
 * neutral sentence. It does NOT fall back to prettifying the id — a slug with
 * its hyphens swapped for spaces reads like a name and is not one, and a
 * candidate shown a mangled version of their own name has been told something
 * false about how carefully this was done.
 *
 * ## Runtime read, so the route must trace it
 *
 * These files are read through `process.cwd()`, which Next's tracer cannot
 * follow. `next.config.ts` names them under `/questionnaire/[token]`. Untraced,
 * the read throws, the catch returns null, and every candidate sees the neutral
 * fallback — a regression that looks exactly like honest missing data, which is
 * why it is named per route rather than assumed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stateForBallotFile } from "../holdings/runtime-paths.ts";

import { surnameDisplayCase } from "../ballot/name-case.ts";

interface BallotFile {
  contests: { id: string; title: string }[];
  candidacies: { id: string; contestId: string; givenName: string; familyName: string }[];
}

/** Every committed ballot file a candidacy id could come from. */
const BALLOT_FILES = [
  "nj-morris-2026.json",
  "nh-merrimack-2026.json",
  "az-pima-2026.json",
] as const;

export interface CandidacyDisplay {
  /** What the person is called, cased for reading. */
  name: string;
  /** What the seat is called. */
  officeTitle: string;
}

let cache: Map<string, CandidacyDisplay> | null = null;

function load(): Map<string, CandidacyDisplay> {
  if (cache) return cache;
  const out = new Map<string, CandidacyDisplay>();
  for (const file of BALLOT_FILES) {
    const state = stateForBallotFile(file);
    if (!state) throw new Error(`State ballot filename required: ${file}`);
    try {
      const raw = JSON.parse(
        readFileSync(join(process.cwd(), "data", "states", state, "ballot", file), "utf8"),
      ) as BallotFile;
      const titles = new Map(raw.contests.map((c) => [c.id, c.title]));
      for (const c of raw.candidacies) {
        out.set(c.id, {
          name: `${c.givenName} ${surnameDisplayCase(c.familyName)}`.replace(/\s+/g, " ").trim(),
          officeTitle: titles.get(c.contestId) ?? "",
        });
      }
    } catch {
      /* A file this build does not carry is not a reason to resolve nothing for
       * the ones it does. The miss surfaces as a null for that id alone. */
    }
  }
  cache = out;
  return out;
}

/** The person and the seat behind a candidacy id, or `null` if it resolves to neither. */
export function displayFor(candidacyId: string): CandidacyDisplay | null {
  const hit = load().get(candidacyId);
  if (!hit || hit.name.length === 0 || hit.officeTitle.length === 0) return null;
  return hit;
}
