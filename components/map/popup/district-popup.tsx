"use client";

import { TIER_LABEL } from "@/lib/ocd/tiers";
import type { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "../meeting-listing-notice";
import { useResolvedLocation } from "@/hooks/use-resolved-location";
import { browsingSubject } from "@/lib/state/resolved-location";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import type { SeatHolder } from "@/lib/officials/lookup";
import { TOP_OFFICES_GAP, runsSomething, topOfficesFor,
  rosterInReadingOrder,
} from "@/lib/officials/top-offices";
import { displayPersonName } from "@/lib/officials/person-name";
import type { DistrictHit } from "@/lib/map/districts";
import { representationNoteFor } from "@/lib/registry/representation";
import type { RosterReaderGap } from "@/lib/registry/body-rosters";
import { RosterCompletenessGaps } from "@/components/officials/roster-completeness-gap";

import {
  NoValue,
  PopupCard,
  PopupRow,
  PopupSectionLabel,
} from "./popup-card";

/**
 * The district behind a click.
 *
 * Unlike the meeting popup, this one has real people to show: officeholders
 * attach to *divisions*, and a congressional or legislative district is exactly
 * a division. A county or school district shows the honest absence instead,
 * because that is tier 3 and it has not been built.
 */

/**
 * **WGH-15 (2026-08-28) — THIS CARD SAYS WHAT IT IS ABOUT, AND IT IS NOT THE
 * READER.**
 *
 * The reported screen: *"Set to ... State House District 17"* on the
 * who-governs card, and *State House District 19* on this one, at the same
 * moment. **Both were correct.** The two stores have always been disjoint —
 * tapping a district dispatches `select/district` and `district/pick` and
 * nothing else, and the who-governs card reads only the zip and the session
 * address. Selecting a district has never written where the reader lives and
 * still does not.
 *
 * So there was nothing to untangle. What there was, was **two panels showing
 * two district numbers with nothing on either saying which question it was
 * answering**, which a reader reads as one product contradicting itself.
 *
 * A reader may live in House 17 and inspect House 21 for an hour. That is the
 * map working. This line is what makes it legible: the card names its subject,
 * and — where the reader's own address can settle it — says how their home
 * stands relative to it.
 *
 * **Four sentences, because there are four states and no two of them are the
 * same fact:**
 *
 * - `CONFIRMED`             their address is inside this district. Say so.
 * - `ELSEWHERE_IN_ZIP`      their address settled this level and named another
 *                           district. This is a fact about THEIR STREET, not a
 *                           gap in what we hold — we hold this district in
 *                           full.
 * - `OVERLAP_NOT_RULED_OUT` their address named a different one at a level
 *                           where a point can be in several at once. See
 *                           below — this branch is WGH-16 and it exists
 *                           because the branch above it was being said about
 *                           districts it was never true of.
 * - `UNSETTLED`             we have not been told enough. Says so about US,
 *                           and never "this is not your district", which would
 *                           be an absence asserted as a fact.
 *
 * ## WGH-16 (2026-08-28) — THE STRONG SENTENCE WAS BEING SAID TOO OFTEN
 *
 * *"This is here because you tapped it, not because it governs you"* is a claim
 * about a GOVERNMENT, and it is true only where a point can be in one division
 * at that level. This card renders congressional, state house, state senate,
 * county, municipal and school-district subjects, and the last two are measured
 * to overlap: a reader is routinely inside an elementary district and a regional
 * high school district at once, and inside an incorporated place and a county
 * subdivision at once.
 *
 * So the strong sentence is now gated on measured exclusivity
 * (`lib/state/division-levels.ts`), and the overlapping case gets the sentence
 * the evidence actually supports — one that says which district IS theirs
 * WITHOUT claiming this one is not.
 *
 * It reads from a `BROWSING` location, which settles nothing by construction,
 * so this card cannot retire a hedge and cannot write back to the home store.
 */
export function BrowsingSubjectLine({
  label,
  homeZip,
  ocdId,
}: {
  /** The district on screen, in the reader's words. Never an OCD-ID. */
  label: string;
  /** The zip the reader told us about, if any. Their home question. */
  homeZip: string | null;
  /** The subject division, for the standing comparison. */
  ocdId: string | null;
}) {
  const home = useResolvedLocation(homeZip);
  const subject = browsingSubject(home, ocdId);

  return (
    <p
      data-browsing-standing={subject.standing}
      className="mt-1 t-caption leading-relaxed text-muted"
    >
      {subject.standing === "CONFIRMED" ? (
        <>You&apos;re looking at {label} — the one your address is in.</>
      ) : subject.standing === "ELSEWHERE_IN_ZIP" ? (
        <>
          You&apos;re looking at {label}. Your address is in a different one —
          this is here because you tapped it, not because it governs you.
        </>
      ) : subject.standing === "OVERLAP_NOT_RULED_OUT" ? (
        /*
         * WGH-16. Everything here is measured, and the sentence stops exactly
         * where the measurement does.
         *
         * WE KNOW their address named a different district of this kind, and
         * we know districts of this kind can cover the same ground — that is
         * the whole content of `POTENTIALLY_OVERLAPPING`. WE DO NOT KNOW
         * whether this one covers them, because nothing tested this district's
         * boundary against their point.
         *
         * So the line says both known things and stops. It never says "this
         * one is not yours" (the claim above, which is false here) and it never
         * says "this one is also yours" (which nothing established either).
         */
        <>
          You&apos;re looking at {label}. Your address is in a different one of
          these — and areas like this can overlap, so this one may cover you as
          well.
        </>
      ) : (
        // NEVER "this is not your district". Nothing has settled that, and
        // asserting it would be an absence stated as a fact about the reader.
        // What IS true is what this card is about, which is all it claims.
        <>You&apos;re looking at {label}. This card is about that district.</>
      )}
    </p>
  );
}

interface DistrictPopupProps {
  district: DistrictHit;
  /** People sourced as representing this division. Empty is a real answer. */
  representation?: SeatHolder[];
  /** Completeness evidence projected beside the representation response. */
  rosterGaps?: RosterReaderGap[];
  /**
   * WHICH empty this is (M112, 2026-08-16). A division the reader is not
   * standing in has to be asked about, and neither a question in flight nor a
   * failed one is an absence of record — each gets its own sentence, and each
   * of those sentences is about us rather than about a government.
   */
  representationNoteState?: "gap" | "looking" | "unavailable";
  /*
   * `placesWithin` REMOVED — F01 1.1, 2026-08-19. The row was always blank
   * and nobody could tell what "places within" meant: either populate it
   * with real data or remove it.
   *
   * REMOVED, and here is the reasoning:
   *
   * 1. **Nothing ever produced it.** No caller anywhere passed this prop, so
   *    the row rendered an em-dash on every district card at every zip since
   *    the day it shipped. It was not a gap in the data; it was a field with
   *    no producer, which is worse — a reader cannot tell those apart, and the
   *    em-dash reads as "we looked and found none".
   *
   * 2. **It has no stable meaning to populate.** This one card renders
   *    congressional, state-house, state-senate, county, municipal and
   *    school-district subjects. "Places within" a county is a containment
   *    question; within a congressional district it is a PARTIAL-OVERLAP
   *    question, because municipalities routinely straddle district lines and
   *    a count would silently assert containment we did not compute. One label
   *    meaning different things per row is what the plain-language rule
   *    forbids, and populating it would have been a claim, not a count.
   *
   * 3. **The useful version is already answered, better, twice.** The PLACE
   *    CARD (g18) lists every body we hold in a place, each row opening that
   *    body's card; Who Governs Here lists the bodies covering a point. A
   *    third, weaker, uncountable answer beside those is not coverage.
   *
   * If a future session wants this back it needs a definition per division
   * type and a source per row — at which point it is a new field, not this one.
   */
  /**
   * Upcoming meetings on file for this division. Null means the fetch that
   * would answer failed — "couldn't check" and 0 are different facts (2a).
   */
  upcomingMeetings: number | null;
  listingCount?: ReturnType<typeof readerMeetingCount>;
  /**
   * **WGH-15.** The zip the reader told us about — their HOME question — so
   * this card can say how their home stands relative to the district they
   * tapped.
   *
   * OPTIONAL and read-only. Absent, the card still names its own subject and
   * claims nothing about the reader, which is the correct answer for a reader
   * who has panned the map without ever naming a place. **Passing it can never
   * change the home store**: everything downstream of it runs through a
   * `BROWSING` location, which settles nothing.
   */
  homeZip?: string | null;
  /** Opens the rep popup (3c) for a clicked name. */
  onOpenOfficial?: (holder: SeatHolder) => void;
  /**
   * **BC-8 (2026-08-24).** Minimizes this card and shows this body's upcoming
   * meetings. Absent, the count renders as plain text — a door with nowhere to
   * go is worse than a number.
   */
  onShowMeetings?: () => void;
  onExpand?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
}

export function DistrictPopup({
  district,
  representation = [],
  rosterGaps = [],
  representationNoteState = "gap",
  upcomingMeetings,
  listingCount,
  homeZip = null,
  onOpenOfficial,
  onShowMeetings,
  onExpand,
  onClose,
  onMinimize,
}: DistrictPopupProps) {
  // F01 1.2: derived from the same roster the list below renders, so the two
  // can never name a different set of people.
  /*
   * LBL-1 (2026-08-22): nobody runs a congressional district and nobody runs a
   * U.S. Senate seat. The field is REMOVED on those cards — not renamed — and
   * the representation the card already shows is the correct account of that
   * relationship. The rule is whether the office holds executive authority over
   * a governing entity.
   */
  const showsWhoRunsIt = runsSomething(district.type);
  // OFF-4 (2026-08-24): the appointed executive leads the list here too — the
  // small card and the large one may not order one roster two ways.
  const ordered = rosterInReadingOrder(representation);
  const topOffices = showsWhoRunsIt ? topOfficesFor(ordered) : [];

  return (
    <PopupCard
      type={district.typeLabel}
      tier={district.tier}
      title={district.label}
      onExpand={onExpand}
      expandLabel={`More about ${district.label}`}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      {/*
        WGH-15: the subject line comes FIRST, above the facts, because it is
        what tells the reader how to read every fact underneath it.
      */}
      <BrowsingSubjectLine
        label={district.label}
        homeZip={homeZip}
        ocdId={district.ocdId}
      />

      {/* No OCD-ID row: internal identifiers never render to readers (4a).
          The identifier still keys everything behind this card. */}
      <PopupRow label="Type">{district.typeLabel}</PopupRow>
      <PopupRow label="Tier">{TIER_LABEL[district.tier]}</PopupRow>
      <RosterCompletenessGaps gaps={rosterGaps} />

      {/*
        **BC-8 (2026-08-24) — THE COUNT IS A DOOR.**

        Clicking the upcoming count minimizes this card and returns
        to that body's upcoming-meetings view. It is the same grammar the four
        sidebar tiles already carry — every number on a surface opens the list
        it counts — and this was the one counter still rendering as furniture.

        A count of zero is NOT a door: there is nothing on the other side, and a
        control that opens an empty list is the reader friction the rule names.
        "Couldn't check" is not a door either, for a stronger reason — a failed
        fetch may not be dressed as a browsable result (2a).
      */}
      <PopupRow label={listingCount?.unresolved ? "Upcoming calendar listings" : "Upcoming"} mono>
        {upcomingMeetings === null ? (
          <NoValue>couldn&apos;t check</NoValue>
        ) : onShowMeetings && upcomingMeetings > 0 ? (
          <button
            type="button"
            onClick={onShowMeetings}
            className="cursor-pointer text-link underline decoration-dotted underline-offset-2 hover:text-paper"
            aria-label={`Show the ${upcomingMeetings} upcoming ${listingCount?.unresolved ? "calendar listings" : "meetings"} for ${district.label}`}
          >
            {upcomingMeetings}
          </button>
        ) : (
          upcomingMeetings
        )}
      </PopupRow>
      <MeetingListingNotice groups={listingCount?.groups ?? []} />

      {/*
        **F01 1.2 (2026-08-19)** — WHO RUNS IT, AT THE TOP.

        The superintendent belongs at the top, so the small card carries a
        little representation. And as the class: every small battlecard carries its top two office
        holders, whatever those offices are called for that body type.

        The list below is the body’s full roster in the body’s own published
        order, which is an answer to “who sits on it” and not to “who runs
        it”. Those are different questions and the card was only answering the
        first — on Tucson Unified it opened with a board member, and the
        district’s superintendent and board president were somewhere in a
        five-row list a reader had to read to find.

        The precedence is `lib/officials/top-offices.ts`, shared with the large
        card, so the two cannot disagree about who leads a body.

        THE GAP IS NAMED. A body whose top offices are not sourced renders a
        sentence about OUR research — never a blank slot, which would read as
        “this body has no leader”. */}
      {showsWhoRunsIt && <PopupSectionLabel>Who runs it</PopupSectionLabel>}
      {!showsWhoRunsIt ? null : topOffices.length > 0 ? (
        topOffices.map((office) => (
          <div key={`top:${office.holder.id}`} className="person-row">
            <span className="person-row-name">
              {onOpenOfficial ? (
                <button
                  type="button"
                  onClick={() => onOpenOfficial(office.holder)}
                  className="cursor-pointer text-left hover:text-link hover:underline"
                >
                  {displayPersonName(office.holder.name)}
                </button>
              ) : (
                displayPersonName(office.holder.name)
              )}
            </span>
            {/* What they DO here, in reader language, with the body’s own
                published title beneath it — the role is our word, the title is
                theirs, and the two are never merged. */}
            <span className="person-row-office">
              {office.role}
              {office.holder.officeTitle ? ` · ${readerOfficeTitle(office.holder.officeTitle)}` : ""}
            </span>
          </div>
        ))
      ) : (
        <p className="mt-1 t-caption leading-relaxed text-muted">
          {TOP_OFFICES_GAP}
        </p>
      )}

      <PopupSectionLabel>Representation</PopupSectionLabel>
      {representation.length > 0 ? (
        /*
         * Item 2 (2026-08-16) — THE VERTICAL-TEXT DEFECT, diagnosed.
         *
         * These rows were `<PopupRow label={readerOfficeTitle(holder.officeTitle)}>`, and
         * `.pk` is `white-space: nowrap`. Inside a 300px card that leaves
         * 264px for a label and a value; "County Supervisor, District 2
         * (Vice Chair)" refuses to wrap and eats all of it, the value column
         * collapses to a few pixels, and `.pv`'s `word-break: break-word`
         * breaks the NAME one character per line. That is what rendered
         * live — Pima's supervisors reading vertically, "Dr. Matt Heinz"
         * as a column of letters.
         *
         * It is not a style preference and it was never fixable by tuning a
         * width: a two-column row whose key can be arbitrarily long will
         * always eventually starve its value. So the row is STACKED — name
         * first at full width, office beneath it — and nothing competes.
         */
        ordered.map((holder) => (
          <div key={holder.id} className="person-row">
            <span className="person-row-name">
              {onOpenOfficial ? (
                // The name opens the rep popup — contact, photo, what the
                // office does. The official page link lives inside it.
                <button
                  type="button"
                  onClick={() => onOpenOfficial(holder)}
                  className="cursor-pointer text-left hover:text-link hover:underline"
                >
                  {holder.name}
                </button>
              ) : holder.websiteUrl ? (
                <a
                  href={holder.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-link hover:underline"
                >
                  {holder.name}
                </a>
              ) : (
                holder.name
              )}
            </span>
            {/*
              **BC-14 (2026-08-25, third pass) — THE RIGHT-EDGE SOURCE LINK IS
              GONE FROM THE SMALL CARD.**

              Sources live in the large battlecard; the small card lists names
              and nothing else. Screenshot `09-01-39` boxes two rows on
              this component wrapping onto two lines, and `09-20-11` shows the
              Morris card scrolling sideways — the `· SRC` run is what was
              pushing both.

              **This is the instance the previous two passes could not see.**
              The 8/24 close-out reported "4 surfaces, 0 footnote markers" and
              it was TRUE — of meeting provenance, through
              `sourceCreditFor(meetings)`. This is an OFFICE-HOLDER on a
              different component with a different data type, so no predicate
              built around meetings could ever reach it. See
              `docs/reconciliation-2026-08-25.md`.

              **`holder.sourceUrl` IS NOT DELETED** and nothing about the
              record changed — RULING 138 says display consolidates and the
              record is never deleted. The value still travels on the row and
              still renders in the large card, which the name opens.
            */}
            <span className="person-row-office">
              {readerOfficeTitle(holder.officeTitle)}
            </span>
          </div>
        ))
      ) : (
        <p className="mt-1.5 t-caption leading-relaxed text-muted">
          {/* The same line the battlecard shows for the same division — the
              two surfaces cannot say different things about one gap, and
              neither may claim a gap before the lookup answers (M112). */}
          {representationNoteFor(district.tier, representationNoteState)}
        </p>
      )}

    </PopupCard>
  );
}
