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
 * is actually called, out of the canonical promoted ballot projections.
 *
 * ## The gap is NAMED, never guessed
 *
 * Where an id resolves to nothing, this returns `null` and the caller renders a
 * neutral sentence. It does NOT fall back to prettifying the id — a slug with
 * its hyphens swapped for spaces reads like a name and is not one, and a
 * candidate shown a mangled version of their own name has been told something
 * false about how carefully this was done.
 *
 * Store failures propagate so a missing authority cannot be rendered as an
 * innocent candidate-id miss. Bundled evidence is reachable only through each
 * canonical read model's explicit first-seed gate.
 */
import { surnameDisplayCase } from "../ballot/name-case.ts";
import { readerBallotSourceForTargetId } from "../ballot/reader-sources.ts";

interface BallotFile {
  contests: { id: string; title: string }[];
  candidacies: { id: string; contestId: string; givenName: string; familyName: string }[];
}

export interface CandidacyDisplay {
  /** What the person is called, cased for reading. */
  name: string;
  /** What the seat is called. */
  officeTitle: string;
}

async function load(candidacyId: string): Promise<Map<string, CandidacyDisplay>> {
  const out = new Map<string, CandidacyDisplay>();
  const entry = await readerBallotSourceForTargetId(candidacyId);
  if (!entry) return out;
  const raw = entry.source.normalize(await entry.source.fetch()) as BallotFile;
  const titles = new Map(raw.contests.map((c) => [c.id, c.title]));
  for (const c of raw.candidacies) {
    out.set(c.id, {
      name: `${c.givenName} ${surnameDisplayCase(c.familyName)}`.replace(/\s+/g, " ").trim(),
      officeTitle: titles.get(c.contestId) ?? "",
    });
  }
  return out;
}

/** The person and the seat behind a candidacy id, or `null` if it resolves to neither. */
export async function displayFor(candidacyId: string): Promise<CandidacyDisplay | null> {
  const hit = (await load(candidacyId)).get(candidacyId);
  if (!hit || hit.name.length === 0 || hit.officeTitle.length === 0) return null;
  return hit;
}
