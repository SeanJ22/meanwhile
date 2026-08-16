"use client";

import type { SeatHolder } from "@/lib/officials/lookup";

import {
  FacebookMark,
  FormMark,
  GlobeMark,
  InstagramMark,
  MailMark,
  MastodonMark,
  OfficialMark,
  PhoneMark,
  XMark,
  YouTubeMark,
} from "./channel-marks";

/**
 * **The contact pill row** — items 2 and 8, 2026-08-16, the author's ruling.
 *
 * ## What it replaces, and why
 *
 * The `REACH THEM` label/value ledger. That ledger was a `.popup-row` flex
 * with a `white-space: nowrap` key column, and inside a 300px popup a long
 * key ate the whole row: the value collapsed to a few pixels and
 * `word-break: break-word` broke it one character per line. **That is the
 * production defect the author reported — Pima's supervisors reading
 * vertically.** A row that puts a label and a value in competition for a
 * fixed width will always eventually lose, and a pill carries its own label
 * so there is nothing to compete with.
 *
 * ## The rules, all four load-bearing
 *
 * - **Absent channels are absent pills.** Never a placeholder, never a greyed
 *   "no website", never padding to make a row look full. A thin card must
 *   read as a thin card, not as a broken one — and equal effort means the
 *   HUNT is equal, not that the ROW is padded to equal length.
 * - **They wrap, they never shrink.** Below a tap target a pill is a defect,
 *   so the row wraps at 390px rather than squeezing. `.contact-pill` has no
 *   flex-shrink and a 44px minimum.
 * - **Official accounts only.** The social pills come from the
 *   congress-legislators directory, whose own policy is offices' accounts
 *   rather than campaign accounts — which is the entire reason a social pill
 *   belongs on an officeholder's card. Nothing is backfilled from a campaign
 *   account.
 * - **The campaign site is labeled as one.** Always; it is never the primary
 *   link, and a social page serving as a campaign site says which platform it
 *   is (the Facebook-as-campaign-site rule) rather than being dressed as a
 *   website.
 */

interface PillProps {
  href: string;
  label: string;
  mark: React.ReactNode;
  /** External links open in a tab; `tel:` and `mailto:` must not. */
  external?: boolean;
  title?: string;
}

function Pill({ href, label, mark, external = true, title }: PillProps) {
  return (
    <a
      href={href}
      title={title ?? label}
      className="contact-pill"
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {mark}
      <span>{label}</span>
    </a>
  );
}

export function ContactPills({
  holder,
  /** The small popup scales the row down; the large card runs it full size. */
  compact = false,
}: {
  holder: SeatHolder;
  compact?: boolean;
}) {
  const social = holder.social ?? {};
  const pills: React.ReactNode[] = [];

  // Order is the reader's likely need, not the source's field order: the
  // phone rings a human, the form reaches the office, the pages explain it,
  // the accounts are where the office talks.
  if (holder.phone) {
    pills.push(
      <Pill
        key="phone"
        // Taps to dial on a phone. The visible label stays the number the
        // source published, formatting and all — a reformatted number is a
        // number we typed rather than one they published.
        href={`tel:${holder.phone.replace(/[^\d+]/g, "")}`}
        label={holder.phone}
        mark={<PhoneMark />}
        external={false}
      />,
    );
  }

  if (holder.email) {
    pills.push(
      <Pill
        key="email"
        href={`mailto:${holder.email}`}
        label="Email"
        title={holder.email}
        mark={<MailMark />}
        external={false}
      />,
    );
  }

  if (holder.contactFormUrl) {
    pills.push(
      <Pill
        key="form"
        href={holder.contactFormUrl}
        label="Contact form"
        mark={<FormMark />}
      />,
    );
  }

  if (holder.websiteUrl) {
    pills.push(
      <Pill
        key="official"
        href={holder.websiteUrl}
        label="Official page"
        title={hostOf(holder.websiteUrl)}
        mark={<OfficialMark />}
      />,
    );
  }

  if (holder.campaignUrl) {
    pills.push(
      <Pill
        key="campaign"
        href={holder.campaignUrl}
        // Labeled as the campaign's, always. The Facebook-as-campaign-site
        // rule names its own label when the campaign's presence IS a page.
        label={
          /facebook\.com/i.test(holder.campaignUrl)
            ? "The campaign's Facebook page"
            : "Campaign site"
        }
        title={hostOf(holder.campaignUrl)}
        mark={
          /facebook\.com/i.test(holder.campaignUrl) ? <FacebookMark /> : <GlobeMark />
        }
      />,
    );
  }

  if (social.twitter) {
    pills.push(
      <Pill
        key="x"
        // The stored field is the source's `twitter`; it renders as X.
        href={`https://x.com/${social.twitter}`}
        label={`@${social.twitter}`}
        mark={<XMark />}
      />,
    );
  }

  if (social.facebook) {
    pills.push(
      <Pill
        key="facebook"
        href={`https://facebook.com/${social.facebook}`}
        label="Facebook"
        mark={<FacebookMark />}
      />,
    );
  }

  if (social.youtube || social.youtubeId) {
    pills.push(
      <Pill
        key="youtube"
        href={
          social.youtubeId
            ? `https://youtube.com/channel/${social.youtubeId}`
            : `https://youtube.com/${social.youtube}`
        }
        label="YouTube"
        mark={<YouTubeMark />}
      />,
    );
  }

  if (social.instagram) {
    pills.push(
      <Pill
        key="instagram"
        href={`https://instagram.com/${social.instagram}`}
        label="Instagram"
        mark={<InstagramMark />}
      />,
    );
  }

  if (social.mastodon) {
    pills.push(
      <Pill
        key="mastodon"
        // The directory stores a full handle including the instance.
        href={mastodonUrl(social.mastodon)}
        label="Mastodon"
        mark={<MastodonMark />}
      />,
    );
  }

  if (pills.length === 0) {
    return (
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
        No published contact on record yet.
      </p>
    );
  }

  return (
    <div className="contact-pill-row" data-compact={compact || undefined}>
      {pills}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** `@name@instance.tld` → the instance's own profile URL. */
function mastodonUrl(handle: string): string {
  const parts = handle.replace(/^@/, "").split("@");
  if (parts.length === 2) return `https://${parts[1]}/@${parts[0]}`;
  return handle.startsWith("http") ? handle : `https://mastodon.social/@${parts[0]}`;
}
