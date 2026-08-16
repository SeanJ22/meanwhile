import {
  APRIL_2024_SENATE_NOTE,
  KEY_VOTES_CRITERIA,
  type KeyVoteEntry,
} from "@/lib/votes/key-votes";
import type { VotePosition } from "@/lib/votes/types";
import { formatDateMDY } from "@/lib/map/format";

/**
 * The key votes section (B15) — the author's fixed list of questions, each
 * answered by this member's OWN chamber's roll call.
 *
 * ## Four things this must never become
 *
 * 1. **A score.** Nothing here is summed, averaged, graded or ordered by
 *    agreement with anything. The list order is the author's, fixed, and
 *    identical on every member's card.
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

const LABEL_CLASS = "t-eyebrow text-muted";

export interface KeyVoteRow {
  entry: KeyVoteEntry;
  /** The member's own chamber's roll calls for this entry. */
  refs: KeyVoteEntry["house"];
  /** The member's position per roll call, index-matched to `refs`. */
  positions: (VotePosition | "DID_NOT_VOTE" | null)[];
  /** Party breakdown per roll call, already gated to the chamber's tally. */
  breakdowns: (string | null)[];
  /** The stated note for a chamber with no vote to show, if the entry has one. */
  note: string | null;
}

const POSITION_LABEL: Record<string, string> = {
  YES: "Voted yes",
  NO: "Voted no",
  PRESENT: "Voted present",
  DID_NOT_VOTE: "Did not vote",
};

export function KeyVotesSection({
  chamber,
  rows,
}: {
  chamber: "house" | "senate";
  rows: KeyVoteRow[];
}) {
  if (rows.length === 0) return null;
  const laws = rows.filter((r) => r.entry.group === "LAWS");
  const people = rows.filter((r) => r.entry.group === "PEOPLE");

  return (
    <div className="mt-3 rounded-md border border-[var(--panel-border)] p-3">
      <p className={LABEL_CLASS}>Key votes</p>
      {/* Requirement 2: the rule the list was picked by, on the surface,
          verbatim. Not a link to it, not a summary of it. */}
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">
        {KEY_VOTES_CRITERIA}
      </p>

      {laws.length > 0 && (
        <KeyVoteGroupBlock title="Votes on laws" chamber={chamber} rows={laws} />
      )}
      {people.length > 0 && (
        <KeyVoteGroupBlock title="Votes on people" chamber={chamber} rows={people} />
      )}
    </div>
  );
}

function KeyVoteGroupBlock({
  title,
  chamber,
  rows,
}: {
  title: string;
  chamber: "house" | "senate";
  rows: KeyVoteRow[];
}) {
  return (
    <div className="mt-2.5">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted">
        {title}
      </p>
      <ul className="mt-1">
        {rows.map((row) => (
          <li
            key={row.entry.id}
            data-key-vote={row.entry.id}
            className="border-b border-[var(--panel-border)] py-2 last:border-0"
          >
            <p className="text-[0.8125rem] font-medium leading-snug text-paper">
              {row.entry.title}
              {row.entry.pending && (
                <span className="ml-1.5 rounded-full border border-[var(--panel-border)] px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-[0.06em] text-muted">
                  not law yet
                </span>
              )}
            </p>
            {/* The explainer: LEVEL register, anchored to the bill's own
                contents. The title never does the explaining. */}
            <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-voice">
              {row.entry.explainer}
            </p>

            {row.refs.length > 0 ? (
              <>
                {row.refs.map((ref, i) => (
                  <p
                    key={`${ref.congress}-${ref.session}-${ref.rollNumber}`}
                    className="mt-1 text-[0.75rem]"
                  >
                    <span className="font-semibold text-paper">
                      {POSITION_LABEL[row.positions[i] ?? "DID_NOT_VOTE"] ??
                        "Did not vote"}
                    </span>
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
                          className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted underline decoration-dotted underline-offset-2 hover:text-link"
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
                  <p className="mt-0.5 text-[0.625rem] leading-relaxed text-muted">
                    {APRIL_2024_SENATE_NOTE}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
                {/* Requirement 4. A stated note is a fact about the
                    legislature; its absence is a fact about us, and they are
                    never allowed to render as the same sentence. */}
                {row.note ??
                  "We haven't recorded this chamber's vote on this yet — that's a gap in our research, not a statement that no vote happened."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
