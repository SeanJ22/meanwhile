import type { PickedKeyVote } from "@/lib/votes/key-vote-picks";
import type { VotePosition } from "@/lib/votes/types";
import { formatDateMDY } from "@/lib/map/format";

import { VotePill } from "@/components/map/popup/official-popup";

/**
 * Key votes Sean picked (CA-46), beside the reviewed list and the full record.
 * The wording, date and result are the chamber's own; the reason is Sean's, said
 * as his. A position we do not hold is our gap, never "did not vote".
 */
const POSITION: Record<VotePosition, { label: string; tone: "yes" | "no" | "neutral" }> = {
  YES: { label: "Voted yes", tone: "yes" },
  NO: { label: "Voted no", tone: "no" },
  ABSTAIN: { label: "Abstained", tone: "neutral" },
  PRESENT: { label: "Voted present", tone: "neutral" },
  NOT_VOTING: { label: "Did not vote", tone: "neutral" },
  UNKNOWN: { label: "Publisher position unclassified", tone: "neutral" },
};

export function PickedKeyVotesSection({ picks }: { picks: readonly PickedKeyVote[] }) {
  if (picks.length === 0) return null;
  return (
    <div data-picked-key-votes="">
      <p className="text-[0.6875rem] leading-relaxed text-voice">Votes Sean picked.</p>
      {picks.map((pick) => (
        <div key={pick.rollId} data-picked-vote-id={pick.rollId} className="mt-2 border-b border-[var(--panel-border)] pb-2 last:border-0">
          {pick.roll ? (
            <>
              <p className="text-[0.75rem] leading-snug">{pick.roll.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem]">
                {pick.position ? (
                  <VotePill tone={POSITION[pick.position].tone}>{POSITION[pick.position].label}</VotePill>
                ) : (
                  <VotePill tone="gap">We&rsquo;re working on getting this info</VotePill>
                )}
                <span className="text-muted">
                  {formatDateMDY(pick.roll.date)} · {pick.roll.question} · {pick.roll.result}
                  {pick.roll.legisNum ? ` · ${pick.roll.legisNum}` : ""}
                </span>
              </p>
              <p className="mt-0.5 text-[0.625rem] text-muted">
                <a className="underline underline-offset-2" href={pick.roll.rollCallUrl} target="_blank" rel="noreferrer">The chamber&rsquo;s roll call ↗</a>
              </p>
            </>
          ) : (
            <p className="text-[0.75rem] leading-snug">We&rsquo;re working on getting this info.</p>
          )}
          {pick.why && <p className="mt-1 text-[0.6875rem] text-paper-dim">Sean&rsquo;s note: {pick.why}</p>}
        </div>
      ))}
    </div>
  );
}
