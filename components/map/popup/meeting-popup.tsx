"use client";

import { MeetingCard } from "@/components/ui/meeting-card";
import { CheckedLink } from "@/components/ui/checked-link";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import type { PublicBodyAttempt } from "@/lib/registry/body-attempt-read";
import { ExternalLink } from "lucide-react";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";



import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoveredBody } from "@/lib/registry/coverage";
import { linksForMeeting, type OutboundLink } from "@/lib/registry/links";


import { minutesSummaryForMeeting } from "@/lib/meetings/minutes-summaries";
import { JurisdictionPill } from "@/components/address/jurisdiction-pill";
import { useMeetingBadge } from "@/hooks/use-meeting-badge";

import { useShellData, useMeetingListingIdentity } from "@/lib/state/data";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "../meeting-listing-notice";
import type { Meeting } from "@/lib/sources/types";



import { PopupRow, PopupSectionLabel, type PopupBadge } from "./popup-card";

/**
 * One sitting of one body.
 *
 * Times render through `lib/map/format.ts`, which formats in the **meeting's**
 * zone rather than the reader's — someone checking a Tucson agenda from
 * Philadelphia needs the time they will be expected in the room. The instant
 * itself was built by `lib/time/zoned.ts` at ingest, which is DST-tested.
 * Neither is reimplemented here.
 */


interface MeetingPopupProps {
  meeting: Meeting;
  /**
   * People sourced as sitting on **this body**.
   *
   * Empty today for every body: officeholders exist for legislative divisions
   * (Congress, state chambers) and a county board or school board is neither.
   * That is tier 3, the curated local seed, and it has not been built.
   *
   * **The federal and state people we do hold must not be shown here.** A US
   * Representative does not sit on the Pima County Board, and putting them
   * under this heading because they share an OCD-ID would be exactly the
   * unsourced attribution CLAUDE.md line 17 forbids.
   */
  representation?: SeatHolder[];
  /**
   * The registry body governing this meeting's division, when one is known.
   *
   * Supplies the two ladder rungs the meeting record cannot: where all of this
   * body's agendas live, and the body's own page. Optional because a meeting
   * whose division has no registry row still deserves its agenda and venue
   * rungs.
   */
  body?: CoveredBody | null;
  onExpand?: () => void;
  onClose?: () => void;
}

export function MeetingPopup({ meeting, representation = [], body = null, onExpand, onClose }: MeetingPopupProps) {
  const { location } = useShellData();
  const { badgeOf, bodyClassOf } = useMeetingBadge();
  const listingCount = readerMeetingCount([meeting], useMeetingListingIdentity());
  const concluded = meeting.status === "CONCLUDED";
  const minutes = concluded ? minutesSummaryForMeeting(meeting.id) : null;
  const officePhone = concluded ? body?.readerRoster?.officePhone ?? null : null;
  const sources = minutes ? [{ what: "Meeting minutes; plain-language paraphrase is ours", provenance: { sourceUrl: minutes.minutesUrl, sourceOrg: minutes.sourceOrg, collectedAt: minutes.readAt, verifiedAt: null } }] : [];
  if (officePhone) sources.push({ what: "The body's office phone", provenance: { sourceUrl: officePhone.sourceUrl, sourceOrg: officePhone.sourceOrg, collectedAt: "", verifiedAt: null } });
  return <MeetingCard meeting={meeting} representation={representation} sources={sources} onClose={onClose} onExpand={onExpand}
    jurisdiction={<JurisdictionPill badge={badgeOf(meeting)} bodyClass={bodyClassOf(meeting)} zip={location?.zip ?? null} />}>
    <MeetingListingNotice groups={listingCount.groups} />
    {concluded && <><PopupSectionLabel>What happened</PopupSectionLabel>{minutes ? <p className="mt-2 t-body font-semibold">{minutes.summary}</p> : <WorkingOnIt />}</>}
    {officePhone && <PopupRow label="Office"><CheckedLink href={`tel:${officePhone.phone.replace(/[^\d+]/g, "")}`}>{officePhone.phone}</CheckedLink></PopupRow>}
    <LinkLadder links={linksForMeeting(meeting, body).filter(link => !(concluded && link.rung === "VENUE_MAP"))} lookedAt={body?.lookedAt ?? false} publicationAttempt={body?.publicationAttempts?.meetings?.latest ?? null} />
    <PopupSectionLabel>Representation</PopupSectionLabel>
    {representation.length ? representation.map(holder => <PopupRow key={holder.id} label={readerOfficeTitle(holder.officeTitle)}>{holder.name}</PopupRow>) : <WorkingOnIt subject={body ? { type: "BODY", id: body.bodyId } : null} />}
  </MeetingCard>;
}


/**
 * Every route out of this card, best first.
 *
 * **An empty ladder renders as empty.** That is the whole discipline: there is
 * no rung that constructs a plausible destination when the real ones are
 * missing, because a link that looks right and goes nowhere is invisible until
 * somebody clicks it — the same failure that nulled 34 fixture URLs in 4.5.3.
 *
 * A historical cited audit and a recent exact-body publication attempt are
 * both narrower than an exhaustive agenda search. Neither can establish that
 * no agenda exists, and an absent receipt cannot prove nobody looked.
 */
function LinkLadder({
  links,
}: {
  links: OutboundLink[];
  lookedAt: boolean;
  publicationAttempt?: PublicBodyAttempt | null;
}) {
  if (links.length === 0) return <WorkingOnIt />;

  return (
    <ul className="mt-1.5 space-y-1">
      {links.map((link) => (
        <li key={link.rung} className="flex items-baseline justify-between gap-3">
          <CheckedLink
            href={link.url}
            target="_blank"
            rel="noreferrer"
            title={link.hint}
            className="inline-flex min-w-0 items-baseline gap-1 truncate t-body text-signal hover:underline"
          >
            <span className="truncate">{link.label}</span>
            <ExternalLink className="size-3 shrink-0 translate-y-0.5" />
          </CheckedLink>
          {link.kind === "DERIVED" && (
            // A derived link is a convenience built from coordinates we hold,
            // not evidence about the meeting. It is marked so it can never be
            // read as a citation sitting in a list of sourced links.
            <span
              title="Built from coordinates we hold — not a source"
              className="trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] text-muted"
            >
              derived
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
