import { readFileSync } from "node:fs";
import { join } from "node:path";

import { officialPhotoForPerson } from "../photos/person.ts";

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

/**
 * One person, one photo (item 6b, 2026-08-15). A card for a sitting
 * officeholder renders the SAME portrait their officials row does — and
 * carries that portrait's own attribution, because swapping the image
 * without swapping the credit would put a government portrait under a
 * Commons photographer's name. Nine people were wearing two faces before
 * this ran; `lib/photos/person.ts` states the precedence.
 */
function withPersonPhoto(
  card: CandidateCardData | null,
  personName: string,
): CandidateCardData | null {
  if (!card) return card;
  const official = officialPhotoForPerson(personName);
  if (!official || official.url === card.photoUrl) return card;
  return { ...card, photoUrl: official.url, photoSource: official.source };
}

/** The person's name as filed, recovered from the candidacy id's tail. */
function nameFromCandidacyId(candidacyId: string): string {
  const tail = candidacyId.split(":").pop() ?? "";
  return tail.split("-").reverse().join(" ");
}

export function cardForCandidacy(candidacyId: string): CandidateCardData | null {
  return withPersonPhoto(
    load().cards[candidacyId] ?? null,
    nameFromCandidacyId(candidacyId),
  );
}

export function cardForNominee(
  contestId: string,
  name: string,
): CandidateCardData | null {
  return withPersonPhoto(load().cards[`${contestId}|${name}`] ?? null, name);
}

export function allCandidateCards(): CandidateCardsFile {
  return load();
}

/*
 * **`THIN_CANDIDATE_LINE` AND `isThinCandidateCard` ARE DELETED** (RULING 42,
 * Prompt E item 3, 2026-08-20). This note stands in their place so the next
 * reader of this file learns they were removed on purpose rather than
 * wondering where they went.
 *
 * What they did: the constant was the sentence "We haven't found much about
 * this candidate yet.", and the predicate decided which cards earned it — a
 * card with no photo, no words, no contact and no link.
 *
 * Why they are gone: the pair put a marker on exactly one kind of card, and
 * the kind was "the candidate we know least about". A badge worn only by the
 * least-resourced person in a race is the information asymmetry the
 * equal-effort rule exists to catch, pointed the other way, and it was the
 * per-card repetition RULING 28 had already ended everywhere else on the page.
 *
 * What replaced it: one page-level disclosure at the foot of the ballot —
 * `COLLECTION_NOTE` in `app/ballot/page.tsx` — which says the same thing about
 * every card at once and singles nobody out. The equal-effort discipline is
 * unchanged and still binding; it lives in the HUNT, which is where
 * `CLAUDE.md` and RULING 26 both say it belongs.
 *
 * Guarded: `tests/no-suppression.test.ts` fails the build if a per-card
 * completeness marker returns, and `pnpm walk:all` fails against production
 * on the same thing.
 */
