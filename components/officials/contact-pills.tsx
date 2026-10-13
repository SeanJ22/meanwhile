"use client";

import { CheckedLink } from "@/components/ui/checked-link";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { useState } from "react";

import { isFederalMember, useMemberDirectory } from "@/hooks/use-member-directory";
import { useSocialPlatforms } from "@/hooks/use-social-platforms";
import type { SeatHolder } from "@/lib/officials/lookup";
import { campaignLinkKind, campaignLinkLabel } from "@/lib/officials/campaign-link-label";
import { phoneChoicesFor, telHref } from "@/lib/officials/phone-numbers";
import { accountLabel, PRIMARY_SOCIAL_PLATFORM_ID } from "@/lib/officials/social-platforms";

import { PhoneChoiceModal } from "./phone-choice-modal";
import {
  FacebookMark,
  FormMark,
  GlobeMark,
  MailMark,
  OfficialMark,
  PhoneMark,
  SocialMark,
} from "./channel-marks";

/**
 * The contact pill row. Absent channels are absent pills, never placeholders.
 * Pills wrap and never shrink below the 44px tap target. Every account says
 * whose it is, and the campaign site is always labelled as one.
 */

/** What a pill says when the account is not the office's own. */
const KIND_NOTE: Record<string, string | undefined> = { OFFICIAL: undefined, CAMPAIGN: "campaign", PERSONAL_PUBLIC: "personal" };

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
    <CheckedLink
      href={href}
      title={title ?? label}
      className="contact-pill"
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {mark}
      <span>{label}</span>
    </CheckedLink>
  );
}

/** The pill geometry as a button; only the multi-number phone pill uses it. */
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
  /**
   * `"primary"`: phone, email, contact form, official page, campaign site and
   * X. The rest of the social row is large-card only.
   */
  scope = "all",
}: {
  holder: SeatHolder;
  scope?: "all" | "primary";
}) {
  const social = holder.social ?? [];
  const platforms = useSocialPlatforms();
  const pills: React.ReactNode[] = [];
  const full = scope === "all";
  /** Which numbers the modal is showing. State, not a route: a history push remounts this island. */
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);

  /* District office numbers via the shared hook; non-federal holders resolve to an empty directory. */
  const { directory } = useMemberDirectory(holder.id,holder.state);

  /*
   * Numbers are collected first: more than one renders one "Phone" pill
   * opening a chooser; exactly one is the `tel:` link itself. District first.
   * Labels come from recorded data, never an area code.
   */
  const phoneChoices = phoneChoicesFor({
    phone: holder.phone,
    districtOffices: directory?.districtOffices,
    // A federal member's term record is the Washington office's line.
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
        // The number stays exactly as the source published it.
        label={holder.contactScope === "SHARED_OFFICE" ? `Shared office: ${phoneChoices[0].phone}` : phoneChoices[0].phone}
        mark={<PhoneMark />}
        external={false}
      />,
    );
  }

  /* `SeatHolder.email` is a single published address. */
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
        /* Labelled as what it actually is: a page on someone else's site is never "Campaign site". */
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

  // One pill per held account, in the platform list's order. A platform not in
  // the list shows no pill; an account of another kind says so on its pill.
  for (const platform of platforms) {
    if (!full && platform.id !== PRIMARY_SOCIAL_PLATFORM_ID) continue;
    for (const account of social) {
      if (account.platform !== platform.id) continue;
      const kind = KIND_NOTE[account.accountKind];
      pills.push(
        <Pill
          key={`${platform.id}:${account.url}`}
          href={account.url}
          label={kind ? `${accountLabel(platform, account)} (${kind})` : accountLabel(platform, account)}
          mark={<SocialMark iconKey={platform.iconKey} />}
        />,
      );
    }
  }

  if (pills.length === 0) {
    return <CardGapContribution id={`contact:${holder.id}`} label="contact details" subject={{ type: "CANDIDATE", id: holder.id }} />;
  }

  return (
    <>
      <div
        className="contact-pill-row"
      >
        {pills}
      </div>
      {/* The overlay carries `data-dismiss-exempt` so closing it is not an outside press on the card. */}
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
