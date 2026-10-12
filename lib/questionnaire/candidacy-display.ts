/**
 * Resolves a candidacy id to what the person and the seat are called, from the canonical promoted
 * ballot projections. Ids never render to a reader. Where an id resolves to nothing this returns `null`
 * and never prettifies the id. Store failures propagate.
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
