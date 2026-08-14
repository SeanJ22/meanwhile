"use client";

import { useEffect, useState } from "react";

import { blurbForTitle } from "@/lib/officials/office-blurbs";
import { divisionOcdIdForRosterHolder } from "@/lib/registry/body-rosters";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import type { Tier } from "@/lib/ocd/tiers";
import type { RollCallVote, VotePosition } from "@/lib/votes/types";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { ReactionControl } from "@/components/reactions/reaction-control";
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

/** How many recent votes the surface shows before pointing at the record. */
const VOTE_LIMIT = 5;

export function RecentVotes(props: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
}) {
  // Keyed on the holder so a holder change discards the fetched record
  // structurally — a new holder never wears the previous one's votes
  // (D40 hygiene, same shape as the funding block).
  return <RecentVotesInner key={props.holder.id} {...props} />;
}

function RecentVotesInner({
  holder,
  reactionContext,
}: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
}) {
  const [votes, setVotes] = useState<MemberRollCall[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!holder.id.startsWith("congress:")) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/votes?member=${holder.id}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as { votes: MemberRollCall[] };
        setVotes(payload.votes);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [holder.id]);

  // State legislators' roll calls are a coming store, not an absence to
  // fake — the section only renders for federal members.
  if (!holder.id.startsWith("congress:")) return null;

  return (
    <>
      <PopupSectionLabel>Recent votes</PopupSectionLabel>
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
                {/* The sensor (P03): asked after the record, never before it. */}
                <ReactionControl
                  targetType="FEDERAL_VOTE"
                  targetId={vote.id}
                  prompt="Do you like this vote?"
                  context={reactionContext}
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
          {seatLabel ? ` · ${seatLabel}` : ""}
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

export function ReachThem({ holder }: { holder: SeatHolder }) {
  return (
    <>
      <PopupSectionLabel>Reach them</PopupSectionLabel>
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

export function OfficeBlurb({ holder }: { holder: SeatHolder }) {
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
      <PopupSectionLabel>What this office does</PopupSectionLabel>
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
