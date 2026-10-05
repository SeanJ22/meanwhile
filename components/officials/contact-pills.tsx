"use client";

import { useState } from "react";

import { isFederalMember, useMemberDirectory } from "@/hooks/use-member-directory";
import type { SeatHolder } from "@/lib/officials/lookup";
import { campaignLinkKind, campaignLinkLabel } from "@/lib/officials/campaign-link-label";
import { phoneChoicesFor, telHref } from "@/lib/officials/phone-numbers";

import { PhoneChoiceModal } from "./phone-choice-modal";
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
 * **The contact pill row** — items 2 and 8, 2026-08-16.
 *
 * ## What it replaces, and why
 *
 * The `REACH THEM` label/value ledger. That ledger was a `.popup-row` flex
 * with a `white-space: nowrap` key column, and inside a 300px popup a long
 * key ate the whole row: the value collapsed to a few pixels and
 * `word-break: break-word` broke it one character per line. **That is the
 * production defect reported — Pima's supervisors reading vertically.** A row that puts a label and a value in competition for a
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

/**
 * The same pill geometry, pressing instead of navigating.
 *
 * Only the multi-number phone pill uses it: everything else on this row IS a
 * destination, and a button that looks like a link but goes nowhere is the
 * friction the pill row was built to remove.
 */
function PillButton({
  label,
  mark,
  title,
  onPress,
}: {
  label: string;
  mark: React.ReactNode;
  title?: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      className="contact-pill"
      onClick={onPress}
    >
      {mark}
      <span>{label}</span>
    </button>
  );
}

