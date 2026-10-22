"use client";
import { PlaceOpenData } from "./open-data";

import { useShellData } from "@/lib/state/data";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import { staleDivisionRead, type DivisionRead } from "@/lib/meetings/freshness";
import type { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "./meeting-listing-notice";
import {
  CouldGovernMark,
  CouldGovernNotice,
} from "@/components/address/could-govern-notice";
import { useRef, type ReactNode } from "react";
import Image from "next/image";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import { useNarrowing } from "@/hooks/use-narrowing";
import { useResolvedLocation } from "@/hooks/use-resolved-location";

import type { StreetPoint } from "@/lib/geo/census-geocoder";
import type { CoverageTier } from "@/lib/meetings/query";
import {
  type CoverageSummary,
  type CoveredBody,
  type Seat,
} from "@/lib/registry/coverage";
import { deriveWhoGoverns } from "@/lib/registry/who-governs";
import {
  homeSubject,
  scopedToAddress,
  type BodyStanding,
  type LocationCertainty,
} from "@/lib/state/resolved-location";
import { useConfirmedDivisions } from "@/hooks/use-confirmed-divisions";
import { bodyClassShort } from "@/lib/registry/body-class-labels";
import { projectedBodyRoster } from "@/lib/registry/body-roster-client";
import {
  hasRepresentation,
  leadKind,
  noticeLabel,
  shouldRenderNotice,
} from "@/lib/registry/representation";
import {
  panelSeatsFor,
  FEDERAL_SEAT_TYPES,
  STATE_SEAT_TYPES,
  LOCAL_SEAT_TYPES,
  type PanelSeat,
} from "@/lib/state/panel-seats";
import { agendaAbsenceNote, collapseFootnotes } from "@/lib/registry/wording";
import { formatDateLong } from "@/lib/text/format-date";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import { bodyDisplayName, readerPartyLabel } from "@/lib/text/reader-names";
import { groupBySeatLabel } from "@/lib/officials/seat-grouping";
import { GovernmentListings } from "./government-listings";
import { StateOfficeContacts } from "../state-office-contacts";

interface CoverageNoticeProps {
  localPending?: boolean;
  tier: CoverageTier;
  zip: string;
  listingCount?: ReturnType<typeof readerMeetingCount>;
  coverage: CoverageSummary | null;
  /** Divisions whose calendar source failed at the last refresh: "couldn't reach", never "nothing scheduled". */
  failedSourceOcdIds?: string[];

  ocdIdsWithMeetings?: string[];
  /** When the meetings snapshot was last refreshed (ISO instant); null states the fact without a date. */
  lastCheckedAt?: string | null;
  /** Each division's calendar read, from the rows on screen (lastReadByDivision). */
  lastReadByOcdId?: Readonly<Record<string, DivisionRead>>;
  /** The answer shown is the previous area's while a fresher one loads; the card dims rather than unmounting. */
  refreshing?: boolean;
  onOpenOfficial?: OpenOfficial;
  /** Opens a body's large battlecard. Nothing on this list links out of the product. */
  onOpenBody?: (body: CoveredBody) => void;
  /** Shrinks the card to its corner bubble. */
  onMinimize?: () => void;
  /** Fires when the reader applies a narrowing, never on decline or undo. */
  onNarrowApplied?: () => void;
  /** The narrowed street resolved to a point. */
  onStreetPoint?: (point: StreetPoint) => void;
  /** The reader settled their address on any surface. */
  onAddressResolved?: (scope: { divisionIds: string[]; contestIds: string[] }) => void;
  /** They asked for the whole area back. */
  onAddressCleared?: () => void;
  /** The single pill cluster, when this card is the surface on screen; this card never constructs one. */
  pillCluster?: ReactNode;
  /** Rendered as the body of the design card, which owns the frame. */
  embedded?: boolean;
  /** A cluster is painted elsewhere on screen. */
  clusterElsewhere?: boolean;
}

export type OpenOfficial = (
  holder: SeatHolder,
  seatLabel: string | null,
  tier: "local" | "state" | "national",
  ocdId: string | null,
) => void;

const DIVISION_NOUN: Record<NonNullable<CoveredBody["divisionType"]>, string> = {
  county: "County",
  place: "Municipal",
  school_district: "School district",
  cd: "Congressional",
  sldu: "State senate",
  sldl: "State house",
};

const BODY_CLASS_NOUN = (bodyClass: CoveredBody["bodyClass"]): string =>
  bodyClassShort(bodyClass);

/** Type labels are structural and render neutral; tier accents belong to section headers. */
const TYPE_LABEL_CLASS = "text-label";

/**
 * Says whose question the card answers: the ZIP typed, refined by the address
 * if one was given. The district popup's subject is whatever was tapped.
 */
function SubjectLine({
  zip,
  standing,
}: {
  zip: string;
  /** `ADDRESS_RESOLVED` means the reader settled it themselves. */
  standing: LocationCertainty;
}) {
  return (
    <p
      data-home-subject={zip}
      className="mt-1 t-caption leading-relaxed text-muted"
    >
      {standing === "ADDRESS_RESOLVED" ? (
        <>Your area — {zip}, narrowed by the address you gave.</>
      ) : (
        <>Your area — {zip}, the area you asked about.</>
      )}
    </p>
  );
}

function OverlapMark({ zip }: { zip: string }) {
  return (
    <span
      data-standing="OVERLAP_NOT_RULED_OUT"
      className="ml-1.5 shrink-0 t-caption leading-none text-muted"
    >
      may also cover you — your address named a different one in {zip}
    </span>
  );
}

/** Rows where something else at the same overlapping level is the reader's. */
function marksOverlap(standing: BodyStanding | undefined): boolean {
  return standing === "OVERLAP_NOT_RULED_OUT";
}

/** A seat shows its held name and representatives; gaps join the card footer. */
function SeatRow({ seat, zip, onOpenOfficial }: { seat: PanelSeat; zip: string; onOpenOfficial?: OpenOfficial }) {
  return <>
    {!seat.label && seat.sourcing !== "looking" && <CardGapContribution id={`seat-name:${seat.ocdId}`} label="district names" unit="district" />}
    {seat.representatives.length === 0 && !seat.vacancy && seat.sourcing !== "looking" && <CardGapContribution id={`seat-representatives:${seat.ocdId}`} label="representatives" unit="district" />}
    {(seat.label || seat.representatives.length > 0) && <li
      data-seat-standing={seat.standing}
      data-seat-sourcing={seat.sourcing}
      className="t-detail leading-snug"
    >
      {seat.label && <span className={TYPE_LABEL_CLASS}>{seat.label}</span>}
      {marksOverlap(seat.standing) && <OverlapMark zip={zip} />}
      {seat.representatives.length === 0 && seat.vacancy && <span className="block person-under-heading">Seat vacant · <a href={seat.vacancy.sourceUrl} target="_blank" rel="noopener noreferrer">House Clerk</a></span>}
      {seat.representatives.length > 0 && <span className="block person-under-heading">
        <HolderList holders={[...seat.representatives]} seatLabel={seat.label ?? ""} seatOcdId={seat.ocdId} tier={seat.tier} onOpenOfficial={onOpenOfficial} />
      </span>}
    </li>}
  </>;
}

function seatPhrase(seats: Seat[]): string | null {
  if (seats.length === 0) return null;
  // Census labels already read as seats, so no chamber noun is added.
  const labels = seats.map((s) => s.label);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** One person, with their source record one click away. */
function Holder({
  holder,
  onOpen,
  showOfficeTitle = false,
}: {
  holder: SeatHolder;
  onOpen?: () => void;
  showOfficeTitle?: boolean;
}) {
  /*
   * Name (opens the small battlecard), party as plain text in its colour, and
   * the source mark where required. External links live inside the card.
   */
  return (
    <div className="person-row">
      {holder.photoUrl && <Image src={holder.photoUrl} alt={holder.name} width={36} height={44} unoptimized className="mr-2 h-11 w-9 shrink-0 rounded object-cover" />}
      <span className="person-row-name">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="cursor-pointer text-left hover:text-link hover:underline"
          >
            {holder.name}
          </button>
        ) : (
          holder.name
        )}
        {showOfficeTitle && <span className="block t-caption text-muted">{readerOfficeTitle(holder.officeTitle)}</span>}
        {holder.selectionMethod === "APPOINTED" && <span className="block t-caption text-muted">Appointed</span>}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {holder.partyLabel && (
          // Display only; nothing infers a position from it.
          <span
            className="person-row-party"
            style={
              { color: partyColorVar(holder.partyLabel) } as React.CSSProperties
            }
          >
            {readerPartyLabel(holder.partyLabel)}
          </span>
        )}
      </span>
    </div>
  );
}

