import { WorkingOnIt } from "@/components/demand/working-on-it";
import {
  APRIL_2024_SENATE_NOTE,
  KEY_VOTES_CRITERIA,
  type KeyVoteEntry,
} from "@/lib/votes/key-votes";
import { votedCount } from "@/lib/votes/participation";
import type { VotePosition } from "@/lib/votes/types";
import { formatDateMDY } from "@/lib/map/format";

import { VotePill } from "@/components/map/popup/official-popup";

import { CardSection } from "./card-section";

/**
 * The key votes section (B15) — a fixed list of questions, each
 * answered by this member's OWN chamber's roll call.
 *
 * ## Four things this must never become
 *
 * 1. **A score.** Nothing here is summed, averaged, graded or ordered by
 *    agreement with anything. The list order is fixed, and identical on
 *    every member's card.
 * 2. **A selection made after the fact.** The criteria sentence renders ON
 *    the surface, above the list, verbatim — so the reader can see the rule
 *    the entries were picked by rather than take our word for it.
 * 3. **A card that shows a member the other chamber's vote.** An entry is a
 *    question; each chamber answered it with its own roll calls, and a
 *    House member's card shows House roll calls only.
 * 4. **A blank that reads as an answer.** There are three different kinds
 *    of "no vote here" and they say three different things:
 *      - the chamber does not vote on this at all, or has not acted yet —
 *        a stated fact, in the entry's own note;
 *      - the member did not vote, or was not in office — stated;
 *      - **we have not recorded this chamber's vote yet** — OUR gap, said
 *        as ours. Collapsing the third into the first two would turn a
 *        hole in our research into a claim about a legislature.
 */

// The section's own eyebrow is gone (item 6b4, 2026-08-15): the CardSection
// header above it now says "When it mattered", and
// a "Key votes" label one line under it was the same thing said twice.

export interface KeyVoteRow {
  entry: KeyVoteEntry;
  /** The member's own chamber's roll calls for this entry. */
  refs: KeyVoteEntry["house"];
  /** The member's position per roll call, index-matched to `refs`. */
  positions: (VotePosition | "DID_NOT_VOTE" | null)[];
  /** Whether the roll call itself is in hand, index-matched to `refs`. */
  held?: boolean[];
  /** Party breakdown per roll call, already gated to the chamber's tally. */
  breakdowns: (string | null)[];
  /** The stated note for a chamber with no vote to show, if the entry has one. */
  note: string | null;
}

/**
 * Item 5 (2026-08-16): the position renders as a FILLED PILL here too, in
 * the same grammar as the Recent view. Two views of one record must not
 * state the same fact in two visual languages.
 *
 * The tone carries the vote and nothing else — green for yes, red for no,
 * gray for a recorded non-position. A NAMED GAP is not in this table: it
 * renders `tone="gap"`, an outline, because absence is not a position and
 * must never wear one (item 12).
 */
const POSITION_PILL: Record<string, { label: string; tone: "yes" | "no" | "neutral" }> = {
  YES: { label: "Voted yes", tone: "yes" },
  NO: { label: "Voted no", tone: "no" },
  PRESENT: { label: "Voted present", tone: "neutral" },
  /*
   * **F01 5.2 (2026-08-19): if a member was in session, the card must say
   * what they did.** We did record it, and then failed to say it.
   *
   * `NOT_VOTING` is what `scripts/fetch-key-vote-positions.mts` writes for a
   * member who WAS SEATED and did not vote — the chambers publish "Not Voting"
   * and "Absent" and the fetcher maps both to it. This map had no key for it,
   * so 140 stored positions fell through to the generic branch below and
   * rendered "Position recorded": a string that tells a reader nothing, in
   * place of the true and useful answer.
   *
   * `DID_NOT_VOTE` is the OTHER vocabulary — `KeyVoteRowData.positions` types
   * both — and it stays, because a caller may supply either. Two names for one
   * state is not ideal and is deliberately not renamed here: the snapshot, the
   * fetcher and the row type all use `NOT_VOTING`, and a rename touching all
   * three is a bigger change than this item, tracked rather than smuggled in.
   *
   * Neutral tone on both, because a recorded absence is a fact about the
   * member and not a position — it must never wear the yes or no colour, and
   * it is equally never a GAP, which is the outline. Three states, three
   * treatments (item 12).
   */
  NOT_VOTING: { label: "Did not vote", tone: "neutral" },
  DID_NOT_VOTE: { label: "Did not vote", tone: "neutral" },
};

