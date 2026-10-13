"use client";

import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContribution, CardGapsContribution } from "@/components/ui/card-gap-context";

import { useEffect, useState } from "react";

import { blurbForTitle } from "@/lib/officials/office-blurbs";
import type { SeatHolder } from "@/lib/officials/lookup";
import { readerPartyLabel } from "@/lib/text/reader-names";
import type { RollCallVote, VotePosition } from "@/lib/votes/types";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { ReactionControl } from "@/components/reactions/reaction-control";
import { CardSection } from "@/components/officials/card-section";
import {
  KeyVotesSection,
  type KeyVoteRow,
} from "@/components/officials/key-votes-section";
import { PickedKeyVotesSection } from "@/components/officials/picked-key-votes";
import type { PickedKeyVote } from "@/lib/votes/key-vote-picks";
import { votedCount } from "@/lib/votes/participation";
import { explainVoteQuestion } from "@/lib/votes/vote-explainers";
import type { BillSummary } from "@/lib/votes/bill-summaries";
import { officialStateVotesRenderToReader } from "@/lib/state-rollcalls/reader-vote-visibility";

import { PopupSectionLabel } from "./popup-card";

/**
 * Recorded positions as filled pills; the colour states the vote cast, never
 * a judgement. `--vote-no` is a different shade from the party red.
 */
const POSITION_STYLE: Record<VotePosition, { label: string; tone: string }> = {
  YES: { label: "Voted yes", tone: "yes" },
  NO: { label: "Voted no", tone: "no" },
  ABSTAIN: { label: "Abstained", tone: "neutral" },
  PRESENT: { label: "Voted present", tone: "neutral" },
  NOT_VOTING: { label: "Did not vote", tone: "neutral" },
  UNKNOWN: { label: "Publisher position unclassified", tone: "neutral" },
};

/** A recorded position as a pill. `tone="gap"` is the named-gap outline, never a position's colour. */
export function VotePill({
  tone,
  children,
}: {
  tone: "yes" | "no" | "neutral" | "gap";
  children: React.ReactNode;
}) {
  return <span className={`vote-pill vote-pill--${tone}`}>{children}</span>;
}

export type MemberRollCall = RollCallVote & {
  position: VotePosition;
  /** Per-party for/against, or null when it would not sum to the chamber's recorded tally. */
  partyBreakdown: { party: string; yes: number; no: number }[] | null;
  /** Canonical server projection; the client never imports tracked civic data. */
  billSummary: BillSummary | null;
  billSummaryPending: boolean;
  /** Present only for a separately verified predecessor vote window. */
  historicalVersionId?: string;
  historicalSourceThrough?: string | null;
  historicalRetrievedAt?: string | null;
};

/**
 * How many recent roll calls the "Recent" view shows. Count-based, not a time
 * window, since chambers vote in bursts. Nothing is filtered out: procedural
 * votes are included.
 */
const VOTE_LIMIT = 20;

/**
 * The licence attribution a vote store requires, sent by the API with the
 * rows. Federal roll calls carry none; LegiScan state data is CC BY 4.0.
 */
export type VoteAttribution = {
  text: string;
  url: string;
  licence: string;
  licenceUrl: string;
};

/**
 * Whether this holder has a roll-call store we render. `congress:` is the
 * chambers' XML; `plural:` is the LegiScan test fixture; official state
 * legislators render through `/api/votes` where
 * `officialStateVotesRenderToReader` allows. Anything else renders nothing.
 */
function hasVoteRecord(id: string): boolean {
  return id.startsWith("congress:") || id.startsWith("plural:") || officialStateVotesRenderToReader(id);
}

export function RecentVotes(props: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  /** Render as the large card's Voting Record views; the compact card keeps one short list. */
  columns?: boolean;
  /** Full record inside a caller-owned header, including the ballot card. */
  contentOnly?: boolean;
}) {
  // Keyed on the holder so a new holder never shows the previous one's votes.
  return <RecentVotesInner key={props.holder.id} {...props} />;
}

