"use client";

import { useEffect, useState } from "react";

import { blurbForTitle } from "@/lib/officials/office-blurbs";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Tier } from "@/lib/ocd/tiers";
import type { RollCallVote, VotePosition } from "@/lib/votes/types";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { ReactionControl } from "@/components/reactions/reaction-control";

import { PopupCard, PopupRow, PopupSectionLabel } from "./popup-card";

/**
 * The rep popup (3c): the person behind a clicked name, in the same card
 * family as the meeting and district popups.
 *
 * Everything rendered here traces to a published record — the roster row
 * (linked as SOURCE), the licensed photo manifest, the curated campaign-site
 * overlay. The office blurb describes the *office*, never the holder, and
 * the campaign site is always labeled as such with the official page first.
 * A missing photo renders initials, never a broken image.
 */

interface OfficialPopupProps {
  holder: SeatHolder;
  /** The seat's label — "AZ-6", "State House District 19". */
  seatLabel: string | null;
  tier: Tier;
  /** Where the reader is looking — rides on reactions, orientation only. */
  reactionContext?: ReactionViewContext | null;
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

type MemberRollCall = RollCallVote & { position: VotePosition };

/** How many recent votes the popup shows before pointing at the record. */
const VOTE_LIMIT = 5;

function RecentVotes({
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
          {votes.slice(0, VOTE_LIMIT).map((vote) => (
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
          ))}
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

export function OfficialPopup({
  holder,
  seatLabel,
  tier,
  reactionContext = null,
  onClose,
}: OfficialPopupProps) {
  const blurb = blurbForTitle(holder.officeTitle);

  return (
    <PopupCard
      type={holder.officeTitle}
      tier={tier}
      title={holder.name}
      copyTitle={holder.name}
      onClose={onClose}
    >
      <div className="mt-2 flex items-start gap-3">
        {holder.photoUrl ? (
          // Served from our origin; source and license are recorded per
          // image in lib/registry/official-photos.json (D20).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={holder.photoUrl}
            alt={`Portrait of ${holder.name}`}
            width={64}
            height={78}
            className="rounded border border-[var(--panel-border)] object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-[78px] w-16 shrink-0 items-center justify-center rounded border border-[var(--panel-border)] bg-[var(--surface)] font-mono text-lg text-muted"
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
            // Display only. Nothing infers anything from it.
            <p className="mt-0.5 text-[0.75rem] text-muted">{holder.partyLabel}</p>
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

      <RecentVotes holder={holder} reactionContext={reactionContext} />

      {blurb && (
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
      )}
    </PopupCard>
  );
}