/**
 * Newest first, on a neutral and deterministic criterion (item 6b,
 * 2026-08-15: "the whole card reads consistently backward through time").
 *
 * The refs carry no date, so the ordering is congress → session → roll
 * number, which is monotonic in time within a chamber and is the chamber's
 * own numbering rather than anything we computed. Entries with no roll call
 * at all — the two the fetch correctly refused — sort LAST rather than being
 * dropped: they are part of the stated N and their absence line is the point.
 *
 * This is ordering by TIME, which the never-rank rule permits by name
 * ("ballot order or alphabetical" is its example of a neutral criterion, not
 * its limit). Nothing here is ordered by agreement, importance, or fit.
 */
function newestFirst(rows: KeyVoteRow[]): KeyVoteRow[] {
  const rank = (row: KeyVoteRow): number => {
    if (row.refs.length === 0) return -1;
    let best = -1;
    for (const ref of row.refs) {
      best = Math.max(best, ref.congress * 1e6 + ref.session * 1e5 + ref.rollNumber);
    }
    return best;
  };
  return [...rows].sort((a, b) => rank(b) - rank(a));
}

export function KeyVotesSection({
  chamber,
  rows,
}: {
  chamber: "house" | "senate";
  rows: KeyVoteRow[];
}) {
  if (rows.length === 0) return null;
  const laws = newestFirst(rows.filter((r) => r.entry.group === "LAWS"));
  const people = newestFirst(rows.filter((r) => r.entry.group === "PEOPLE"));

  /*
   * Item 6b, on House cards: Votes on people renders once as the single
   * honest line "the House doesn't vote on nominations", collapsed and
   * inert — never repeated per entry, never an empty section.
   *
   * The snapshot carries that sentence on every PEOPLE entry's `houseNote`,
   * which is right in the data and wrong on a card: sixteen identical
   * sentences under sixteen names is the repeated-notice defect the footnote
   * system exists to stop. So a House card collapses the whole group into
   * the one line. A Senate card gets both groups in full.
   */
  const houseNominationsLine =
    chamber === "house"
      ? (people.find((r) => r.note)?.note ??
        "The House doesn't vote on nominations.")
      : null;

  return (
    <div>
      {/* Requirement 2: the rule the list was picked by, on the surface,
          verbatim. Not a link to it, not a summary of it. At the head of the
          column, per item 6b. */}
      <p className="t-caption leading-relaxed text-voice">
        {KEY_VOTES_CRITERIA}
      </p>

      {/*
        ITEM 6 (2026-08-16): THE PANE THAT LOOKED EMPTY.
        DIAGNOSED — the data was never the problem. Production's /api/votes
        serves 36 key votes for a senator, 20 laws and 16 people, and every
        one of them reached this component. What the reader saw on selecting
        "When it mattered" was the criteria sentence and two CLOSED bars: both
        sub-groups defaulted shut, at the same size and colour as the pane's
        own header, so the pane's entire visible content was one small
        paragraph.

        A view the reader has just chosen must not need two more taps before
        it shows anything — that is reader friction, and none of the four
        sanctioned exceptions covers it. Both groups open with the pane. They
        keep their headers, their counts and their chevrons, and they now
        INDENT as sub-groups, so what they are is legible: a thing containing
        two things, each still a thing to click.

        **F01 5.3 (2026-08-19) REVERSES the `defaultOpen` half of that**:
        "When it mattered" still drops down, but Votes on laws and Votes on
        people both start collapsed. Recorded as a reversal rather than a tidy-up so a later
        session reading the paragraph above does not restore it.

        The friction the old decision was protecting against is answered a
        different way and is still answered: the pane is no longer a criteria
        sentence over two bare bars, because each bar now states its COUNT in
        the header ("Votes on laws 20", "Votes on people none"), which is the
        pane's actual answer visible without a tap. The indent and the scale
        step from that same pass stay.
      */}
      {laws.length > 0 && (
        <CardSection
          title="Votes on laws"
          /* F01 5.1 (2026-08-19): TWO numbers, not one. The first is what the
             member actually voted on — which is what the headline above now
             counts, so the two agree — and the second is the full curated
             list, which keeps our own gaps visible as the difference. The
             prior single N counted every entry and was therefore a number
             that described neither. */
          meta={
            votedCount(laws) === laws.length
              ? `${laws.length}`
              : `${votedCount(laws)} of ${laws.length}`
          }
          level="sub"
        >
          <KeyVoteGroupBlock chamber={chamber} rows={laws} />
        </CardSection>
      )}

      {houseNominationsLine ? (
        // One header, one sentence behind it. Never sixteen rows of the same
        // sentence — but open, because the sentence IS the answer.
        <CardSection title="Votes on people" meta="none" level="sub">
          <p className="t-detail leading-relaxed text-voice">
            {houseNominationsLine}
          </p>
        </CardSection>
      ) : (
        people.length > 0 && (
          <CardSection
            title="Votes on people"
            meta={
              votedCount(people) === people.length
                ? `${people.length}`
                : `${votedCount(people)} of ${people.length}`
            }
            level="sub"
          >
            <KeyVoteGroupBlock chamber={chamber} rows={people} />
          </CardSection>
        )
      )}
    </div>
  );
}

