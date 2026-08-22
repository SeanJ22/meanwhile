import { COULD_GOVERN_ACTION, COULD_GOVERN_TEXT } from "@/lib/ballot/could-govern";

/**
 * **THE RULING 71 PILL.** (NJ Hunt 3 item 3, 2026-08-22.)
 *
 *   Could govern you — add your address to confirm
 *
 * It renders on a contest whose DIVISION covers only part of the reader's zip,
 * and on no other. At 07866 that is Rockaway Township, Rockaway Borough,
 * Denville Township and their three local school districts; Morris County and
 * Morris Hills Regional School District carry nothing, because they govern
 * everyone at that zip and saying otherwise would be false.
 *
 * ## IT IS AN INVITATION, NOT A DISCLOSURE OF OUR INCOMPLETENESS
 *
 * This is the distinction that keeps it clear of RULING 44, and it is recorded
 * in `docs/rulings.md` as well as here so that no future session deletes it as
 * a completeness marker:
 *
 *   A per-card completeness statement says **we did not find this**. It is a
 *   fact about OUR data. It printed next to a named person's name, on the
 *   shortest card in the race, which meant it was a badge worn only by the
 *   least-resourced candidate running — the information asymmetry the
 *   equal-effort rule exists to catch, pointed the other way.
 *
 *   This pill says **this is a fact about your street that only you can
 *   settle**. Our data is complete: we hold Rockaway Borough's council race and
 *   Rockaway Township's, both in full. What is not settled is which one is the
 *   reader's, and the reader is the only party who can settle it.
 *
 * It attaches to a BODY, never to a person, never to a field, and never once
 * per page. RULING 28's ban on per-field indicators is untouched: this is not
 * an indicator that something is missing.
 *
 * ## It never gates anything
 *
 * A reader who provides nothing still sees every contest the zip produces, in
 * full, with every candidate on it. The pill adds a sentence and a way to
 * resolve it. Declining stays the effortless default — the second of the three
 * load-bearing friction exceptions in `CLAUDE.md`, which is about the narrowing
 * prompt this pill points at.
 *
 * ## Register
 *
 * The card is a CLAIM surface, so the words are level rather than playful: it
 * states a fact about zip geography and offers an action. Nothing here is cute
 * about a real municipality.
 */

/*
 * The words live in `lib/ballot/could-govern.ts` and are imported rather than
 * declared here: the test runner cannot import a `.tsx`, and the guard that
 * keeps this clear of RULING 44 has to pin the SENTENCE rather than a class
 * name. Re-exported so a reader of this file still finds them.
 */
export { COULD_GOVERN_TEXT, COULD_GOVERN_ACTION } from "@/lib/ballot/could-govern";

export function CouldGovernPill({ jurisdiction }: { jurisdiction?: string | null }) {
  return (
    <span
      className="could-govern-pill"
      data-could-govern="true"
      /*
       * The accessible name carries the jurisdiction where there is one, so a
       * screen reader hears WHICH body might govern them rather than the same
       * six words repeated down the page with no subject.
       */
      aria-label={
        jurisdiction
          ? `${jurisdiction}: ${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`
          : `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`
      }
    >
      <span aria-hidden="true">
        {COULD_GOVERN_TEXT} <span className="could-govern-action">— {COULD_GOVERN_ACTION}</span>
      </span>
    </span>
  );
}