function RecentVotesInner({
  holder,
  reactionContext,
  columns = false,
  contentOnly = false,
}: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  columns?: boolean;
  contentOnly?: boolean;
}) {
  const [votes, setVotes] = useState<MemberRollCall[] | null>(null);
  const [attribution, setAttribution] = useState<VoteAttribution | null>(null);
  const [chamber, setChamber] = useState<"house" | "senate" | null>(null);
  const [keyVotes, setKeyVotes] = useState<KeyVoteRow[]>([]);
  const [pickedKeyVotes, setPickedKeyVotes] = useState<PickedKeyVote[]>([]);
  const [historicalVotes, setHistoricalVotes] = useState<MemberRollCall[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"LOADING" | "COMPLETE" | "MORE" | "UNAVAILABLE">("LOADING");
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyAnchor, setHistoryAnchor] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  // An official state record that is not live yet renders no section (set in
  // the fetch's catch), distinct from `failed`.
  const [absent, setAbsent] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!hasVoteRecord(holder.id)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/votes?member=${holder.id}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as {
          votes: MemberRollCall[];
          attribution?: VoteAttribution;
          chamber?: "house" | "senate" | null;
          keyVotes?: KeyVoteRow[];
          pickedKeyVotes?: PickedKeyVote[];
        };
        setVotes(payload.votes);
        setAttribution(payload.attribution ?? null);
        setChamber(payload.chamber ?? null);
        setKeyVotes(payload.keyVotes ?? []);
        setPickedKeyVotes(payload.pickedKeyVotes ?? []);
      } catch {
        if (controller.signal.aborted) return;
        // An official state record not live yet renders nothing, never "couldn't load".
        if (officialStateVotesRenderToReader(holder.id)) setAbsent(true);
        else setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [holder.id]);

  const recentLoaded = votes !== null;
  useEffect(() => {
    if (!/^congress:[A-Z]\d{6}$/.test(holder.id) || !recentLoaded) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/votes?member=${encodeURIComponent(holder.id)}&history=1`,
          { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const page = await response.json() as { historicalVotes: MemberRollCall[];
          historyStatus: "COMPLETE" | "MORE" | "UNAVAILABLE";
          nextHistoricalVersionId: string | null; currentVersionId?: string };
        setHistoricalVotes(page.historicalVotes);
        setHistoryStatus(page.historyStatus);
        setHistoryCursor(page.nextHistoricalVersionId);
        setHistoryAnchor(page.currentVersionId ?? null);
      } catch {
        if (!controller.signal.aborted) setHistoryStatus("UNAVAILABLE");
      }
    })();
    return () => controller.abort();
  }, [holder.id, recentLoaded]);

  const loadMoreHistory = async () => {
    if (!historyCursor || !historyAnchor || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    try {
      const response = await fetch(`/api/votes?member=${encodeURIComponent(holder.id)}&history=1&cursor=${encodeURIComponent(historyCursor)}&anchor=${encodeURIComponent(historyAnchor)}`);
      if (!response.ok) throw new Error(String(response.status));
      const page = await response.json() as { historicalVotes: MemberRollCall[];
        historyStatus: "COMPLETE" | "MORE" | "UNAVAILABLE";
        nextHistoricalVersionId: string | null; currentVersionId?: string };
      if (page.currentVersionId !== historyAnchor) throw new Error("Vote history anchor moved");
      setHistoricalVotes(previous => {
        const seen = new Set(previous.map(vote => vote.id));
        return [...previous, ...page.historicalVotes.filter(vote => !seen.has(vote.id))];
      });
      setHistoryStatus(page.historyStatus);
      setHistoryCursor(page.nextHistoricalVersionId);
    } catch {
      setHistoryStatus("UNAVAILABLE");
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const hasRecent = Boolean(votes?.length);
  const hasKeyVotes = Boolean(chamber && keyVotes.length > 0) || pickedKeyVotes.some(pick => pick.roll || pick.why);
  const hasHistory = historicalVotes.length > 0;
  const canLoadHistory = /^congress:[A-Z]\d{6}$/.test(holder.id) && recentLoaded;
  const recordGap = <CardGapContribution id={`votes:${holder.id}`} label="voting record" subject={{ type: "CANDIDATE", id: holder.id }} />;

  if (!hasRecent && !hasKeyVotes && !hasHistory) {
    if (!hasVoteRecord(holder.id) || failed || absent) return recordGap;
    if (!recentLoaded || (canLoadHistory && historyStatus === "LOADING")) {
      return <p className="mw-loading-inline" role="status">Loading voting records…</p>;
    }
    return recordGap;
  }
  const gaps = <>
    {!hasRecent && <CardGapContribution id={`recent-votes:${holder.id}`} label="recent votes" />}
    {canLoadHistory && historyStatus === "UNAVAILABLE" && <CardGapContribution id={`earlier-votes:${holder.id}`} label="earlier voting records" />}
  </>;

  const visibleVotes = votes?.slice(0, showAll ? undefined : VOTE_LIMIT) ?? null;
  const history = hasHistory ? <>
    <p className="mb-1.5 t-caption leading-relaxed text-voice">
      Earlier recorded votes from verified prior source windows. These are separate from the current Recent list.
    </p>
    <RecentVoteRecords votes={historicalVotes} attribution={null} failed={false} reactionContext={null} />
    {historyStatus === "MORE" && historyCursor && <button type="button" onClick={() => void loadMoreHistory()}
      disabled={historyLoadingMore} className="mt-2 t-detail text-link underline decoration-dotted underline-offset-2">
      {historyLoadingMore ? "Checking more earlier records…" : "Load more earlier records"}
    </button>}
  </> : null;
  const recent = hasRecent ? <>
    <RecentVoteRecords votes={visibleVotes} attribution={attribution} failed={false} reactionContext={reactionContext} />
    {(columns || contentOnly) && votes && votes.length > 0 && <>
      <p className="mt-2 t-caption text-muted" data-recent-vote-count={visibleVotes!.length}>
        Showing {visibleVotes!.length} of {votes.length} recorded votes.
      </p>
      {votes.length > VOTE_LIMIT && <button type="button" data-recent-votes-expand
        className="mt-1 t-detail text-link underline decoration-dotted underline-offset-2"
        onClick={() => setShowAll(value => !value)}>
        {showAll ? `Show latest ${VOTE_LIMIT}` : `Show all ${votes.length} recorded votes`}
      </button>}
    </>}
  </> : null;

  /* The compact glance card keeps the flat short list. */
  if (!columns && !contentOnly) {
    return (
      <>
        {gaps}
        {recent && <><PopupSectionLabel>Recent votes</PopupSectionLabel>{recent}</>}
        {history && <details className="mt-2"><summary className="cursor-pointer t-detail text-link">Earlier recorded votes</summary>{history}</details>}
      </>
    );
  }

  /*
   * One "Voting Record" section with Recent and When it mattered as selectors.
   * Each view is a complete answer; overlap between them is unmarked.
   */
  const fullRecord = (
      <VotingRecordViews
        recent={recent}
        recentMeta={votes ? `${showAll ? "all" : "last"} ${visibleVotes!.length}` : null}
        keyVotes={
          hasKeyVotes ? (
            <>
              {chamber && keyVotes.length > 0 && <KeyVotesSection chamber={chamber} rows={keyVotes} />}
              <PickedKeyVotesSection picks={pickedKeyVotes} />
            </>
          ) : null
        }
        /* Counts the votes the member participated in; full denominators are stated per group inside. */
        keyVotesMeta={
          keyVotes.length > 0 ? String(votedCount(keyVotes)) : null
        }
        history={history}
        historyMeta={historicalVotes.length > 0 ? String(historicalVotes.length) : null}
      />
  );
  return <>{gaps}{contentOnly ? fullRecord : <CardSection title="Voting Record">{fullRecord}</CardSection>}</>;
}

/** The actual recent-vote records used by both full cards and their preview. */
export function RecentVoteRecords({ votes, attribution, failed, reactionContext }: {
  votes: MemberRollCall[] | null;
  attribution: VoteAttribution | null;
  failed: boolean;
  reactionContext: ReactionViewContext | null;
}) {
  return (
    <>
      {failed ? <CardGapContribution id="recent-votes" label="recent votes" /> : votes === null ? (
        <p className="mt-1.5 t-caption leading-relaxed text-muted">Loading…</p>
      ) : votes.length === 0 ? <CardGapContribution id="recent-votes" label="recent votes" /> : (
        <>
          <CardGapsContribution id="vote-details" gaps={votes.flatMap(vote => [
            ...(!vote.partyBreakdown ? [{ id: `vote-parties:${vote.id}`, label: "party vote totals", unit: "vote" }] : []),
            ...(vote.billUrl && !vote.billSummary ? [{ id: `vote-summary:${vote.id}`, label: "bill summaries", unit: "vote" }] : []),
          ])} />
          <CardSourcesContribution id="recent-votes" sources={[
            ...(attribution ? [{ what: `Vote data attribution and ${attribution.licence} licence`, provenance: { sourceUrl: attribution.url, sourceOrg: attribution.text, collectedAt: "", verifiedAt: null } }, { what: "Vote data licence", provenance: { sourceUrl: attribution.licenceUrl, sourceOrg: attribution.text, collectedAt: "", verifiedAt: null } }] : []),
            ...votes.map(vote => ({ what: `Roll call: ${vote.title}`, provenance: { sourceUrl: vote.rollCallUrl, sourceOrg: attribution?.text ?? "", collectedAt: "", verifiedAt: null } })),
            ...votes.flatMap(vote => vote.billUrl ? [{ what: "Official bill summary; plain-language summary is ours", provenance: { sourceUrl: vote.billUrl, sourceOrg: "", collectedAt: "", verifiedAt: null } }] : []),
          ]} />
          {votes.map((vote) => {
            const explainer = explainVoteQuestion(vote.question);
            return (
              <div
                key={vote.id}
                data-recent-vote-id={vote.id}
                className="mt-2 border-b border-[var(--panel-border)] pb-2 last:border-0"
              >
                {/* The official title, never ours. */}
                <p className="t-detail leading-snug">{vote.title}</p>

                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 t-caption">
                  <VotePill tone={POSITION_STYLE[vote.position].tone as "yes" | "no" | "neutral"}>
                    {POSITION_STYLE[vote.position].label}
                  </VotePill>
                  <span className="text-muted">
                    {vote.question} · {vote.result}
                    {vote.legisNum ? ` · ${vote.legisNum}` : ""}
                  </span>
                </p>
                {/* Party numbers from the roll call, refused server-side unless they sum to the tally. Numbers only. */}
                {vote.partyBreakdown ? (
                  <p className="mt-1 t-caption leading-relaxed text-paper-dim">
                    How the parties voted:{" "}
                    {vote.partyBreakdown.map((t, j) => (
                      <span key={t.party}>
                        {j > 0 && <span className="text-muted"> · </span>}
                        {readerPartyLabel(t.party) ?? t.party} {t.yes} for, {t.no} against
                      </span>
                    ))}
                  </p>
                ) : null}
                {explainer && (
                  // What kind of vote this was and the mechanical meaning of a No on it; never evaluative.
                  <p className="mt-1 t-caption leading-relaxed text-paper-dim">
                    {explainer.plain}{" "}
                    <span className="text-muted">{explainer.noMeans}</span>
                  </p>
                )}
                <BillPlainSummary
                  billUrl={vote.billUrl}
                  summary={vote.billSummary}
                  pending={vote.billSummaryPending}
                />

                {/* Asked after the record, never before it. */}
                <ReactionControl
                  targetType="FEDERAL_VOTE"
                  targetId={vote.id}
                  prompt="Do you like this vote?"
                  context={reactionContext}
                  frame="compact"
                />
              </div>
            );
          })}
          <p className="mt-2 t-caption leading-relaxed text-muted">
            Colors state their vote — green for yes, red for no, gray for
            present or not voting — never our opinion of it. Titles are the
            official record&apos;s words.
          </p>
        </>
      )}
    </>
  );

}

/**
 * The two views inside Voting Record. One is always selected. The selector is
 * `aria-pressed` rather than a nested tablist.
 */
function VotingRecordViews({
  recent,
  recentMeta,
  keyVotes,
  keyVotesMeta,
  history,
  historyMeta,
}: {
  recent: React.ReactNode;
  recentMeta: string | null;
  keyVotes: React.ReactNode;
  keyVotesMeta: string | null;
  history: React.ReactNode;
  historyMeta: string | null;
}) {
  const [view, setView] = useState<"recent" | "key" | "history">("recent");
  const available = { recent, key: keyVotes, history };
  const selected = available[view] ? view : recent ? "recent" : keyVotes ? "key" : "history";

  return (
    <div>
      <div className="vote-view-switch">
        {recent && <button
          type="button"
          className="vote-view-btn"
          data-selected={selected === "recent" || undefined}
          aria-pressed={selected === "recent"}
          onClick={() => setView("recent")}
        >
          Recent
          {recentMeta && <span className="vote-view-meta">{recentMeta}</span>}
        </button>}
        {keyVotes && (
          <button
            type="button"
            className="vote-view-btn"
            data-selected={selected === "key" || undefined}
            aria-pressed={selected === "key"}
            onClick={() => setView("key")}
          >
            When it mattered
            {keyVotesMeta && <span className="vote-view-meta">{keyVotesMeta}</span>}
          </button>
        )}
        {history && <button type="button" className="vote-view-btn"
          data-selected={selected === "history" || undefined} aria-pressed={selected === "history"}
          onClick={() => setView("history")}>
          Earlier records{historyMeta && <span className="vote-view-meta">{historyMeta}</span>}
        </button>}
      </div>

      {selected === "recent" ? (
        <div className="vote-view-body">
          <p className="mb-1.5 t-caption leading-relaxed text-voice">
            Every roll call they cast, newest first — including the procedural
            ones. Voting to set a bill aside is a way of deciding it.
          </p>
          {recent}
        </div>
      ) : selected === "key" ? (
        <div className="vote-view-body">{keyVotes}</div>
      ) : (
        <div className="vote-view-body">{history}</div>
      )}
    </div>
  );
}

/**
 * The curated plain-language bill summary behind an expander, cited to the
 * CRS summary it paraphrases. A pending bill renders the coming state.
 */
export function BillPlainSummary({
  summary,
}: {
  billUrl: string | null;
  summary: BillSummary | null;
  pending: boolean;
}) {
  if (!summary) return null;
  return (
    <details className="mt-1" open>
      <summary className="cursor-pointer t-caption text-paper-dim underline decoration-dotted hover:text-signal">
        What this bill does — plain language
      </summary>
      <p className="mt-1 t-caption font-semibold leading-relaxed text-paper-dim">
        {summary.summary}
      </p>
    </details>
  );
}

export function OfficeBlurb({
  holder,
  bare = false,
}: {
  holder: SeatHolder;
  /** The CardSection header names it; drop the duplicate label. */
  bare?: boolean;
}) {
  // Resolved against the holder's own jurisdiction, never a per-type default.
  const blurb = blurbForTitle(
    holder.officeTitle,
    holder.officeJurisdictionOcdId,
  );
  if (!blurb) return <CardGapContribution id={`office-role:${holder.id}`} label="office responsibilities" subject={{ type: "CANDIDATE", id: holder.id }} />;
  return (
    <>
      {!bare && <PopupSectionLabel>What this office does</PopupSectionLabel>}
      <p className="mt-1.5 t-detail leading-relaxed text-paper-dim">
        {blurb.text}
      </p>
      <p className="mt-1 t-caption text-muted">
        Powers defined in:{" "}
        {blurb.basisUrl ? (
          <a
            href={blurb.basisUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted hover:text-signal"
          >
            {blurb.basis}
          </a>
        ) : (
          blurb.basis
        )}
      </p>
    </>
  );
}
