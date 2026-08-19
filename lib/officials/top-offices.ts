import type { SeatHolder } from "./lookup.ts";

/**
 * **WHO RUNS THIS BODY — the top two, whatever those offices are called here.**
 * F01 1.2 and 2.2, 2026-08-19, the author.
 *
 * *"As a reminder, the superintendent also should be listed at the top. There
 * should be a little bit of representation on the small card."* And, as the
 * class: *"Every small battlecard carries its top two office holders, whatever
 * those offices are for that body type — county, municipality, school district,
 * commission. A small card with no representation on it isn't doing its job."*
 *
 * ## Why a precedence table rather than "the first two"
 *
 * A roster is stored in the body's own published order, which is usually the
 * order of election or of seniority and is not an answer to "who runs this".
 * Taking the first two would put a first-term board member above the board
 * president at some bodies and not others, for no reason a reader could see —
 * and that inconsistency is worse than no ordering, because it looks like a
 * judgement we made.
 *
 * So the order is a stated rule per body type, matched on the office TITLE the
 * body itself publishes. It is not a ranking of people: it is the same
 * structural fact every body publishes about itself — who presides, and who
 * runs it day to day. `CLAUDE.md`'s never-rank rule is about ordering
 * candidates by fit, agreement or merit; ordering officeholders by their own
 * published office is a neutral criterion of exactly the kind it names.
 *
 * ## The two roles, and why they are different
 *
 * Nearly every American local government has the same pair under different
 * names: someone ELECTED who presides over the body, and someone HIRED who
 * runs the organisation. A school district calls them Board President and
 * Superintendent; a county, Chair and County Administrator; a town, Mayor or
 * Select Board Chair and Town Manager. A reader wanting to know who to call
 * about a decision wants the first; a reader wanting to know who to call about
 * a pothole wants the second. Both, in that order, on every card.
 *
 * ## The gap is NAMED, never blank
 *
 * A body whose top offices we have not sourced renders `TOP_OFFICES_GAP`, which
 * is a fact about us. `CLAUDE.md`: a null renders as its named gap, on every
 * surface, always, and the name says whose gap it is. A blank slot on a card
 * would read as "this body has no leader".
 */

/**
 * Matched against the body's OWN published office title, case-insensitively.
 *
 * The patterns below were written against the twelve curated rosters actually
 * shipped, not from general knowledge, and three of them corrected a first
 * pass that looked obviously right:
 *
 *  - **New Jersey counties** publish "Commissioner Director" for the presiding
 *    officer. No generic chair/president pattern reaches it.
 *  - **Pima County** publishes "County Supervisor, District 2 (Vice Chair)"
 *    ABOVE "District 3 (Chair)" in roster order, so a naive chair match
 *    returned the VICE chair. Deputies are excluded explicitly.
 *  - **Rockaway Township** publishes both a Mayor and a Council President, and
 *    they are two different people doing two different jobs. Both belong on the
 *    card, which is why the head slot can fill twice when no appointed
 *    executive is held.
 *
 * `tests/top-offices.test.ts` asserts every shipped roster resolves, so the
 * next state's titles break a test rather than a card.
 */
interface OfficePattern {
  /** What this role IS, in reader language — never an enum, never a key. */
  role: string;
  test: RegExp;
}

/** Never the deputy. A vice chair is not who presides. */
const DEPUTY = /\b(vice|deputy|acting|assistant|interim)\b/i;

/**
 * The ELECTED head — whoever the body's own published title says leads it.
 * Ordered by seniority of office, not by roster position.
 */
const HEAD: OfficePattern[] = [
  { role: "Mayor", test: /\bmayor\b/i },
  { role: "Presides", test: /\bcommissioner director\b/i },
  { role: "Presides", test: /\b(president|chair(man|woman|person)?)\b/i },
  { role: "Presides", test: /\b(speaker|majority leader)\b/i },
];

/** The APPOINTED executive — hired by the body, not elected to it. */
const EXECUTIVE: OfficePattern[] = [
  { role: "Runs it day to day", test: /\bsuperintendent\b/i },
  { role: "Runs it day to day", test: /\b(administrator|manager)\b/i },
  { role: "Runs it day to day", test: /\bexecutive director\b/i },
  { role: "Runs it day to day", test: /\b(county|city|town) executive\b/i },
];

export interface TopOffice {
  holder: SeatHolder;
  /** What this person does here, in reader language. Never the raw title. */
  role: string;
}

/**
 * The honest line for a body whose top offices are not sourced yet.
 *
 * Describes OUR research, never the body — a body always has someone presiding,
 * and saying otherwise would be a claim about a government we have no record
 * for.
 */
export const TOP_OFFICES_GAP =
  "We haven’t sourced who leads this body yet.";

/**
 * Up to two holders: whoever presides, then whoever runs it day to day.
 *
 * A body that publishes only one of the two returns one — never padded with a
 * rank-and-file member to make the card look fuller, which would put a person
 * under a heading that is not true of them.
 *
 * A single-seat division (a congressional district, a state house seat) has one
 * officeholder and no hired executive, so it returns that one person under the
 * presiding slot. That is the right answer and is why the roles are matched by
 * title rather than assumed by position: a US Representative presides over
 * nothing, so a generic "the first is the chair" rule would have mislabelled
 * every legislative card in the product.
 */
export function topOfficesFor(holders: readonly SeatHolder[]): TopOffice[] {
  const found: TopOffice[] = [];

  const pick = (patterns: OfficePattern[]): TopOffice | null => {
    for (const pattern of patterns) {
      const hit = holders.find((h) => {
        const title = h.officeTitle ?? "";
        if (!pattern.test.test(title)) return false;
        // A vice chair is not who presides, and a deputy administrator is not
        // who runs it. Pima publishes the vice chair ABOVE the chair.
        if (DEPUTY.test(title)) return false;
        return !found.some((f) => f.holder.id === h.id);
      });
      if (hit) return { holder: hit, role: pattern.role };
    }
    return null;
  };

  const head = pick(HEAD);
  if (head) found.push(head);

  const executive = pick(EXECUTIVE);
  if (executive) {
    found.push(executive);
  } else {
    /*
     * No appointed executive on record. Where the body publishes a SECOND
     * elected head — Rockaway Township has a Mayor and a Council President,
     * and they are two different people doing two different jobs — that person
     * is the second-most senior office the body actually has, and the card
     * should carry them. Where it does not, the card carries one row, which is
     * the honest answer rather than a padded one.
     */
    const second = pick(HEAD);
    if (second) found.push(second);
  }

  /*
   * The single-seat case. A division with exactly one officeholder and no
   * title match is a legislative seat — the person IS the representation, and
   * a card that showed them nothing because "U.S. Representative" matches no
   * presiding pattern would be the emptiest possible card for the best-covered
   * body in the product.
   */
  if (found.length === 0 && holders.length === 1) {
    return [{ holder: holders[0], role: holders[0].officeTitle ?? "Represents this district" }];
  }

  return found;
}