export function KeyVoteGroupBlock({
  chamber,
  rows,
}: {
  chamber: "house" | "senate";
  rows: KeyVoteRow[];
}) {
  return (
    <div>
      <ul>
        {rows.map((row) => (
          <li
            key={row.entry.id}
            data-key-vote={row.entry.id}
            className="border-b border-[var(--panel-border)] py-2 last:border-0"
          >
            <p className="t-body font-medium leading-snug text-paper">
              {row.entry.title}
              {row.entry.pending && (
                <span className="ml-1.5 rounded-full border border-[var(--panel-border)] px-1.5 py-0.5 t-caption font-semibold uppercase trailing-space-trimmed-6 tracking-[0.06em] text-muted">
                  not law yet
                </span>
              )}
            </p>
            {/* The explainer: LEVEL register, anchored to the bill's own
                contents. The title never does the explaining. */}
            <p className="mt-0.5 t-caption leading-relaxed text-voice">
              {row.entry.explainer}
            </p>

            {row.refs.length > 0 ? (
              <>
                {row.refs.map((ref, i) => (
                  <p
                    key={`${ref.congress}-${ref.session}-${ref.rollNumber}`}
                    className="mt-1 t-detail"
                  >
                    {/*
                      A NULL POSITION IS NOT "Did not vote" (fixed 2026-08-15,
                      item 6b). This used to default a null straight into
                      `DID_NOT_VOTE`, which turns "we hold nothing for this
                      person on this roll call" into a specific, checkable,
                      wrong claim about a named member of Congress — and the
                      commonest reason for a null is the most innocent one:
                      they were not in that chamber in 2021. Requirement 4 of
                      this file's own header says exactly this; the render
                      did not obey it until the positions existed to obey it
                      with.
                    */}
                    {(() => {
                      const position = row.positions[i];
                      if (position) {
                        const pill = POSITION_PILL[position];
                        return pill ? (
                          <VotePill tone={pill.tone}>{pill.label}</VotePill>
                        ) : (
                          <VotePill tone="neutral">Position recorded</VotePill>
                        );
                      }
                      // Both of these are GAPS, not positions, and they wear
                      // the outline rather than a colour. The first is a fact
                      // about the member's tenure; the second is a fact about
                      // OUR research. Collapsing either into a position colour
                      // is how a null becomes an assertion.
                      return (
                        <VotePill tone="gap">
                          {row.held?.[i]
                            ? "Not in this chamber for this vote"
                            : "We haven't recorded this vote yet"}
                        </VotePill>
                      );
                    })()}
                    {ref.tally && (
                      <span className="text-muted"> · the vote was {ref.tally}</span>
                    )}
                    {row.breakdowns[i] && (
                      <span className="text-muted"> · {row.breakdowns[i]}</span>
                    )}
                    {ref.url && (
                      <>
                        {" "}
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noreferrer"
                          className="trailing-space-trimmed-10 source-tag font-mono t-caption uppercase tracking-[0.1em] text-muted underline decoration-dotted underline-offset-2 hover:text-link"
                        >
                          the roll call
                        </a>
                      </>
                    )}
                    {ref.verifiedAt && (
                      <span className="text-muted">
                        {" "}
                        · read {formatDateMDY(ref.verifiedAt)}
                      </span>
                    )}
                  </p>
                ))}
                {/* The Senate voted the four April 2024 bills as one. A
                    senator's card says so rather than showing four rows the
                    Senate never took. */}
                {chamber === "senate" && row.entry.siblingGroup === "april-2024" && (
                  <p className="mt-0.5 t-caption leading-relaxed text-muted">
                    {APRIL_2024_SENATE_NOTE}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 t-detail leading-relaxed text-muted">
                {/* Requirement 4. A stated note is a fact about the
                    legislature; its absence is a fact about us, and they are
                    never allowed to render as the same sentence. */}
                {row.note ?? <WorkingOnIt inline />}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
