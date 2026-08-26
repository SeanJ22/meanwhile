/**
 * **BC-26 (2026-08-25) — AN APPOINTED ROLE IS NEVER AN "INCUMBENT".**
 *
 * Sean: *"the Vail superintendent is labeled incumbent. Superintendents aren't
 * elected there. Branch on whether the role is elected before rendering the
 * label."*
 *
 * ## Why this is a false claim and not an imprecise one
 *
 * This is **RULING 118's reasoning, one word over.** That ruling took the
 * GOVERN verb off appointed officials because *governs you* is a claim about
 * the READER'S OWN POWER — that they chose this person and can unchoose them.
 * `Incumbent` is the same claim wearing a shorter word: it means *the person
 * currently holding the seat you are voting on*, and it is the word that pairs
 * with `Challenger` on a ballot card. A superintendent has no challenger,
 * because there is no election to be an incumbent in.
 *
 * So the chip does not soften — it does not render. `Superintendent` is already
 * on the card, it is accurate, and it tells a reader who is responsible for
 * something that reaches them. Adding `Incumbent` to it does not add
 * information; it adds a wrong one.
 *
 * ## How electedness is decided, and why it is by ROLE rather than by body
 *
 * A single body routinely carries both: Kearsarge's school BOARD is elected and
 * its Interim Superintendent and Business Administrator are hired by that
 * board. A predicate keyed on the body would have to be wrong about one of
 * them. The title is the thing that differs, and it is the thing the body
 * itself publishes.
 *
 * **The list is of APPOINTED titles, and the default is ELECTED.** That
 * direction is deliberate and it is the safer of the two: an elected person
 * wrongly read as appointed loses a true chip, while an appointed person
 * wrongly read as elected gains a false claim about a named person. This
 * product's whole posture is that the second is much worse than the first.
 *
 * It is deliberately the SAME vocabulary `lib/officials/top-offices.ts` uses to
 * fill the *Runs it day to day* slot — the appointed executive — so the two
 * cannot disagree about who was hired and who was elected. `tests/bc-26.test.ts`
 * asserts that agreement rather than trusting it (RULING 103).
 */

/**
 * Titles a body HIRES rather than a public elects.
 *
 * Each entry is a job a governing body appoints, not a seat on it. Where a
 * jurisdiction genuinely elects one of these — some states elect a
 * superintendent of public instruction statewide — that is a FINDING to record
 * per jurisdiction (RULING 60: a branch proven in one place is proven for that
 * SHAPE, not for everywhere), never a reason to delete the pattern.
 */
const APPOINTED_TITLES: RegExp[] = [
  /\bsuperintendent\b/i,
  /\b(business |school )?administrator\b/i,
  /\b(town|city|county|borough|township|village|district) manager\b/i,
  /\bexecutive director\b/i,
  /\bdistrict clerk\b/i,
  /\b(chief|deputy chief) of staff\b/i,
  /\bcommissioner of\b/i,
  /\bacting director\b/i,
  /\bprincipal\b/i,
];

/**
 * Titles that are unambiguously ELECTED even though a pattern above might
 * otherwise reach them.
 *
 * A checked exception list, kept small on purpose. `County Clerk` is an elected
 * row office in New Jersey and would otherwise be caught by `district clerk`'s
 * neighbourhood; naming it here is cheaper than making the appointed patterns
 * cleverer, and a cleverer pattern is what silently mislabels the next state.
 */
const ELECTED_EXCEPTIONS: RegExp[] = [
  /\bcounty clerk\b/i,
  /\bcounty surrogate\b/i,
  /\bsheriff\b/i,
  /\bsuperintendent of public instruction\b/i,
];

export type RoleSelection = "ELECTED" | "APPOINTED";

/**
 * Is this role one the public elects?
 *
 * A null or empty title reads as ELECTED, because an officeholder card with no
 * published title is overwhelmingly a legislative seat, and the default that
 * loses a true chip is the safe direction.
 */
export function roleSelectionFor(officeTitle: string | null | undefined): RoleSelection {
  const title = (officeTitle ?? "").trim();
  if (title === "") return "ELECTED";
  if (ELECTED_EXCEPTIONS.some((re) => re.test(title))) return "ELECTED";
  return APPOINTED_TITLES.some((re) => re.test(title)) ? "APPOINTED" : "ELECTED";
}

/** May an `Incumbent` / `Challenger` chip attach to this role at all? */
export function standingChipMayAttach(officeTitle: string | null | undefined): boolean {
  return roleSelectionFor(officeTitle) === "ELECTED";
}
