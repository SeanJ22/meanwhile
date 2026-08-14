"use client";

import { blurbForTitle } from "@/lib/officials/office-blurbs";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Tier } from "@/lib/ocd/tiers";

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
  onClose?: () => void;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function OfficialPopup({
  holder,
  seatLabel,
  tier,
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
