"use client";

import { useEffect, useState } from "react";

import { blurbForTitle } from "@/lib/officials/office-blurbs";
import { divisionOcdIdForRosterHolder } from "@/lib/registry/body-rosters";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import { ageFrom, inSeatUntil } from "@/lib/officials/tenure";
import type { Tier } from "@/lib/ocd/tiers";
import type { RollCallVote, VotePosition } from "@/lib/votes/types";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { ReactionControl } from "@/components/reactions/reaction-control";
import { CardSection } from "@/components/officials/card-section";
import {
  KeyVotesSection,
  type KeyVoteRow,
} from "@/components/officials/key-votes-section";
import { explainVoteQuestion } from "@/lib/votes/vote-explainers";
import {
  summaryForBill,
  summaryPendingForBill,
} from "@/lib/votes/bill-summaries";

import { PopupCard, PopupRow, PopupSectionLabel } from "./popup-card";

/**
 * The rep surfaces (3c), in the two-tier architecture:
 *
 * - **`OfficialPopup`** — the compact glance card: who they are and how to
 *   reach them, with an obvious "More" opening the large tier.
 * - The **large tier** (`official-modal.tsx`) composes the shared pieces
 *   exported here: identity, contact, the roll-call record with reaction
 *   capture, and the office blurb.
 *
 * Everything rendered traces to a published record — the roster row (linked
 * as SOURCE), the licensed photo manifest, the curated campaign-site
 * overlay. The office blurb describes the *office*, never the holder, and
 * the campaign site is always labeled as such with the official page first.
 * A missing photo renders initials, never a broken image.
 */

interface OfficialPopupProps {
  holder: SeatHolder;
  /** The seat's label — "AZ-6", "State House District 19". */
  seatLabel: string | null;
  tier: Tier;
  /** Opens the large tier. The compact card is the glance layer. */
  onExpand?: () => void;
  onClose?: () => void;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * The four recorded states, visually unmistakable (5). The colors state
 * the member's VOTE — what they cast, never whether it was good. The legend
 * below the list says exactly that.
 */
const POSITION_STYLE: Record<
  VotePosition,
  { label: string; color: string }
> = {
  YES: { label: "YES", color: "var(--accent-state)" },
  NO: { label: "NO", color: "var(--danger)" },
  PRESENT: { label: "PRESENT", color: "var(--accent-national)" },
  NOT_VOTING: { label: "NOT VOTING", color: "var(--text-muted)" },
};

type MemberRollCall = RollCallVote & {
  position: VotePosition;
  /** Item 3: per-party for/against, or null when it wouldn't sum to the
   *  chamber's recorded tally — the honest unavailable state. */
  partyBreakdown: { party: string; yes: number; no: number }[] | null;
};

/**
 * How many recent roll calls the "Recent" column shows.
 *
 * **Count-based, not a time window** (item 6b, the author's design): a
 * congress votes in bursts, and "the last 30 days" is forty roll calls in one
 * week and none in the next. Twenty self-adjusts to the chamber's own rhythm
 * and always fills the column.
 *
 * **Nothing is filtered out of it, and nothing is footnoted as lesser.** The
 * author's order: procedural votes — tabling, cloture, rules — are exactly
 * where a member's real position often lives, because voting to table a bill
 * is voting to kill it without going on record against it. This column shows
 * every roll call the member cast, in the chamber's own words, with the plain
 * function of the motion beside it.
 *
 * Was 5 until 2026-08-15.
 */
const VOTE_LIMIT = 20;

/**
 * The licence attribution a vote store requires, when it requires one.
 *
 * Federal roll calls come from the chambers' own public-domain XML and carry
 * none. LegiScan's state data is CC BY 4.0 and the licence requires
 * attribution wherever it appears, so the API sends it with the rows and this
 * renders it — never a hardcoded string on the client, which could drift from
 * the store it describes.
 */
type VoteAttribution = {
  text: string;
  url: string;
  licence: string;
  licenceUrl: string;
};

/**
 * Whether this holder has a roll-call store at all.
 *
 * `congress:` — the chambers' XML (5). `plural:` — a state legislator, from
 * LegiScan (D49, 2026-08-15). Anything else, a county commissioner or a
 * selectboard member, has no roll-call store, and the section renders nothing
 * rather than an empty heading.
 */
function hasVoteRecord(id: string): boolean {
  return id.startsWith("congress:") || id.startsWith("plural:");
}

export function RecentVotes(props: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  /**
   * Item 6b (2026-08-15): render as the two-column architecture — "Recent"
   * beside "When it mattered", each its own collapsed section — rather than
   * as one flat list. The large card passes this; the compact glance card
   * does not, and keeps its single short list.
   */
  columns?: boolean;
}) {
  // Keyed on the holder so a holder change discards the fetched record
  // structurally — a new holder never wears the previous one's votes
  // (D40 hygiene, same shape as the funding block).
  return <RecentVotesInner key={props.holder.id} {...props} />;
}

