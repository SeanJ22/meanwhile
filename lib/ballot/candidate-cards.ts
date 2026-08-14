import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Kelly-standard candidate cards (2b, 2026-08-17): the curated photo / bio /
 * contact layer over the verified-links layer in `candidate-sites.ts`.
 *
 * The two files stay separate because they are different hunts with
 * different rules: a link is verified by fetching it; a card's photo must be
 * a URL from the candidate's own cited page (campaign site for challengers —
 * the author-adjusted photo rule — since a challenger has no official
 * portrait), HEAD-verified as an image, and labeled with its source. Bios
 * are the site's own words, attributed with a read date — never our
 * characterization of the person.
 *
 * Keys match `candidate-links-2026.json`: the candidacy id for filed
 * candidates, `<contestId>|<name>` for certified-lineup nominees.
 */

export interface CandidateCardData {
  photoUrl: string | null;
  /** The photo's source, labeled — rendered with the image, never dropped. */
  photoSource: string | null;
  /** The candidate's own site's words. Rendered attributed, in quotes. */
  bio: string | null;
  bioSourceUrl: string | null;
  bioSourceLabel: string | null;
  email: string | null;
  phone: string | null;
}

interface CandidateCardsFile {
  curatedAt: string;
  note: string;
  cards: Record<string, CandidateCardData>;
  hunts: { key: string; name: string; note: string; attemptedAt: string }[];
}

let cache: CandidateCardsFile | null = null;

function load(): CandidateCardsFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "ballot", "candidate-cards-2026.json"),
        "utf8",
      ),
    ) as CandidateCardsFile;
  }
  return cache;
}

export function cardForCandidacy(candidacyId: string): CandidateCardData | null {
  return load().cards[candidacyId] ?? null;
}

export function cardForNominee(
  contestId: string,
  name: string,
): CandidateCardData | null {
  return load().cards[`${contestId}|${name}`] ?? null;
}

export function allCandidateCards(): CandidateCardsFile {
  return load();
}
