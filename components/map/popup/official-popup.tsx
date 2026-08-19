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
import { ContactPills } from "@/components/officials/contact-pills";
import { PersonIdentity } from "@/components/officials/person-identity";
import {
  KeyVotesSection,
  type KeyVoteRow,
} from "@/components/officials/key-votes-section";
import { votedCount } from "@/lib/votes/participation";
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
 * The four recorded states, as FILLED PILLS (item 5, 2026-08-16).
 *
 * They were bare bold text in a colour. A pill in the chip grammar is what
 * this system already uses for a stated fact, and the colours still state the
 * member's VOTE — what they cast, never whether it was good. The legend below
 * the list says exactly that.
 *
 * The no-red is a DIFFERENT SHADE from the party red on purpose, and the fill
 * strategy is inverted from a party chip's as well — see `--vote-no` in
 * globals.css. A no-vote must never read as a party mark at a glance.
 */
const POSITION_STYLE: Record<VotePosition, { label: string; tone: string }> = {
  YES: { label: "Voted yes", tone: "yes" },
  NO: { label: "Voted no", tone: "no" },
  PRESENT: { label: "Voted present", tone: "neutral" },
  NOT_VOTING: { label: "Did not vote", tone: "neutral" },
};

/**
 * A recorded position, in the pill grammar.
 *
 * `tone="gap"` is the NAMED GAP form — an outline, never a position's
 * colour. Absence is not an opinion and must not wear one (item 12).
 */
export function VotePill({
  tone,
  children,
}: {
  tone: "yes" | "no" | "neutral" | "gap";
  children: React.ReactNode;
}) {
  return <span className={`vote-pill vote-pill--${tone}`}>{children}</span>;
}

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
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem]">
                  {/* Item 5: the position as a filled pill, in both views. */}
                  <VotePill tone={POSITION_STYLE[vote.position].tone as "yes" | "no" | "neutral"}>
                    {POSITION_STYLE[vote.position].label}
                  </VotePill>
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
            Colors state their vote — green for yes, red for no, gray for
            present or not voting — never our opinion of it. Titles are the
            official record&apos;s words.
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
   * Item 4 (2026-08-16) — the author's pass, replacing 6b's two columns.
   *
   * What was wrong: "Recent" and "When it mattered" floated as two headers
   * with no parent, so the first question a reader asks is "recent WHAT?" —
   * and side by side they each wasted half the card on empty column space.
   *
   * The architecture now:
   *
   *   - ONE "Voting Record" section header, at the SAME full width as
   *     "Campaign money" and the others above it. It is one of the
   *     collapsible sections in the 6b4 grammar, not a special case.
   *   - Inside it, Recent and When it mattered are SELECTORS. The selected
   *     view consumes the full width of the box, and selecting one collapses
   *     the other — accordion behaviour INSIDE Voting Record only. The
   *     sections above are untouched by it.
   *
   * INFORMATION ARCHITECTURE IS OTHERWISE UNCHANGED. Both views keep their
   * complete answers, newest first, overlap unmarked, the House nominations
   * line as shipped. **Overlap is expected and unmarked**: a recent vote that
   * is also a when-it-mattered vote appears in both, because each view has to
   * be a complete answer to its own question, and cross-marking them would
   * make one look like a subset of the other.
   */
  return (
    <CardSection title="Voting Record">
      <VotingRecordViews
        recent={recent}
        recentMeta={votes ? `last ${Math.min(votes.length, VOTE_LIMIT)}` : null}
        keyVotes={
          chamber && keyVotes.length > 0 ? (
            <KeyVotesSection chamber={chamber} rows={keyVotes} />
          ) : null
        }
        /* F01 5.1 (2026-08-19): this used to be `keyVotes.length` — every
           entry in the curated list, including the sixteen nomination
           questions a House member cannot vote on. The headline now counts
           the votes the member ACTUALLY PARTICIPATED IN, which is what a
           reader opening it expects to find underneath. The full denominator
           has not vanished: it is stated inside, per group. */
        keyVotesMeta={
          keyVotes.length > 0 ? String(votedCount(keyVotes)) : null
        }
      />
    </CardSection>
  );
}

