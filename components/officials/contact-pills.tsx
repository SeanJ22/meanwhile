"use client";

import { useMemberDirectory } from "@/hooks/use-member-directory";
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
  /**
   * `"column"` stacks the pills one per line (item 4, 2026-08-16, the
   * author's ruling) — the small popup's form. A wrapped row left ragged
   * half-lines across the card; a column reads as a list of ways to reach one
   * person.
   */
  layout = "row",
  /**
   * `"primary"` is the small popup's set: phone, email, contact form,
   * official page, campaign site, and X. **The rest of the social row —
   * Facebook, YouTube, Instagram, Mastodon — is large-card only**, by the
   * author's ruling: a glance card answers "how do I reach them", and five
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
  const districtPhones = (directory?.districtOffices ?? [])
    .filter((office): office is typeof office & { phone: string } =>
      Boolean(office.phone),
    )
    // One pill per DISTINCT number: a member with four offices sharing a
    // switchboard would otherwise get four identical pills, which is the
    // "stated N equals rendered rows" rule failing in the small.
    .filter(
      (office, index, all) =>
        all.findIndex((other) => other.phone === office.phone) === index,
    )
    .map((office) => ({
      phone: office.phone,
      // The city where one is held, so two district pills are told apart by
      // the thing that actually differs. Never an invented placeholder.
      label: office.city ? `${office.city} office` : "District office",
    }));

  // Named only in contrast to a district office. The federal directory is the
  // only source that gives us both, and "Washington office" is what that
  // member's own site calls it.
  const washingtonLabel = "Washington office";

  /*
   * **BOTH NUMBERS, LABELLED, DISTRICT FIRST** — g4 item 8, the author.
   *
   * Grijalva's card holds a Washington number and a Tucson district number
   * and the row showed one of them: `holder.phone` is the member's DC line,
   * and every district office's number lives in the directory payload, which
   * only the offices section ever asked for. A reader who wants to reach
   * their representative about something local was being handed the number
   * that is furthest from the answer.
   *
   * District first, because it is the one that answers. The label says which
   * is which and names the district office's CITY where one is held, so two
   * pills reading "Phone" never sit side by side. Multiple district offices
   * each carry their own city; the full list with addresses stays in
   * Offices-near-you rather than being duplicated here.
   *
   * The order is otherwise the reader's likely need rather than the source's
   * field order: the phone rings a human, the form reaches the office, the
   * pages explain it, the accounts are where the office talks.
   */
  for (const [index, office] of districtPhones.entries()) {
    pills.push(
      <Pill
        key={`district-phone-${index}`}
        href={`tel:${office.phone.replace(/[^\d+]/g, "")}`}
        // Taps to dial on a phone. The visible number stays exactly as the
        // source published it, formatting and all — a reformatted number is a
        // number we typed rather than one they published.
        label={`${office.label}: ${office.phone}`}
        mark={<PhoneMark />}
        external={false}
      />,
    );
  }

  if (holder.phone) {
    pills.push(
      <Pill
        key="phone"
        href={`tel:${holder.phone.replace(/[^\d+]/g, "")}`}
        // Labelled only when there is something to distinguish it FROM. A
        // school-board member with one number gets a number, not a lesson in
        // which building it rings in — the label is there to answer "which of
        // these two", and with one pill there is no question to answer.
        label={
          districtPhones.length > 0
            ? `${washingtonLabel}: ${holder.phone}`
            : holder.phone
        }
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
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
        No published contact on record yet.
      </p>
    );
  }

  return (
    <div
      className="contact-pill-row"
      data-compact={compact || undefined}
      data-layout={layout === "column" ? "column" : undefined}
    >
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