function HolderList({
  holders,
  seatLabel,
  seatOcdId,
  tier,
  onOpenOfficial,
}: {
  holders: SeatHolder[];
  seatLabel: string | null;
  seatOcdId: string | null;
  tier: "local" | "state" | "national";
  onOpenOfficial?: OpenOfficial;
}) {
  // Stacked, not comma-joined, so two names never read as one.
  return (
    <>
      {holders.map((holder) => (
        <Holder
          key={`${holder.id}|${holder.officeJurisdictionOcdId ?? seatOcdId ?? ""}|${holder.officeTitle}`}
          holder={holder}
          showOfficeTitle={tier === "local"}
          onOpen={
            onOpenOfficial
              ? () => onOpenOfficial(holder, seatLabel, tier, seatOcdId)
              : undefined
          }
        />
      ))}
    </>
  );
}

/**
 * The coverage states, in the reader's words. A body known to exist with no
 * calendar held must not read "no meetings".
 */
function CoverageBody({
  localPending = false,
  zip,
  coverage,
  failedSourceOcdIds = [],
  ocdIdsWithMeetings = [],
  lastCheckedAt = null,
  lastReadByOcdId = {},
  onOpenOfficial,
  onOpenBody,
  onAddressResolved,
  onAddressCleared,
}: {
  localPending?: boolean;
  zip: string;
  coverage: CoverageSummary;
  failedSourceOcdIds?: string[];
  /** Which of those bodies have rows on screen anyway. */
  ocdIdsWithMeetings?: string[];
  /** When the meetings snapshot was last refreshed, for the per-body notes. */
  lastCheckedAt?: string | null;
  lastReadByOcdId?: Readonly<Record<string, DivisionRead>>;
  onOpenOfficial?: OpenOfficial;
  onOpenBody?: (body: CoveredBody) => void;
  /** The reader settled their address, on any surface. */
  onAddressResolved?: (scope: { divisionIds: string[]; contestIds: string[] }) => void;
  /** They asked for the whole area back. */
  onAddressCleared?: () => void;
}) {
  const {
    bodies,
    seats,
    unincorporated,
    counts,
    senators,
    seatCounts,
    statewideExecutives,
    stateLegislatorAuthorities = [],
  } = coverage;

  const resolvedLocation = useResolvedLocation(zip);
  const subject = homeSubject(resolvedLocation);

  /*
   * The reader's own confirmed districts carry ids only, so name and roster
   * are fetched by division key and injected as rows.
   */
  const stateConfirmed = useConfirmedDivisions(coverage, subject.location, STATE_SEAT_TYPES);
  const localConfirmed = useConfirmedDivisions(coverage, subject.location, LOCAL_SEAT_TYPES);
  const federalConfirmed = useConfirmedDivisions(
    coverage,
    subject.location,
    FEDERAL_SEAT_TYPES,
  );

  const statePanel = panelSeatsFor(
    coverage,
    subject.location,
    STATE_SEAT_TYPES,
    stateConfirmed,
  );
  const federalPanel = panelSeatsFor(
    coverage,
    subject.location,
    FEDERAL_SEAT_TYPES,
    federalConfirmed,
  );
  const stateSeats = statePanel.yours;
  const localSeats = panelSeatsFor(coverage, subject.location, LOCAL_SEAT_TYPES, localConfirmed).yours;
  const federalSeats = federalPanel.yours;
  const stateLegislatorGaps = stateLegislatorAuthorities.filter(authority => authority.kind === "NOT_RECORDED" || authority.kind === "STORE_UNREACHABLE");

  /* Device-local narrowing: bodies of the picked type narrow to the choice. */
  const narrowing = useNarrowing(zip);
  const selected = new Set(narrowing.divisions);

  /*
   * Drops only `ELSEWHERE_IN_ZIP`; overlapping levels are untouched. Every
   * count on this card derives from this array.
   */
  const bodiesHere = scopedToAddress(bodies, subject.location);

  const derived = deriveWhoGoverns(bodiesHere, selected);
  const shown = derived.rows;
  // "" when unknown, so the sentence stands without a date.
  const lastCheckedLong = formatDateLong(lastCheckedAt);
  const lastCheckedClause = lastCheckedLong ? `, ${lastCheckedLong}` : "";
  /* The governing list is never cut, so prose and row counts agree. */
  const seatLine = seatPhrase(seats);
  const kind = leadKind(coverage);
  const g = { total: derived.governingCount, withSource: derived.governingWithSource };
  const others = derived.others;
  const othersWithSource = derived.othersWithSource;

  const missingCalendars = Math.max(0, g.total - g.withSource) + Math.max(0, others - othersWithSource);
  const hasFederalOfficials = seats.some((seat) => seat.tier === "national" && seat.representatives.length > 0) || senators.length > 0;
  const hasStateOfficials = seats.some((seat) => seat.tier === "state" && seat.representatives.length > 0) || statewideExecutives.length > 0;
  const heldCoverage = [
    hasFederalOfficials ? "your federal representatives and senators" : null,
    hasStateOfficials ? "state officials" : null,
    g.total > 0 ? `${g.total} local ${g.total === 1 ? "body" : "bodies"}${g.withSource > 0 ? `, with ${g.withSource === 1 ? "one calendar" : `${g.withSource} calendars`}` : ""}` : null,
  ].filter(Boolean);

  const lead = localPending || kind === "unmapped" ? null : kind === "none-scheduled" ? (
    <>We don&apos;t have upcoming meetings for the {counts.total === 1 ? "body" : `${counts.total} bodies`} covering {zip} yet.</>
  ) : g.total > 0 ? (
    <>
      {g.total === 1 ? "One body governs" : `${g.total} bodies govern`} the area around {zip}.
      {g.withSource > 0 && <> We track {g.withSource === g.total ? (g.total === 1 ? "its calendar" : "all of their calendars") : `${g.withSource} of their calendars`}.</>}
    </>
  ) : null;

  const othersLine = kind !== "unmapped" && others > 0 ? (
    <>
      {others} more boards, committees and commissions serve the area.
      {othersWithSource > 0 && <> We track {othersWithSource === others ? "all of their calendars" : `${othersWithSource} of their calendars`}.</>}
    </>
  ) : null;

  return (
    <>
      {unincorporated && (
        // The no-mayor case is a stated fact: say what this place has instead.
        <p className="mt-1.5 t-body leading-relaxed text-voice">
          <span className="text-signal">
            This area isn&apos;t a city or town
          </span>{" "}
          — it has no mayor or city council.
          {(() => {
            const county = bodies.find((b) => b.divisionType === "county");
            return county
              ? ` The ${county.name === null ? `${bodyDisplayName(county)} board` : bodyDisplayName(county)} is the closest thing here.`
              : "";
          })()}
        </p>
      )}

      {lead && <p className="mt-1.5 t-body leading-relaxed text-voice">{lead}</p>}
      {!localPending && missingCalendars > 0 && <CardGapContribution id={`area-calendars:${zip}`} label="calendars" count={missingCalendars} unit="body" />}
      {!hasFederalOfficials && <CardGapContribution id={`area-federal-officials:${zip}`} label="federal officials" />}
      {!hasStateOfficials && <CardGapContribution id={`area-state-officials:${zip}`} label="state officials" />}
      {!localPending && g.total === 0 && <CardGapContribution id={`area-local-bodies:${zip}`} label="local bodies" />}

      {/* Counts come from the same arrays the sections below render. */}
      {heldCoverage.length > 0 && <p className="mt-1 t-detail leading-relaxed text-voice" data-mw-covers>
        <strong className="font-semibold text-voice">What Meanwhile has for {zip}:</strong>{" "}
        {heldCoverage.join(" · ")}.
      </p>}

      <SubjectLine zip={zip} standing={subject.location.certainty} />
      <PlaceOpenData zip={zip} />

      {coverage.federalDirectoryUnavailable && <p className="mt-1 t-detail text-voice">We could not load the federal directory just now.</p>}
      <GovernmentListings records={coverage.governments ?? []} states={coverage.governmentInventoryStates ?? []} unavailableStates={coverage.governmentInventoryUnavailableStates} />
      {coverage.fringeDivisions && coverage.fringeDivisions.length > 0 && <p className="mt-1 t-detail leading-relaxed text-voice" data-mw-fringe>
        A small part of {zip} is in {coverage.fringeDivisions.map(division => division.label).join(", ")}. Enter your street address to see if one of them is yours.
      </p>}

      {!localPending && othersLine && (
        <p className="mt-1 t-detail leading-relaxed text-voice">
          {othersLine}
        </p>
      )}

      {/* Opens in place; the label's count is `derived.otherRows.length`. */}
      {derived.otherRows.length > 0 && (
        <details className="mt-1" data-other-bodies-disclosure="">
          <summary className="cursor-pointer t-caption text-link">
            See the rest ({derived.otherRows.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {derived.otherRows.map((body) => (
              <li
                key={body.bodyId}
                data-other-body-row=""
                className="flex items-baseline justify-between gap-3 pb-1"
              >
                <button
                  type="button"
                  onClick={onOpenBody ? () => onOpenBody(body) : undefined}
                  className="min-w-0 flex-1 truncate text-left t-detail leading-snug text-paper hover:underline"
                >
                  {bodyDisplayName(body)}
                </button>
                <span className={TYPE_LABEL_CLASS}>{bodyClassShort(body.bodyClass)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {shown.length > 0 && (
        <p className="t-structure mt-3 text-local">Local</p>
      )}
      {/* The disclosure's number is `shown.length`, the same rows the list renders. */}
      {shown.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer t-caption text-link">
            Why these {shown.length}?
          </summary>
          <p className="mt-1 t-caption leading-relaxed text-voice">
            {shown.length === 1
              ? "This is the government whose boundary covers this area"
              : `These are ${shown.length} of the governments whose boundaries cover this area`}{" "}
            — the county, the city or town, the school district, and any
            special district that governs here. They are ordered by what kind
            of government each one is — county, then city or town, then school
            district, then other districts — and by nothing else. Nothing here
            is scored, and no order on this panel says one government matters
            more than another.
            {others > 0 &&
              ` Boards, committees and commissions are real bodies you can follow, but they aren't governments, so they're counted separately: ${others} of them here.`}
          </p>
        </details>
      )}
      {shown.length > 0 && (
        <ul className="mt-1 space-y-1">
          {shown.map((body) => (
            <li
              key={body.bodyId}
              /* Hook for the walk check that counts rendered government rows. */
              data-governing-row=""
              className="flex items-baseline justify-between gap-3 pb-1"
            >
              {/* The mark sits inside the name's flex item so it stays against the word. */}
              <span className="inline-flex items-baseline">
                {onOpenBody ? (
                  <button
                    type="button"
                    onClick={() => onOpenBody(body)}
                    title={`More about ${bodyDisplayName(body)}`}
                    className="cursor-pointer text-left t-body leading-snug text-paper hover:text-link hover:underline"
                  >
                    {bodyDisplayName(body)}
                  </button>
                ) : (
                  <span className="t-body leading-snug">
                    {bodyDisplayName(body)}
                  </span>
                )}
                {/* Only bodies covering part of a typed zip carry the pill. */}
                {body.couldGovern && (
                  <CouldGovernMark jurisdiction={bodyDisplayName(body)} />
                )}
                {marksOverlap(body.standing) && <OverlapMark zip={zip} />}
              </span>
              <span
                className={`trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] ${TYPE_LABEL_CLASS}`}
              >
                {/* Derived rows tag by division type; curated rows by what they are; a body with no division renders its class. */}
                {body.name === null && body.divisionType !== null
                  ? DIVISION_NOUN[body.divisionType]
                  : BODY_CLASS_NOUN(body.bodyClass)}
              </span>
            </li>
          ))}
          {/* A town with no mayor gets its substitute office named and its members shown. */}
          {shown.flatMap((body) => {
            const board = projectedBodyRoster(body).members.filter((holder) =>
              /select\s?board/i.test(holder.officeTitle),
            );
            if (board.length === 0) return [];
            const townName = body.divisionLabel.replace(
              /\s+(town|city|township|borough)$/i,
              "",
            );
            return [
              <li
                key={`${body.bodyId}-selectboard-fact`}
                className="pb-1 t-detail leading-relaxed text-paper-dim"
              >
                <span className="text-signal">
                  {townName} isn&apos;t a city — it has no mayor.
                </span>{" "}
                The Select Board runs the town.
              </li>,
              ...board.map((holder) => (
                <li
                  key={holder.id}
                  className="flex items-baseline justify-between gap-3 pb-1 t-detail leading-snug"
                >
                  <span className={TYPE_LABEL_CLASS}>{readerOfficeTitle(holder.officeTitle)}</span>
                  <span className="block person-under-heading">
                    <Holder
                      holder={holder}
                      onOpen={
                        onOpenOfficial
                          ? () =>
                              onOpenOfficial(
                                holder,
                                holder.officeTitle,
                                "local",
                                body.ocdId,
                              )
                          : undefined
                      }
                    />
                  </span>
                </li>
              )),
            ];
          })}
        </ul>
      )}

      {localSeats.length > 0 && (
        <>
          <p className="t-structure mt-4 text-local">Local officials</p>
          <ul className="mt-1 space-y-1">
            {localSeats.map(seat => <SeatRow key={seat.ocdId} seat={seat} zip={zip} onOpenOfficial={onOpenOfficial} />)}
          </ul>
        </>
      )}

      {/* One pill for the whole panel; affected rows above carry only an asterisk. */}
      <CouldGovernNotice
        zip={zip}
        count={shown.filter((body) => body.couldGovern === true).length}
        onResolved={onAddressResolved}
        onCleared={onAddressCleared}
      />

      {collapseFootnotes(
        shown.filter(
          (body) =>
            body.ocdId !== null &&
            failedSourceOcdIds.includes(body.ocdId) &&
            ocdIdsWithMeetings.includes(body.ocdId),
        ),
        () =>
          `their calendar page didn’t answer at our last check${lastCheckedClause}; the listings shown for them are from an earlier check.`,
      ).map((footnote) => (
        <p
          key={`source-stale:${footnote.subjects}`}
          className="mt-1.5 t-caption leading-relaxed text-signal"
        >
          <span className="text-paper-dim">{footnote.subjects}</span> —{" "}
          {footnote.note}
        </p>
      ))}

      {collapseFootnotes(
        shown.filter(
          (body) =>
            body.ocdId !== null &&
            failedSourceOcdIds.includes(body.ocdId) &&
            !ocdIdsWithMeetings.includes(body.ocdId),
        ),
        () =>
          `their calendar page didn’t answer at our last check${lastCheckedClause}, so their meetings may be missing here.`,
      ).map((footnote) => (
        <p
          key={`source-failed:${footnote.subjects}`}
          className="mt-1.5 t-caption leading-relaxed text-signal"
        >
          <span className="text-paper-dim">{footnote.subjects}</span> —{" "}
          {footnote.note}
        </p>
      ))}

      {/* A division whose own calendar read is over a day and a half old says so, dated. */}
      {collapseFootnotes(
        shown.filter(
          (body) =>
            body.ocdId !== null &&
            !failedSourceOcdIds.includes(body.ocdId) &&
            ocdIdsWithMeetings.includes(body.ocdId) &&
            staleDivisionRead(lastReadByOcdId[body.ocdId]) !== null,
        ),
        (body) => {
          const read = staleDivisionRead(lastReadByOcdId[body.ocdId!]);
          const lastRead = formatDateLong(read?.at);
          return read && lastRead
            ? `the ${read.upcoming ? "upcoming " : ""}listings shown for them were last read from their calendar on ${lastRead}.`
            : null;
        },
      ).map((footnote) => (
        <p
          key={`source-read:${footnote.subjects}`}
          className="mt-1.5 t-caption leading-relaxed text-signal"
        >
          <span className="text-paper-dim">{footnote.subjects}</span> —{" "}
          {footnote.note}
        </p>
      ))}

      {collapseFootnotes(localPending ? [] : shown, (body) =>
        agendaAbsenceNote(body.ocdId, body.coverageStatus),
      ).map((footnote) => (
        <p
          key={`absence:${footnote.subjects}`}
          className="mt-1.5 t-caption leading-relaxed text-muted"
        >
          <span className="text-paper-dim">{footnote.subjects}</span> —{" "}
          {footnote.note}
        </p>
      ))}

      {seats.length > 0 && !seats.some(seat => seat.vacancy) && seatCounts.named === 0 && statewideExecutives.length === 0 && senators.length === 0 ? (
        // Nothing sourced for any seat — the original wording, still true.
        <p className="mt-2.5 t-detail leading-relaxed text-voice">
          You&apos;re also represented in {seatLine}.
        </p>
      ) : (
        <>
          {/* State: legislators first, then statewide executives. */}
          {(stateSeats.length > 0 || statewideExecutives.length > 0) && (
            <>
              <p className="t-structure mt-4 text-state">
                State
              </p>
              <ul className="mt-1 space-y-1">
                {/* After a confirmed address, only the reader's own districts. */}
                {stateSeats.map((seat) => (
                  <SeatRow
                    key={seat.ocdId}
                    seat={seat}
                    zip={zip}
                    onOpenOfficial={onOpenOfficial}
                  />
                ))}
                {statewideExecutives.map((holder) => (
                  <li
                    key={holder.id}
                    className="t-detail leading-snug"
                  >
                    <span className={TYPE_LABEL_CLASS}>{readerOfficeTitle(holder.officeTitle)}</span>
                    <span className="block person-under-heading">
                      <Holder
                        holder={holder}
                        onOpen={
                          onOpenOfficial
                            ? () =>
                                onOpenOfficial(
                                  holder,
                                  holder.officeTitle,
                                  "state",
                                  null,
                                )
                            : undefined
                        }
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Federal: the House member before the senators. "Federal", never "National". */}
          {(federalSeats.length > 0 || senators.length > 0) && (
            <>
              <p className="t-structure mt-4 text-national">
                Federal
              </p>
              <ul className="mt-1 space-y-1">
                {federalSeats.map((seat) => (
                  <SeatRow
                    key={seat.ocdId}
                    seat={seat}
                    zip={zip}
                    onOpenOfficial={onOpenOfficial}
                  />
                ))}
                {/* One heading per seat label (`lib/officials/seat-grouping.ts`); the callback gets the singular title. */}
                {groupBySeatLabel(
                  senators.map((holder) => ({ label: "U.S. Senator", member: holder })),
                ).map((group) => (
                  <li
                    key={group.members[0].id}
                    className="t-detail leading-snug"
                  >
                    <span className={TYPE_LABEL_CLASS}>{group.label}</span>
                    <span className="block person-under-heading">
                      {group.members.map((holder) => (
                        <Holder
                          key={holder.id}
                          holder={holder}
                          onOpen={
                            onOpenOfficial
                              ? () =>
                                  onOpenOfficial(holder, group.singular, "national", null)
                              : undefined
                          }
                        />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

        </>
      )}

      {stateLegislatorGaps.map(authority => (
        <CardGapContribution key={authority.scope} id={`area-state-authority:${authority.scope}`} label={`state legislators in ${authority.scope.replace(/^US-/, "")}`} />
      ))}

      {shown.filter(body => body.name === null).length > 0 && <CardGapContribution id={`area-body-names:${zip}`} label="names" count={shown.filter(body => body.name === null).length} unit="body" />}

      {/* The mover's page, one tap from who-governs. */}
      {/^\d{5}$/.test(zip) && (
        <p className="mt-2 t-detail">
          <a
            href={`/about-area?zip=${zip}`}
            className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Moving here? Know the basics →
          </a>
        </p>
      )}
    </>
  );
}

export function CoverageNotice({
  localPending = false,
  tier,
  zip,
  listingCount,
  coverage,
  failedSourceOcdIds,
  ocdIdsWithMeetings,
  lastCheckedAt,
  lastReadByOcdId,
  refreshing = false,
  onOpenOfficial,
  onOpenBody,
  onMinimize,
  onAddressResolved,
  onAddressCleared,
  pillCluster,
  clusterElsewhere = false,
  embedded = false,
}: CoverageNoticeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { result } = useShellData();
  // A press outside minimizes the card to its bubble; declared before the
  // early return so hook order is stable.
  useDismissOnOutside(rootRef, onMinimize ?? (() => {}), Boolean(onMinimize));

  // The gate lives in lib/registry/representation.ts.
  if (!shouldRenderNotice(tier, coverage)) return null;

  const isEmpty = tier === "none" && !localPending;
  const label = localPending ? "Who governs here" : noticeLabel(tier, coverage);

  // Amber marks missing meeting coverage.
  const accent =
    !localPending && tier === "concluded"
      ? "text-concluded"
      : localPending || tier === "exact"
        ? "text-muted"
        : "text-signal";

  // The ballot entry carries the zip the card is about.
  const ballotZip = zip && /^\d{5}$/.test(zip) ? zip : null;

  return (
    <div
      ref={rootRef}
      data-refreshing={refreshing ? "true" : undefined}
      className={
        embedded
          ? "coverage-notice mw-embedded relative"
          : "coverage-notice panel pointer-events-auto relative max-w-md px-4 py-3.5"
      }
    >
      {onMinimize && (
        // The explicit way out.
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimize — the card stays one tap away"
          className="absolute top-2 right-2 z-10 cursor-pointer p-1 text-muted hover:text-paper"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}
      {/* Pinned: the header never scrolls, so the ballot entry stays reachable. */}
      <div className="coverage-notice-head">
        <p
          className={`font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] ${accent}`}
        >
          {label}
        </p>

        {/* The fallback renders only when the cluster is elsewhere, so exactly one ballot door shows. */}
        {pillCluster ??
          (clusterElsewhere ? null : (
            <a
              href={ballotZip ? `/ballot?zip=${ballotZip}` : "/ballot"}
              className="coverage-notice-ballot mt-2 flex items-center justify-between gap-2 rounded border border-[var(--signal)]/45 bg-[var(--signal)]/5 px-2.5 py-2 t-body leading-snug text-paper hover:border-[var(--signal)]"
            >
              <span className="font-semibold">What&apos;s on the ballot</span>
              <span aria-hidden="true" className="shrink-0 text-signal">
                →
              </span>
            </a>
          ))}
      </div>

      <div className="coverage-notice-body">
      <MeetingListingNotice groups={listingCount?.groups ?? []} />
      <StateOfficeContacts offices={coverage?.stateOffices ?? []} />
      {isEmpty && <p className="mt-1.5 t-body leading-relaxed text-paper-dim">We don&apos;t have this place&apos;s meetings yet.</p>}

      {result?.readerScope?.governments && result.readerScope.governments.length > 0 && (
        <section className="mt-3" aria-label="Upcoming meetings of the place’s governments" data-place-government-meetings>
          <h3 className="t-heading text-paper">Governments at this place</h3>
          <ul className="mt-2 space-y-2">
            {result.readerScope.governments.map(body => <li key={body.bodyId} data-upcoming-body={body.bodyId}>
              <span className="t-body text-paper">{body.name}</span>
              {body.upcoming > 0 ? <p className="t-detail text-muted">{body.upcoming} upcoming {body.upcoming === 1 ? "meeting" : "meetings"} held{body.agendasLinked > 0 ? ` · ${body.agendasLinked} ${body.agendasLinked === 1 ? "agenda" : "agendas"} linked` : ""}</p>
                : <CardGapContribution id={`area-upcoming:${body.bodyId}`} label="upcoming meetings" unit="body" subject={{ type: "BODY", id: body.bodyId }} />}
              {body.upcoming > body.agendasLinked && <CardGapContribution id={`area-agendas:${body.bodyId}`} label="agendas" count={body.upcoming - body.agendasLinked} unit="meeting" kind="not-posted" subject={{ type: "BODY", id: body.bodyId }} />}
            </li>)}
          </ul>
        </section>
      )}
      {!localPending && tier === "concluded" && <p className="mt-2 t-body text-paper-dim">Recent meetings for this place.</p>}

      {coverage && hasRepresentation(coverage) ? (
        <CoverageBody
          localPending={localPending}
          zip={zip}
          coverage={coverage}
          failedSourceOcdIds={failedSourceOcdIds}
          ocdIdsWithMeetings={ocdIdsWithMeetings}
          lastCheckedAt={lastCheckedAt}
          lastReadByOcdId={lastReadByOcdId}
          onOpenOfficial={onOpenOfficial}
          onOpenBody={onOpenBody}
          onAddressResolved={onAddressResolved}
          onAddressCleared={onAddressCleared}
        />
      ) : null}
      </div>
    </div>
  );
}