/**
 * The two views inside Voting Record, and the accordion between them.
 *
 * One selected at a time, and one ALWAYS selected — a state where neither is
 * open would make the reader tap twice to see a record they already asked
 * for by opening the section. "Recent" leads because it answers the question
 * a reader arrives with; "When it mattered" is the curated list and says so
 * in its own criteria sentence.
 *
 * The selector is `aria-pressed` rather than a tablist: these are two views
 * of one record inside an already-labelled region, and a nested tablist
 * inside a collapsible section reads to a screen reader as a second
 * navigation the card does not have.
 */
function VotingRecordViews({
  recent,
  recentMeta,
  keyVotes,
  keyVotesMeta,
}: {
  recent: React.ReactNode;
  recentMeta: string | null;
  keyVotes: React.ReactNode;
  keyVotesMeta: string | null;
}) {
  const [view, setView] = useState<"recent" | "key">("recent");

  return (
    <div>
      <div className="vote-view-switch">
        <button
          type="button"
          className="vote-view-btn"
          data-selected={view === "recent" || undefined}
          aria-pressed={view === "recent"}
          onClick={() => setView("recent")}
        >
          Recent
          {recentMeta && <span className="vote-view-meta">{recentMeta}</span>}
        </button>
        {keyVotes && (
          <button
            type="button"
            className="vote-view-btn"
            data-selected={view === "key" || undefined}
            aria-pressed={view === "key"}
            onClick={() => setView("key")}
          >
            When it mattered
            {keyVotesMeta && <span className="vote-view-meta">{keyVotesMeta}</span>}
          </button>
        )}
      </div>

      {view === "recent" ? (
        <div className="vote-view-body">
          <p className="mb-1.5 text-[0.6875rem] leading-relaxed text-voice">
            Every roll call they cast, newest first — including the procedural
            ones. Voting to set a bill aside is a way of deciding it.
          </p>
          {recent}
        </div>
      ) : (
        <div className="vote-view-body">{keyVotes}</div>
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
            className="source-tag font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted hover:text-signal"
          >
            source
          </a>
        )}
      </div>
    </div>
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
 * The compact glance card — ITEM 4, 2026-08-16, the author's ruling.
 *
 * The author on the previous form: "ugly and scattered, too much info." It
 * carried the name, a party pill, a row of outlined chips (state, chamber,
 * incumbent), the office title, an in-seat date, and a wrapped grid of up to
 * ten contact pills, all inside 300px.
 *
 * It is three things now and nothing else:
 *
 *  1. the name, with the photo-or-initials circle;
 *  2. the party as the FILLED PILL — the pill belongs on battlecards, small
 *     and large; it is banned only from the who-governs list;
 *  3. the contact pills in ONE VERTICAL COLUMN — phone, email, contact form,
 *     official page, campaign site, X where held. The rest of the social row
 *     is large-card only.
 *
 * "More" sits at the bottom, full width, aligned with the column, and opens
 * the large battlecard — which carries the office, the in-seat line, the
 * chips, the full social row, the record and everything else. **Nothing is
 * deleted; it moved one tap down.**
 *
 * The eyebrow above the card keeps the office title: it is the card's
 * structural label — what KIND of card this is, in the tier's colour — and
 * every popup in this system has one. The role line inside the body, which
 * said the same words a second time four pixels lower, is what went.
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
      /* Item 2 (2026-08-16): the card's own title is the identity block's
         name now. Rendering it twice, once as the popup heading and once as
         the header's dominant type, was two of the same fact. */
      titleInBody
    >
      <PersonIdentity holder={holder} seatLabel={seatLabel} identityOnly />
      {/* Item 2, the author's ruling: the pill row REPLACES the REACH THEM
          label/value ledger — the ledger is what broke, and a pill carries
          its own label so nothing competes for the popup's fixed width.
          Item 4: one column, primary channels only. */}
      <ContactPills holder={holder} compact layout="column" scope="primary" />
    </PopupCard>
  );
}
