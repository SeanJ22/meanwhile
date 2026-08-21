/**
 * **DOES THIS REGISTRY HOLD A BODY FOR THIS GOVERNMENT?** — one answer, one
 * implementation. (NH Hunt 5, 2026-08-21.)
 *
 * ## The defect this exists to close
 *
 * Two instruments asked the same question and gave opposite answers on the
 * same day. `pnpm twig:pair` reported LAKE TODD VILLAGE DISTRICT as HELD, with
 * one body, matched "by curated name". `docs/gap-ledger.md`, generated from
 * the same registry minutes later, printed: *"2 of these govern part of this
 * zip and are not in the registry."* One of the two was Lake Todd.
 *
 * The ledger was not wrong about a lookup — it never did one. The sentence was
 * a constant: every document-resolved district that reached the zip was
 * declared absent from the registry, because on the day it was written they
 * all were. NH Hunt 4 wired two of them and nothing in the generator noticed.
 *
 * That is the same shape as the coverage note RULING 59 deleted, one layer
 * down and more dangerous, because RULING 59 makes the gap ledger the ONLY
 * place the known-but-not-reached enumeration lives. A ledger that says a body
 * is missing when it is held is a work queue that sends the next session to
 * hunt something already caught, and — worse — it is the document the author
 * reads to find out what is still dark.
 *
 * ## Why a name match at all, when the law says never join on name strings
 *
 * The law is about JOINING RECORDS — an official to an office, a contribution
 * to a committee — where a name collision silently binds two different people.
 * This is not that. The Census publishes no division, no OCD-ID and no stable
 * identifier for a village district, a precinct or a conservation district;
 * the name is the only thing the two sides share. There is nothing to join on.
 *
 * So the match is deliberately narrow, and its result is a RECONCILIATION
 * INPUT rather than a record link: nothing downstream carries a body id
 * derived from here. It answers "is this unit accounted for", and the two
 * callers that ask it now get the same answer by construction.
 */

/**
 * A name reduced to the letters and spaces it shares with another spelling of
 * itself. The Census shouts (`LAKE TODD VILLAGE DISTRICT`), the registry does
 * not (`Lake Todd Village District`), and either may carry punctuation.
 */
export function looseName(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * The board-noun suffixes a registry body carries and a Census unit does not.
 *
 * The Census names the GOVERNMENT (`MERRIMACK COUNTY CONSERVATION DISTRICT`);
 * this product names the BODY inside it (`Merrimack County Conservation
 * District Board of Supervisors`), because RULING 9 says the Census counts
 * governments and this product renders bodies. Stripping the suffix is what
 * lets one be recognised as an instance of the other.
 */
const BOARD_SUFFIX =
  / (GOVERNING BOARD|BOARD OF SUPERVISORS|BOARD OF DIRECTORS|BOARD OF TRUSTEES|BOARD OF EDUCATION|BOARD OF COMMISSIONERS|COMMISSIONERS|BOARD)$/;

/**
 * The body in `bodyNames` that accounts for the government `unitName`, or
 * `undefined`.
 *
 * The whole index is searched rather than only the bodies with no division of
 * their own. A unit with no Census division may still be wired here under the
 * division it sits INSIDE — the Warner Village Water District is a separate
 * government with its own elected commissioners and is filed under the Town of
 * Warner, because that is the division a reader's zip resolves to. Searching
 * only the divisionless slice would report it missing.
 *
 * The prefix comparison in both directions is deliberate and is where this
 * would go wrong if it went wrong: it is what lets `LAKE TODD VILLAGE
 * DISTRICT` match `Lake Todd Village District` after suffix-stripping, and
 * what would also let a short unit name match a longer unrelated body that
 * happens to start with it. The names in play are multi-word proper nouns of
 * specific governments, so the failure mode is theoretical here; a caller
 * matching short generic names should not use this.
 */
export function bodyAccountingFor(
  unitName: string | null | undefined,
  bodyNames: readonly string[],
): string | undefined {
  const key = looseName(unitName);
  if (!key) return undefined;
  return bodyNames.find((candidate) => {
    const other = looseName(candidate).replace(BOARD_SUFFIX, "");
    if (!other) return false;
    return other === key || other.startsWith(key) || key.startsWith(other);
  });
}