function RecentVotesInner({
  holder,
  reactionContext,
  columns = false,
}: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  columns?: boolean;
}) {
  const [votes, setVotes] = useState<MemberRollCall[] | null>(null);
  const [attribution, setAttribution] = useState<VoteAttribution | null>(null);
  const [chamber, setChamber] = useState<"house" | "senate" | null>(null);
  const [keyVotes, setKeyVotes] = useState<KeyVoteRow[]>([]);
  const [failed, setFailed] = useState(false);

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
        };
        setVotes(payload.votes);
        setAttribution(payload.attribution ?? null);
        setChamber(payload.chamber ?? null);
        setKeyVotes(payload.keyVotes ?? []);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [holder.id]);

  // A holder with no vote store renders nothing here — never an empty
  // "Recent votes" heading, which reads as "this person does not vote".
  if (!hasVoteRecord(holder.id)) return null;

  const recent = (
    <>
      {failed ? (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
          Couldn&apos;t load the vote record just now.
        </p>
      ) : votes === null ? (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
          Loading…
        </p>
      ) : votes.length === 0 ? (
        <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
          No recorded votes on file in our current window yet.
        </p>
      ) : (
        <>
          {/* 5c (2026-08-17): attribution once, TOS pattern — stated at the
              top of the section instead of repeated under every bill. */}
          <p className="mt-1 text-[0.5625rem] leading-relaxed text-muted">
            Plain-language bill summaries below are ours — each paraphrases
            the bill&apos;s official summary, linked on its row.
          </p>
          {/* D49 (2026-08-15): the CC BY 4.0 attribution LegiScan's licence
              requires, wherever its data appears. Sent with the rows so it
              cannot drift from the store it describes. */}
          {attribution && (
            <p className="mt-0.5 text-[0.5625rem] leading-relaxed text-muted">
              Vote records from{" "}
              <a
                href={attribution.url}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted hover:text-signal"
              >
                {attribution.text}
              </a>
              , under{" "}
              <a
                href={attribution.licenceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted hover:text-signal"
              >
                {attribution.licence}
              </a>
              .
            </p>
          )}
          {votes.slice(0, VOTE_LIMIT).map((vote) => {
            const explainer = explainVoteQuestion(vote.question);
            return (
              <div
                key={vote.id}
                className="mt-2 border-b border-[var(--panel-border)] pb-2 last:border-0"
              >
                {/* Plain words first — the official title, never ours. */}
                <p className="text-[0.75rem] leading-snug">{vote.title}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[0.6875rem]">
                  <span
                    className="font-mono font-semibold tracking-[0.08em]"
                    style={{ color: POSITION_STYLE[vote.position].color }}
                  >
                    {POSITION_STYLE[vote.position].label}
                  </span>
                  <span className="text-muted">
                    {vote.question} · {vote.result}
                    {vote.legisNum ? ` · ${vote.legisNum}` : ""}
                  </span>
                </p>
                {/* Item 3 (2026-08-14 second session): how the parties
                    voted, under the member's own vote. Real numbers from
                    the roll call, refused server-side unless they sum to
                    the recorded tally. Numbers only — no "party-line"
                    labels, no "crossed the aisle"; the reader concludes. */}
                {vote.partyBreakdown ? (
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-paper-dim">
                    How the parties voted:{" "}
                    {vote.partyBreakdown.map((t, j) => (
                      <span key={t.party}>
                        {j > 0 && <span className="text-muted"> · </span>}
                        {t.party} {t.yes} for, {t.no} against
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
                    A party-by-party count isn&apos;t available for this
                    vote.
                  </p>
                )}
                {explainer && (
                  // The vote-type explainer (4b): what kind of vote this was,
                  // in plain words — "yes then no on the same act" reads as
                  // incoherence until the reader knows one was procedural.
                  // 5b (2026-08-17): plus the mechanical meaning of a No on
                  // this vote type, from the same data file — never
                  // evaluative.
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-paper-dim">
                    {explainer.plain}{" "}
                    <span className="text-muted">{explainer.noMeans}</span>
                  </p>
                )}
                <BillPlainSummary billUrl={vote.billUrl} />
                <p className="mt-0.5 text-[0.625rem]">
                  <a
                    href={vote.rollCallUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted underline decoration-dotted hover:text-signal"
                  >
                    roll call
                  </a>
                  {vote.billUrl && (
                    <>
                      {" · "}
                      <a
                        href={vote.billUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted underline decoration-dotted hover:text-signal"
                      >
                        the bill and its official summary
                      </a>
                    </>
                  )}
                </p>
                {/* The sensor (P03): asked after the record, never before it.
                    6c: the compact frame — as prominent as the ballot's, not
                    as large, because a card carries a dozen of these. */}
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
          <p className="mt-2 text-[0.5625rem] leading-relaxed text-muted">
            Colors state their vote — green YES, red NO, blue PRESENT, gray
            NOT VOTING — never our opinion of it. Titles are the official
            record&apos;s words.
          </p>
        </>
      )}
    </>
  );

  /*
   * The compact glance card keeps the flat short list it always had — it is
   * a glance, and two collapsed columns inside a 300px popup would be two
   * things to tap before seeing anything.
   */
  if (!columns) {
    return (
      <>
        <PopupSectionLabel>Recent votes</PopupSectionLabel>
        {recent}
      </>
    );
  }

  /*
   * Item 6b (2026-08-15) — the author's architecture, two columns:
   *
   *   "Recent"          — the last 20 roll calls, ALL of them, procedural
   *                       included and none footnoted as lesser.
   *   "When it mattered" — the B15 curated list, with its published criteria
   *                       sentence at the column's head.
   *
   * **Overlap is expected and unmarked.** A recent vote that is also a
   * when-it-mattered vote appears in both, because each column has to be a
   * complete answer to its own question. Cross-marking them would make one
   * column look like a subset of the other, and time deduplicates them
   * naturally anyway.
   *
   * Both collapsed by default: the card's opening view is identity, contact
   * and funding, with the record one tap down.
   *
   * Side by side on a desktop, stacked at 390px — `.vote-columns` is a grid
   * that becomes two columns above 720px. Same information architecture
   * either way, which is the difference between a responsive design and a
   * phone version.
   */
  return (
    <div className="vote-columns">
      <CardSection
        title="Recent"
        meta={votes ? `last ${Math.min(votes.length, VOTE_LIMIT)}` : null}
      >
        <p className="mb-1.5 text-[0.6875rem] leading-relaxed text-voice">
          Every roll call they cast, newest first — including the procedural
          ones. Voting to set a bill aside is a way of deciding it.
        </p>
        {recent}
      </CardSection>

      {chamber && keyVotes.length > 0 && (
        <CardSection title="When it mattered">
          <KeyVotesSection chamber={chamber} rows={keyVotes} />
        </CardSection>
      )}
    </div>
  );
}

/**
 * The curated plain-language bill summary (item 4, 2026-08-16), behind the
 * reader gesture — expansion. Labeled, cited to the CRS summary it
 * paraphrases, with the official record staying one click away on the row.
 * A bill honestly pending renders the coming state; the vote row is never
 * blocked either way.
 */
function BillPlainSummary({ billUrl }: { billUrl: string | null }) {
  const summary = summaryForBill(billUrl);
  const pending = summaryPendingForBill(billUrl);
  if (!summary && !pending) return null;
  if (!summary) {
    return (
      <p className="mt-1 text-[0.625rem] leading-relaxed text-muted">
        Official summary at the bill link — plain-language version coming.
      </p>
    );
  }
  // 5a (2026-08-17): open by default — the summary is the point of the row,
  // and hiding it behind a click was reader friction. The collapse
  // affordance stays for closing. 5c moved the "ours" attribution to the
  // section top; the per-bill basis stays in the data file.
  return (
    <details className="mt-1" open>
      <summary className="cursor-pointer text-[0.6875rem] text-paper-dim underline decoration-dotted hover:text-signal">
        What this bill does — plain language
      </summary>
      {/* 3b: the product's voice renders BOLD. */}
      <p className="mt-1 text-[0.6875rem] font-semibold leading-relaxed text-paper-dim">
        {summary.summary}
      </p>
    </details>
  );
}

export function OfficialIdentity({
  holder,
  seatLabel,
  large = false,
}: {
  holder: SeatHolder;
  seatLabel: string | null;
  /** The expanded surface earns a bigger portrait (3h, 2026-08-16). */
  large?: boolean;
}) {
  return (
    <div className="mt-2 flex items-start gap-3">
      {holder.photoUrl ? (
        // Served from our origin; source and license are recorded per
        // image in lib/registry/official-photos.json (D20).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={holder.photoUrl}
          alt={`Portrait of ${holder.name}`}
          width={large ? 104 : 64}
          height={large ? 127 : 78}
          className="rounded border border-[var(--panel-border)] object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className={`flex shrink-0 items-center justify-center rounded border border-[var(--panel-border)] bg-[var(--surface)] font-mono text-lg text-muted ${
            large ? "h-[127px] w-[104px]" : "h-[78px] w-16"
          }`}
        >
          {initialsOf(holder.name)}
        </div>
      )}

      <div className="min-w-0">
        <p className="text-[0.8125rem] leading-snug">
          {holder.officeTitle}
          {/* A seat label identical to the title ("Mayor · Mayor") is
              noise, not information — caught on the item-1 gate
              screenshot. */}
          {seatLabel && seatLabel !== holder.officeTitle
            ? ` · ${seatLabel}`
            : ""}
        </p>
        {holder.partyLabel && (
          // Display only. Nothing infers anything from it. Colored per the
          // author's palette (3a) — the color states the label, never a view.
          <p
            className="mt-0.5 text-[0.75rem]"
            style={{ color: partyColorVar(holder.partyLabel) }}
          >
            {holder.partyLabel}
          </p>
        )}
        {/*
          Item 6d (2026-08-15): "In seat until", and — on the large card only
          — age. Both render ONLY from a sourced value and neither is ever
          computed from an election cycle or a news profile. A holder with no
          sourced term end renders no line at all rather than an em dash,
          because a visible blank invites a reader to conclude something.

          The age is computed from the birth date AT RENDER (see
          lib/officials/tenure.ts), so it cannot staleness-drift the way a
          stored number would.
        */}
        {(() => {
          const until = inSeatUntil(holder.termEnd);
          const age = large ? ageFrom(holder.birthDate, new Date()) : null;
          if (!until && age === null) return null;
          return (
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[0.75rem] text-label">
              {until && (
                <span>
                  In seat until{" "}
                  <span className="font-mono text-paper">{until}</span>
                </span>
              )}
              {age !== null && (
                <span>
                  Age <span className="font-mono text-paper">{age}</span>
                </span>
              )}
            </p>
          );
        })()}
        {holder.sourceUrl && (
          <a
            href={holder.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title="Where this record was read from"
            className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted hover:text-signal"
          >
            source
          </a>
        )}
      </div>
    </div>
  );
}

export function ReachThem({
  holder,
  bare = false,
}: {
  holder: SeatHolder;
  /**
   * The CardSection header already names this block (6b4). `bare` drops the
   * inner label rather than saying the same words twice, one line apart.
   */
  bare?: boolean;
}) {
  return (
    <>
      {!bare && <PopupSectionLabel>Reach them</PopupSectionLabel>}
      {holder.email && (
        <PopupRow label="Email">
          <a
            href={`mailto:${holder.email}`}
            className="hover:text-signal hover:underline"
          >
            {holder.email}
          </a>
        </PopupRow>
      )}
      {holder.phone && (
        <PopupRow label="Phone">
          <a
            href={`tel:${holder.phone.replace(/[^\d+]/g, "")}`}
            className="hover:text-signal hover:underline"
          >
            {holder.phone}
          </a>
        </PopupRow>
      )}
      {!holder.email && holder.contactFormUrl && (
        // Congress publishes contact forms, not addresses — link the form
        // and say what it is.
        <PopupRow label="Contact">
          <a
            href={holder.contactFormUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-signal hover:underline"
          >
            Official contact form
          </a>
        </PopupRow>
      )}
      {holder.websiteUrl && (
        <PopupRow label="Official page">
          <a
            href={holder.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-signal hover:underline"
          >
            {new URL(holder.websiteUrl).hostname.replace(/^www\./, "")}
          </a>
        </PopupRow>
      )}
      {holder.campaignUrl && (
        // Clearly labeled, never the primary link (3e).
        <PopupRow label="Campaign site">
          <a
            href={holder.campaignUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-signal hover:underline"
          >
            {new URL(holder.campaignUrl).hostname.replace(/^www\./, "")}
          </a>
        </PopupRow>
      )}
      {!holder.email &&
        !holder.phone &&
        !holder.contactFormUrl &&
        !holder.websiteUrl && (
          <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
            No published contact on record yet.
          </p>
        )}
    </>
  );
}

export function OfficeBlurb({
  holder,
  bare = false,
}: {
  holder: SeatHolder;
  /** The CardSection header names it (6b4); drop the duplicate label. */
  bare?: boolean;
}) {
  // Item 1 (2026-08-14 second session): the blurb resolves against the
  // holder's OWN jurisdiction, read off the roster that carries them —
  // never a per-type default that smuggles one city's charter onto
  // another city's mayor.
  const blurb = blurbForTitle(
    holder.officeTitle,
    divisionOcdIdForRosterHolder(holder.id),
  );
  if (!blurb) return null;
  return (
    <>
      {!bare && <PopupSectionLabel>What this office does</PopupSectionLabel>}
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-paper-dim">
        {blurb.text}
      </p>
      <p className="mt-1 text-[0.625rem] text-muted">
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

/**
 * The compact glance card: identity and contact, with the record one
 * obvious tap deeper. Votes, reactions and the office blurb live in the
 * large tier — glance → more → full.
 */
export function OfficialPopup({
  holder,
  seatLabel,
  tier,
  onExpand,
  onClose,
}: OfficialPopupProps) {
  return (
    <PopupCard
      type={holder.officeTitle}
      tier={tier}
      title={holder.name}
      onExpand={onExpand}
      expandLabel={`More about ${holder.name} — votes and record`}
      onClose={onClose}
    >
      <OfficialIdentity holder={holder} seatLabel={seatLabel} />
      <ReachThem holder={holder} />
    </PopupCard>
  );
}
