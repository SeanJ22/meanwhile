import { WorkingOnIt } from "@/components/demand/working-on-it";
import {
  APRIL_2024_SENATE_NOTE,
  KEY_VOTES_CRITERIA,
  type KeyVoteEntry,
} from "@/lib/votes/key-votes";
import { votedCount } from "@/lib/votes/participation";
import type { VotePosition } from "@/lib/votes/types";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";

import { VotePill } from "@/components/map/popup/official-popup";

import { CardSection } from "./card-section";

/**
 * Key votes: a fixed list of questions, each answered by this member's own
 * chamber's roll calls. Never a score; the criteria sentence renders above the
 * list; a member's card shows only their chamber's votes. "No vote here" has
 * three distinct sentences: the chamber does not vote on it, the member did
 * not vote or was not in office, or we have not recorded it yet.
 */

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
 * Positions as filled pills, the same grammar as the Recent view. A named gap
 * renders `tone="gap"`, an outline, never a position colour.
 */
const POSITION_PILL: Record<string, { label: string; tone: "yes" | "no" | "neutral" }> = {
  YES: { label: "Voted yes", tone: "yes" },
  NO: { label: "Voted no", tone: "no" },
  PRESENT: { label: "Voted present", tone: "neutral" },
  /*
   * `NOT_VOTING` is what scripts/fetch-key-vote-positions.mts writes for a
   * seated member who did not vote; `DID_NOT_VOTE` is the other vocabulary
   * callers may supply. Both are neutral: a recorded absence, not a position.
   */
  NOT_VOTING: { label: "Did not vote", tone: "neutral" },
  DID_NOT_VOTE: { label: "Did not vote", tone: "neutral" },
};

/**
 * Newest first by congress, session and roll number (the chamber's own
 * numbering). Entries with no roll call sort last and stay in the stated N.
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
   * On House cards, Votes on people collapses to the one line that the House
   * does not vote on nominations. A Senate card gets both groups in full.
   */
  const houseNominationsLine =
    chamber === "house"
      ? (people.find((r) => r.note)?.note ??
        "The House doesn't vote on nominations.")
      : null;

  return (
    <div>
      {/* The rule the list was picked by, verbatim, at the head of the column. */}
      <p className="t-caption leading-relaxed text-voice">
        {KEY_VOTES_CRITERIA}
      </p>

      {/* Both sub-groups start collapsed; each header states its count. */}
      {laws.length > 0 && (
        <CardSection
          title="Votes on laws"
          /* Two numbers: votes the member cast, and the full curated list. */
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
        // One header, one sentence; open, because the sentence is the answer.
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
      <CardSourcesContribution id={`key-votes:${chamber}:${rows.map(row => row.entry.id).join(",")}`} sources={rows.flatMap(row => row.refs.map(ref => ({ what: row.entry.title, provenance: { sourceUrl: ref.url, sourceOrg: chamber === "house" ? "U.S. House of Representatives" : "U.S. Senate", collectedAt: ref.verifiedAt ?? "", verifiedAt: ref.verifiedAt } })))} />
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
            {/* The explainer is anchored to the bill's own contents. */}
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
                    {/* A null position is not "Did not vote". */}
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
                      // Both are gaps and wear the outline: tenure, or our research.
                      return row.held?.[i] ? <VotePill tone="gap">Not in this chamber for this vote</VotePill> : <WorkingOnIt inline />;
                    })()}
                    {ref.tally && (
                      <span className="text-muted"> · the vote was {ref.tally}</span>
                    )}
                    {row.breakdowns[i] && (
                      <span className="text-muted"> · {row.breakdowns[i]}</span>
                    )}

                  </p>
                ))}
                {/* The Senate voted the four April 2024 bills as one. */}
                {chamber === "senate" && row.entry.siblingGroup === "april-2024" && (
                  <p className="mt-0.5 t-caption leading-relaxed text-muted">
                    {APRIL_2024_SENATE_NOTE}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 t-detail leading-relaxed text-muted">
                {/* A stated note is a fact about the legislature; its absence is ours. */}
                {row.note ?? <WorkingOnIt inline />}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