export function ContactPills({
  holder,
  /** The small popup scales the row down; the large card runs it full size. */
  compact = false,
  /**
   * `"column"` stacks the pills one per line (item 4, 2026-08-16) — the
   * small popup's form. A wrapped row left ragged
   * half-lines across the card; a column reads as a list of ways to reach one
   * person.
   */
  layout = "row",
  /**
   * `"primary"` is the small popup's set: phone, email, contact form,
   * official page, campaign site, and X. **The rest of the social row —
   * Facebook, YouTube, Instagram, Mastodon — is large-card only**, because
   * a glance card answers "how do I reach them", and five
   * more accounts is the scatter it was sent back for. Nothing is padded
   * either way; an absent channel is still an absent pill.
   */
  scope = "all",
}: {
  holder: SeatHolder;
  compact?: boolean;
  layout?: "row" | "column";
  scope?: "all" | "primary";
}) {
  const social = holder.social ?? {};
  const pills: React.ReactNode[] = [];
  const full = scope === "all";
  /**
   * R39: which numbers the modal is showing, or null for closed. State rather
   * than a route — M52, and the same reason `EntityModal` pushes no history
   * entry: the Next router remounts this island and the modal would die the
   * tick it opened.
   */
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);

  /*
   * The district offices' own numbers (item 8).
   *
   * Fetched through the shared hook, so this and the offices section make one
   * request between them. A non-federal holder resolves to an empty
   * directory and this whole branch simply does not fire — bodies and
   * non-federal officials follow the same rule with whatever numbers are
   * held, which for them is the one on the holder.
   */
  const { directory } = useMemberDirectory(holder.id);

  /*
   * **ONE PHONE PILL** — R39, 2026-08-17, from production feedback.
   *
   * ## What was here, and what it did
   *
   * g4 item 8 put BOTH numbers on the row, labelled, district first — right
   * about the data (a reader wanting something local was being handed the DC
   * line) and wrong about the shape. One pill per number means a member with
   * seven offices gets seven pills, and Shaheen's card is what that looks
   * like: a wall of numbers where a contact row should be. The registry holds
   * 531 officeholders with more than one recorded number, so this was never
   * one card's problem.
   *
   * ## What is here now
   *
   * The numbers are COLLECTED first and rendered second, and the count
   * decides the shape:
   *
   * - **More than one** → one pill reading `Phone`, opening a modal that
   *   lists them with their office labels. The choice is still the reader's;
   *   it just stopped costing them the whole card to make it.
   * - **Exactly one** → the pill IS the `tel:` link and carries the number
   *   itself. No modal: a dialog with one row is friction with nothing to
   *   choose, and the number on the face is strictly more useful than the
   *   word "Phone".
   *
   * District first, because it is the one that answers. Labels come from the
   * recorded data — the district office's own published CITY, and Washington
   * for the number the member's term record holds — never from an area code.
   * The full list with addresses stays in Offices-near-you rather than being
   * duplicated here.
   *
   * The order is otherwise the reader's likely need rather than the source's
   * field order: the phone rings a human, the form reaches the office, the
   * pages explain it, the accounts are where the office talks.
   */
  const phoneChoices = phoneChoicesFor({
    phone: holder.phone,
    districtOffices: directory?.districtOffices,
    // Named only in contrast to a district office, and only where the record
    // supports it: a federal member's term record IS the Washington office's
    // line. Every other tier publishes one number and no office structure.
    ownLabel: isFederalMember(holder.id) ? "Washington office" : holder.contactScope === "SHARED_OFFICE" ? "Shared office" : "Office",
  });

  if (phoneChoices.length > 1) {
    pills.push(
      <PillButton
        key="phone"
        label="Phone"
        title={`${phoneChoices.length} published numbers`}
        mark={<PhoneMark />}
        onPress={() => setPhoneModalOpen(true)}
      />,
    );
  } else if (phoneChoices.length === 1) {
    pills.push(
      <Pill
        key="phone"
        href={telHref(phoneChoices[0].phone)}
        // Taps to dial on a phone. The visible number stays exactly as the
        // source published it, formatting and all — a reformatted number is a
        // number we typed rather than one they published.
        //
        // No office label: the label is there to answer "which of these", and
        // with one number there is no question to answer.
        label={holder.contactScope === "SHARED_OFFICE" ? `Shared office: ${phoneChoices[0].phone}` : phoneChoices[0].phone}
        mark={<PhoneMark />}
        external={false}
      />,
    );
  }

  /*
   * R39 asked for the same treatment if any official carries multiple EMAILS.
   * None does, and none can: `SeatHolder.email` is one nullable string, every
   * roster fills it from one published address, and a census of all 1,157
   * officeholder records on 2026-08-17 found ZERO whose email field holds a
   * list. So there is nothing here to collapse, and nothing changed — stated
   * rather than silently skipped, because "we looked and there were none" and
   * "we did not look" are different claims.
   */
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
        /*
         * Labelled as what it actually is, always. The Facebook-as-campaign-site
         * rule and RULING 122's party-hosted page both name their own label,
         * because a page on somebody ELSE'S site presented as "Campaign site"
         * is a false claim about whose site it is.
         */
        label={campaignLinkLabel(holder.campaignUrl)}
        title={hostOf(holder.campaignUrl)}
        mark={
          campaignLinkKind(holder.campaignUrl) === "FACEBOOK" ? (
            <FacebookMark />
          ) : (
            <GlobeMark />
          )
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

  if (full && social.facebook) {
    pills.push(
      <Pill
        key="facebook"
        href={`https://facebook.com/${social.facebook}`}
        label="Facebook"
        mark={<FacebookMark />}
      />,
    );
  }

  if (full && (social.youtube || social.youtubeId)) {
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

  if (full && social.instagram) {
    pills.push(
      <Pill
        key="instagram"
        href={`https://instagram.com/${social.instagram}`}
        label="Instagram"
        mark={<InstagramMark />}
      />,
    );
  }

  if (full && social.mastodon) {
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
      <p className="mt-1.5 t-detail leading-relaxed text-muted">
        No published contact on record yet.
      </p>
    );
  }

  return (
    <>
      <div
        className="contact-pill-row"
        data-compact={compact || undefined}
        data-layout={layout === "column" ? "column" : undefined}
      >
        {pills}
      </div>
      {/* Over the card, not instead of it. Closing returns the card exactly as
          it was — the overlay carries `data-dismiss-exempt` so the press that
          closes this never reads as an outside press on the battlecard. */}
      {phoneModalOpen && (
        <PhoneChoiceModal
          name={holder.name}
          choices={phoneChoices}
          onClose={() => setPhoneModalOpen(false)}
        />
      )}
    </>
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
