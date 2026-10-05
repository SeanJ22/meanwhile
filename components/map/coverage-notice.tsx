"use client";

import { useShellData } from "@/lib/state/data";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
import { staleDivisionRead, type DivisionRead } from "@/lib/meetings/freshness";
import type { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { MeetingListingNotice } from "./meeting-listing-notice";
import {
  CouldGovernMark,
  CouldGovernNotice,
} from "@/components/address/could-govern-notice";
import { useRef, type ReactNode } from "react";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import { useNarrowing } from "@/hooks/use-narrowing";
import { useResolvedLocation } from "@/hooks/use-resolved-location";
import { formatMiles } from "@/lib/map/format";


import type { StreetPoint } from "@/lib/geo/census-geocoder";
import type { CoverageTier } from "@/lib/meetings/query";
import {
  type CoverageSummary,
  type CoveredBody,
  type Seat,
} from "@/lib/registry/coverage";
import { stateLegislatorCoverageGapText } from "@/lib/registry/coverage-client";
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
  noteStateFor,
  noticeLabel,
  representationForDivision,
  representationNoteFor,
  shouldRenderNotice,
} from "@/lib/registry/representation";
import {
  panelSeatsFor,
  FEDERAL_SEAT_TYPES,
  STATE_SEAT_TYPES,
  type PanelSeat,
} from "@/lib/state/panel-seats";
import { agendaAbsenceNote, collapseFootnotes } from "@/lib/registry/wording";
import { formatDateLong } from "@/lib/text/format-date";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
import { bodyDisplayName, readerPartyLabel } from "@/lib/text/reader-names";
import { groupBySeatLabel } from "@/lib/officials/seat-grouping";

/**
 * Says which rung of the cascade produced what's on screen, and — when there is
 * nothing on screen — who governs here anyway.
 *
 * Two failures, one component. A search that quietly widened its radius, or
 * quietly reached into last month, looks exactly like one that found what you
 * asked for. And an empty map reads as "your government does nothing" when the
 * truth is "we have no source for the bodies that govern here". Both are the
 * same bug: an answer that does not say what kind of answer it is.
 *
 * **Nothing here presents a derived body as a sourced fact.** Division labels
 * come off the Census boundary files, so they are sourced and safe to print. The
 * bodies' own names, schedules and members are all unknown, and the copy is
 * written to claim only what the registry actually knows: that a division of
 * this type exists here, and that a division of this type has a governing body.
 */

interface CoverageNoticeProps {
  tier: CoverageTier;
  zip: string;
  radiusKm: number;
  requestedRadiusKm: number;
  count: number;
  listingCount?: ReturnType<typeof readerMeetingCount>;
  coverage: CoverageSummary | null;
  /**
   * Divisions whose calendar source failed at the last snapshot refresh. A
   * body on this list showing nothing means "we couldn't reach their source
   * this time", which is a different claim from "nothing is scheduled" and
   * must never render the same way.
   */
  failedSourceOcdIds?: string[];
  /**
   * **F01 7.2 (2026-08-19)** — which of those bodies nevertheless
   * has meetings ON SCREEN right now.
   *
   * The finding: the New Hampshire card said it couldn’t reach Kearsarge’s and
   * Newbury’s calendar sources “so their meetings may be missing here”, and
   * clicking the maroon dot in New London showed Kearsarge meetings anyway.
   *
   * Diagnosed before fixing, and neither surface was lying — they were
   * answering different questions. `carry-forward.ts` exists precisely so a
   * refused source does not empty a previously-full surface, so the pins stay
   * and each carried row states its own age. The WARNING never learned that:
   * it fired on the REFUSAL alone and said “may be missing” about rows the
   * reader could see.
   *
   * So the card is told what the map is showing, and the two sentences split:
   * a body with rows on screen is one whose calendar we could not REFRESH; a
   * body with none is one whose meetings may genuinely be missing. Both are
   * true, they are different facts, and only one of them was ever being said.
   */
  ocdIdsWithMeetings?: string[];
  /**
   * When the meetings snapshot behind this card was last refreshed
   * (`snapshot.generatedAt`, an ISO instant). The per-body source notes spell
   * this out as the "last check" date through the product's one formatter. Null
   * when unknown, in which case the note states the fact without a date rather
   * than inventing one.
   */
  lastCheckedAt?: string | null;
  /** Each division's calendar read, from the rows on screen (lastReadByDivision). */
  lastReadByOcdId?: Readonly<Record<string, DivisionRead>>;
  /**
   * The answer under this card is the previous area's, and a fresher one is
   * in flight (6f). The card DIMS rather than un-rendering — un-rendering is
   * what made the bubble blink on every pan — and the dim is what keeps a
   * held answer from reading as a settled one.
   */
  refreshing?: boolean;
  onOpenOfficial?: OpenOfficial;
  /**
   * Opens a BODY's large battlecard (item 3, 2026-08-16). The click grammar on this surface is exactly two moves: a
   * person's name opens their small card, a body's row opens the body's
   * large one. Nothing on this list leaves the product — Pima and Tucson
   * used to link straight out to their own websites from the row, and every
   * external door now lives inside the card the row opens.
   */
  onOpenBody?: (body: CoveredBody) => void;
  /** Shrinks the card to its corner bubble — the explicit control (3). */
  onMinimize?: () => void;
  /** Item 7: fires when the reader APPLIES a narrowing (street or picker)
   *  — never on decline or undo. The map turns its boundary shading on. */
  onNarrowApplied?: () => void;
  /** D53: the narrowed street resolved to a point. Passed straight through. */
  onStreetPoint?: (point: StreetPoint) => void;
  /**
   * WGH-5 (2026-08-22): the reader settled their address on ANY surface, so
   * every jurisdiction on the page re-resolves and the hedges drop.
   */
  onAddressResolved?: (scope: { divisionIds: string[]; contestIds: string[] }) => void;
  /** They asked for the whole area back. */
  onAddressCleared?: () => void;
  /**
   * 4e: the single pill cluster, when this card is the surface on screen.
   * Null otherwise — this card never constructs one, because a second
   * constructor is a second instance waiting to happen.
   */
  pillCluster?: ReactNode;
  /** Rendered as the body of the design card, which owns the frame. */
  embedded?: boolean;
  /** A cluster painted SOMEWHERE. Same reason as the rail's copy. */
  clusterElsewhere?: boolean;
}

/*
 * `NAME_LIMIT = 5` lived here until item 1a (2026-08-17) and is deliberately
 * gone rather than left unused. It cut the body list at five while the lead
 * sentence counted the governing set, which is how one surface came to state
 * three different numbers for one list. The governing list is now rendered
 * whole; there is no cut left to configure, and re-introducing one re-opens
 * the defect.
 */

/**
 * Opens the rep popup (3c). Seat label and tier ride along for the card;
 * the seat's division id rides along for the OFFICIAL_OPENED log event
 * (null where the holder has no single seat division, e.g. senators).
 */
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

/*
 * One source for these labels (RULING 118 / RULING 119, 2026-08-24). This was
 * one of THREE copies; the third was a binary that called anything not
 * GOVERNING "Advisory", which would have labelled a sovereign tribal nation
 * advisory the day one shipped.
 */
const BODY_CLASS_NOUN = (bodyClass: CoveredBody["bodyClass"]): string =>
  bodyClassShort(bodyClass);

/**
 * Item 5, the palette pass (2026-08-15). These were `text-local` /
 * `text-state` / `text-national` — the tier accents — on every TYPE label in
 * the list ("COUNTY", "MUNICIPAL", "SCHOOL DISTRICT", "COMMISSION") and on
 * every office title beside a name. That put a saturated accent on the
 * majority of the words in the card, and at 03255 or 85701 the result is a
 * screen where nothing stands out because everything does.
 *
 * A type label is a STRUCTURAL label: it organizes the rows, it is not the
 * record and it is not tappable. It renders neutral and confident — `--label`
 * carries the weight instead of the colour. The tier accent keeps the place
 * it actually earns: the LOCAL / STATE / FEDERAL section headers, and the
 * map legend and tier toggles that share its token family.
 */
const TYPE_LABEL_CLASS = "text-label";

/**
 * **WGH-15 (2026-08-28) — THIS CARD SAYS WHOSE QUESTION IT IS ANSWERING.**
 *
 * The reported screen had two panels open at once, one reading *State House
 * District 17* and one reading *State House District 19*, and neither said what
 * it was about. A reader may live in House 17 and inspect House 21 for an hour
 * — that is the product working — but two unlabelled panels reading different
 * district numbers is a product contradicting itself.
 *
 * This card's subject is the ZIP THE READER TYPED, refined by the address they
 * gave if they gave one. The district popup's subject is whatever they last
 * tapped. Saying so, on both, is the entire repair: the facts were already
 * right and already disjoint.
 *
 * It is not a fourth reader-friction exception. It is not a prompt, it asks for
 * nothing, and it is one line of attribution on an answer — the same class of
 * thing as the coverage label above it.
 */
function SubjectLine({
  zip,
  standing,
}: {
  zip: string;
  /** `ADDRESS_RESOLVED` on this card means the reader settled it themselves. */
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

/*
 * **RULING 222 (2026-08-31) — `ElsewhereMark` IS DELETED, NOT IMPROVED.**
 *
 * A component named `ElsewhereMark` stood here and rendered *"not yours —
 * covers another part of 85641"* beside a district the reader's address had
 * positively excluded. Three sessions improved that sentence, and it was
 * still wrong each time.
 *
 * The ruling ends the class rather than the wording: **after a confirmed
 * address the scope IS the address**, and an entity we have determined does
 * not govern this reader is OUT OF SCOPE, not annotated. There is no row left
 * for a mark to sit on — `scopedToAddress` drops it before it reaches any
 * list — so a mark would have nothing to label and a surface that could
 * re-introduce one would be re-introducing the defect.
 *
 * `tests/address-scope.test.ts` refuses the copy and the standing by name, so
 * this cannot come back as a fourth improvement.
 */

/**
 * **WGH-16 (2026-08-28) — THE ROW THAT IS NOT RULED OUT, AND MUST NOT BE.**
 *
 * The deleted mark said *not yours*. That is a claim about a government, and
 * `standingOf` may reach `ELSEWHERE_IN_ZIP` only at levels measured to hold
 * ONE division per point — `sldl`, `sldu`, `cd`, `county`, `state`.
 *
 * The bodies on this card are not all at those levels. A school board and a
 * municipality sit at `school_district` and `place`, and both of those are
 * measured to OVERLAP: a reader is routinely inside an elementary district and
 * a regional high school district at once, and inside an incorporated place
 * and a county subdivision at once (`lib/state/division-levels.ts`). Before
 * WGH-16 those rows wore the deleted exclusion sentence on the strength of a
 * shared bucket name, which is precisely the manufactured claim `CLAUDE.md`
 * forbids.
 *
 * **The row is still marked, and it is still never removed — and RULING 222
 * does not reach it.** The ruling drops entities the system has DETERMINED do
 * not govern the reader. Nothing has been determined about these: their
 * address named a different one, and these can overlap, so this one may be
 * theirs too. Dropping a row we have not ruled out would be the same
 * manufactured claim in the other direction, and silence is not the safe
 * option either, because an unmarked row on this card reads as *this governs
 * you*.
 */
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

/**
 * Rows where something else at the same level is the reader's, at a level that
 * can hold both. Marked, weakly and honestly — never with the exclusion above.
 */
function marksOverlap(standing: BodyStanding | undefined): boolean {
  return standing === "OVERLAP_NOT_RULED_OUT";
}

/**
 * **ONE SEAT ROW, FOR THE STATE SECTION AND THE FEDERAL ONE.** (WGH-22,
 * 2026-08-31.)
 *
 * The two sections carried copies of this markup and the copies drifted: the
 * federal one silently lacked half the guards the state one had. They are one
 * component now, so a rule applied here is applied to both by construction.
 *
 * **Two nulls, and they are different facts, so they get different sentences.**
 *
 * - **No LABEL yet.** The row is one of the reader's own districts, asked for
 *   by key, and the name has not come back. A reader surface may never print
 *   an OCD-ID (`CLAUDE.md`), and *"District"* alone would be a claim about
 *   which district. It renders the named gap for the lookup's actual state.
 * - **No PEOPLE.** `representationNoteFor` already words the three ways that
 *   happens — still looking, we hold nobody, the lookup failed — and each is
 *   about US. `no record yet` is the `unsourced` case and it stays exactly as
 *   it was for every row that had it before.
 */
function SeatRow({
  seat,
  zip,
  onOpenOfficial,
}: {
  seat: PanelSeat;
  zip: string;
  onOpenOfficial?: OpenOfficial;
}) {
  const noteState = noteStateFor(seat.sourcing);
  return (
    <li
      /* WGH-15: the walk reads the standing off the row rather than inferring
         it from a Tailwind class, so the next design pass cannot silently
         disarm the guard. WGH-22 adds the sourcing for the same reason. */
      data-seat-standing={seat.standing}
      data-seat-sourcing={seat.sourcing}
      className="t-detail leading-snug"
    >
      <span className={TYPE_LABEL_CLASS}>
        {seat.label ?? (
          <span className="text-muted">
            {seat.sourcing === "looking"
              ? "Looking up your district…"
              : "We couldn't name this district just now."}
          </span>
        )}
      </span>
      {/*
        RULING 222: no exclusion mark. A district the address ruled out is not
        on this list to be marked. The overlap mark stays where it can fire —
        these three levels are all measured exclusive, so it cannot fire here,
        and a branch that cannot fire is a branch a later reader must disprove.
      */}
      {marksOverlap(seat.standing) && <OverlapMark zip={zip} />}
      <span className="block person-under-heading">
        {seat.representatives.length > 0 ? (
          <HolderList
            holders={[...seat.representatives]}
            seatLabel={seat.label ?? ""}
            seatOcdId={seat.ocdId}
            tier={seat.tier}
            onOpenOfficial={onOpenOfficial}
          />
        ) : seat.sourcing === "unsourced" ? (
          // Not "vacant" — we simply have no record. The two are completely
          // different claims and only one is ours to make.
          <span className="text-muted">no record yet</span>
        ) : (
          // Still asking, or the asking failed. Neither is an absence, and
          // rendering either as one is the render-default rule broken by a
          // timing gap instead of by a null.
          <span className="text-muted">{representationNoteFor(seat.tier, noteState)}</span>
        )}
      </span>
    </li>
  );
}

function seatPhrase(seats: Seat[]): string | null {
  if (seats.length === 0) return null;
  // Census labels already read as seats — "State Senate District 18", "AZ-6" —
  // so they need no noun bolted on, which also sidesteps naming a chamber whose
  // title varies by state.
  const labels = seats.map((s) => s.label);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * One person, with the record behind them one click away.
 *
 * The source link is not decoration. `CLAUDE.md` line 17 allows a name on
 * screen only when it carries a source record, and the transparency surface is
 * what makes that claim checkable rather than merely asserted.
 */
function Holder({
  holder,
  onOpen,
}: {
  holder: SeatHolder;
  onOpen?: () => void;
}) {
  /*
   * ITEM 3 (2026-08-16): THE LIST GOES BACK TO CLEAN.
   *
   * The prior pass gave this row the battlecards' full element grammar — a
   * filled party chip and a "Their site →" link beside every name — and the
   * result was overcrowded, a forever scroll. This card can carry twenty-odd people, and twenty rows each
   * carrying a chip, an outbound link and a source mark is a wall.
   *
   * So the register here is DENSITY, not completeness. Three things per row
   * and nothing else:
   *
   *  • the name, which opens the person's SMALL battlecard;
   *  • the party as PLAIN TEXT in its party colour — never a filled pill on
   *    this surface. The pill belongs on the battlecards, small and large;
   *  • the source mark, where the standing per-surface rules require one.
   *
   * "Their site →" is GONE from every row. External links do not live in the
   * list — they live inside the card the name opens, which is the click
   * grammar for this whole surface: a PERSON opens a person's
   * card, a BODY opens a body's card, and every door out of the product is
   * behind one of those two.
   */
  return (
    <div className="person-row">
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
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {holder.partyLabel && (
          // Display only. Nothing here or downstream infers a position from
          // it. Plain text in the party colour — the pill is banned from
          // this list and lives on the battlecards.
          <span
            className="person-row-party"
            style={
              { color: partyColorVar(holder.partyLabel) } as React.CSSProperties
            }
          >
            {readerPartyLabel(holder.partyLabel)}
          </span>
        )}
        {/*
          **BC-14 (2026-08-25) — the same right-edge source link, on the same
          class of surface, removed for the same reason.**

          RULING 136: the author's id names an instance and the defect is the
          class. The report boxed the small battlecard; this is the who-governs
          card, which carries the identical `· SOURCE` run at the right edge of
          every holder row. Fixing only the row photographed is what the last two
          passes of BC-14 did.

          Of the four `.source-tag` sites, THREE are removed: this one, the
          district popup's, and `official-popup`'s. The first pass of this
          sweep put `official-popup` in the large card on the strength of its
          name and left it standing; it renders into `PopupCard`, so it is a
          small card, and checking rather than assuming is what found it.

          The fourth, `key-votes-section`, is DELIBERATELY LEFT and is a Needs
          Sean row. A roster row is an identity; a vote is a CLAIM about how a
          named person voted, and the no-claim-without-a-source rule attaches
          the source to the claim. Removing that link needs a consolidated
          source line for it to land in, which BC-14 does not specify for
          votes — so it is his call rather than a session's.

          `holder.sourceUrl` is untouched on the record (RULING 138).
        */}
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
  // Stacked, not comma-joined. Two representatives for one Arizona state
  // house district read as one hyphenated name when they were run together
  // in a right-aligned column.
  return (
    <>
      {holders.map((holder) => (
        <Holder
          key={holder.id}
          holder={holder}
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
 * The four states of 4.6.6, in the reader's words.
 *
 * The third row is the one that matters and the one that was missing: a body is
 * known to exist and nothing has its calendar. Saying "no meetings" there is
 * false — it describes us, not them.
 */
function CoverageBody({
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
  zip: string;
  coverage: CoverageSummary;
  failedSourceOcdIds?: string[];
  /** F01 7.2: which of those bodies has rows on screen anyway. */
  ocdIdsWithMeetings?: string[];
  /** When the meetings snapshot was last refreshed, for the per-body notes. */
  lastCheckedAt?: string | null;
  lastReadByOcdId?: Readonly<Record<string, DivisionRead>>;
  onOpenOfficial?: OpenOfficial;
  onOpenBody?: (body: CoveredBody) => void;
  /** WGH-5: the reader settled their address, on any surface. */
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

  /*
   * **WGH-12/13/14 (2026-08-28): THE ADDRESS THE READER ALREADY GAVE.**
   *
   * `lib/geo/session-address.ts` has stored the confirmed divisions since
   * 2026-08-22 and, until that sweep, NOTHING read it back — the component that
   * writes it was its only consumer, and `onNarrowApplied` in the map shell
   * discards the same divisions a second time. So this card went on answering
   * from the zip centroid while the prompt three lines above it displayed the
   * address's own answer: "Set to ... State House District 17" over a STATE
   * section reading District 19.
   *
   * It stays on the DEVICE — see the module note in
   * `lib/state/resolved-location.ts` for why the repair is client-side and that
   * is deliberate rather than expedient.
   *
   * **WGH-15 (2026-08-28): and it is now an EXPLICIT SUBJECT.** This card
   * answers *who governs the place the reader told us about*. The district
   * popup answers *what is this thing I tapped*. Both were true and neither
   * said so, which is the whole of the reported contradiction. Declared here,
   * once, so every list below reasons from one named subject rather than three
   * of them reaching for the zip independently.
   */
  const resolvedLocation = useResolvedLocation(zip);
  const subject = homeSubject(resolvedLocation);

  /*
   * **WGH-15 (2026-08-28) — THE STATE SECTION IS THE SURFACE IN THE BUG REPORT,
   * AND IT NEVER WENT THROUGH `applyResolvedLocation` AT ALL.**
   *
   * `bodies` was annotated on 2026-08-28. `seats` was not, and the STATE
   * section renders `seats` — so the exact rows the reader photographed, *State
   * House District 19 · Gail Griffin, Lupe Diaz* sitting under a prompt reading
   * *District 17*, were the one list on this card that never asked.
   *
   * `standingOf` would have returned `ELSEWHERE_IN_ZIP` for `sldl:19` against
   * an `sldl:17` address from the day it shipped —
   * `tests/resolved-location.test.ts` asserts exactly that pair. **No seat row
   * ever asked it.** Same class as WGH-12/13/14 (*correct, and had zero
   * consumers*), one level down, which is why the seats are routed here rather
   * than the sldl case being special-cased.
   *
   * `Seat` satisfies `BodyLike` structurally — an `ocdId` and nothing else is
   * required — so this is the SAME function over the SAME location, not a
   * second implementation of the standing rule for a second row type.
   *
   * The 8/28 reading of that was *annotate, never drop*. RULING 222 settled it
   * the other way on 2026-08-31 — see below.
   */
  /*
   * **WGH-22 (2026-08-31) — THE READER'S OWN DISTRICTS, ASKED FOR BY KEY.**
   *
   * The 8/30 cut tried to add the reader's missing districts from
   * `coverage.divisions`. It could not: `summarizeCoverage` derives
   * `coverage.seats` from `coverage.divisions` by filtering to the seat types,
   * so at those levels the two lists are one list. Measured against production
   * at 85641 with a real address confirmed, the State section rendered
   * EMPTY — District 19 correctly set aside, District 17 still absent.
   *
   * The only list that carries District 17 is the reader's own confirmed
   * divisions, on their device. It carries ids and nothing else, so the name
   * and the roster are asked for by division key —
   * `hooks/use-confirmed-divisions.ts`, the same route the district battlecard
   * has used since M112 — and injected into the pure splitter as rows.
   */
  const stateConfirmed = useConfirmedDivisions(coverage, subject.location, STATE_SEAT_TYPES);
  const federalConfirmed = useConfirmedDivisions(
    coverage,
    subject.location,
    FEDERAL_SEAT_TYPES,
  );

  // Item 2c (2026-08-14 second session): officials group under three
  // headers, closest-first — Local, State, Federal. The state seats and
  // the federal seat split by division type (structure, never a label
  // match); the governor (2b) rides under STATE after the legislators —
  // order of scope, district before statewide.
  /*
   * `panelSeatsFor` returns the reader's own rows and — separately, never
   * rendered — the ones the address ruled out. Without an address it returns
   * exactly what this line used to: the whole zip, one list. `UNSETTLED` is
   * not `ELSEWHERE_IN_ZIP`, and a reader who gave only a zip gets no partition
   * invented for them.
   */
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
  const federalSeats = federalPanel.yours;
  const stateLegislatorGaps = stateLegislatorAuthorities.flatMap((authority) => {
    const text = stateLegislatorCoverageGapText(authority);
    return text === null ? [] : [{ authority, text }];
  });

  /*
   * The reader's device-local narrowing (M26): where they picked their
   * municipality or school district, bodies of that TYPE narrow to the
   * choice; every other type stays fully listed. The choice never leaves
   * the device — see hooks/use-narrowing.ts.
   */
  const narrowing = useNarrowing(zip);
  const selected = new Set(narrowing.divisions);

  /*
   * The same subject the seats above were annotated against. One location, one
   * question, every list on this card.
   *
   * **RULING 222**: `scopedToAddress`, not `applyResolvedLocation`. The LOCAL
   * list is ZIP-scoped exactly as the seat lists are, and a municipality or a
   * county the reader's own address has ruled out is out of scope here for the
   * same reason District 19 is out of scope there. It drops only
   * `ELSEWHERE_IN_ZIP`; the overlapping levels most of these rows sit at are
   * untouched, and every count on this card is derived from THIS array, so the
   * stated N and the rendered rows cannot disagree about it.
   */
  const bodiesHere = scopedToAddress(bodies, subject.location);

  /*
   * ITEM 1a (2026-08-17): ONE DENOMINATOR.
   *
   * Production at 85701 read "4 bodies govern the area around 85701" above a
   * disclosure reading "Why these 5?" above 5 rows. Three numbers, one list.
   *
   * The cause was two definitions on one surface, and the brief's named
   * suspect was half right. The prose read the SERVER's `counts.governing`
   * (bodies whose class is GOVERNING — 4 at 85701). The rows were the first
   * `NAME_LIMIT` of ALL bodies, governing and not. The row that moved between
   * them was NOT the Public Housing Authority board — that board IS classed
   * GOVERNING and is inside the 4. It was the Board of Adjustment, a
   * COMMISSION, sitting fifth in a list cut from the 60-body array.
   *
   * A second, latent instance of the same defect sat underneath it and would
   * have survived any fix that only re-pointed the prose at a server count:
   * the reader's device-local narrowing (M26) shrinks the RENDERED list on the
   * client, while `counts.governing` is computed on the server and cannot see
   * it. A reader who narrowed to one school district would have re-opened the
   * gap by hand.
   *
   * So every number below is derived from ONE array, after narrowing, in the
   * component that renders it. Prose N, disclosure N and rendered row count
   * are the same expression — they cannot disagree, at any zip, for any
   * reader, regardless of how many bodies the registry grows.
   *
   * Both definitions are real and both are needed — 50 Tucson advisory
   * committees must never read as 50 governments (D29) — so BOTH are said on
   * screen in plain language: the governments in the list, the boards and
   * committees in their own sentence below it.
   */
  const derived = deriveWhoGoverns(bodiesHere, selected);
  const shown = derived.rows;
  // The per-body source notes spell out the snapshot's last-refresh date through
  // the product's one formatter (RULING 258); "" when we cannot say, so the
  // sentence stands without a date rather than inventing one.
  const lastCheckedLong = formatDateLong(lastCheckedAt);
  const lastCheckedClause = lastCheckedLong ? `, ${lastCheckedLong}` : "";
  /*
   * The governing list is NOT cut. A cut would put the prose count and the row
   * count back into disagreement the moment a zip had more governments than the
   * limit — an invariant that holds only because of today's data is not an
   * invariant. A reader is governed by a handful of governments; the card
   * scrolls (4f) if that is ever untrue.
   */
  const seatLine = seatPhrase(seats);
  const kind = leadKind(coverage);
  const g = { total: derived.governingCount, withSource: derived.governingWithSource };
  const others = derived.others;
  const othersWithSource = derived.othersWithSource;

  const lead =
    kind === "unmapped" ? (
      <>
        <WorkingOnIt inline about={zip} />
      </>
    ) : kind === "none-scheduled" ? (
      <>
        Nothing is scheduled for the{" "}
        {counts.total === 1 ? "body" : `${counts.total} bodies`} covering {zip}.
      </>
    ) : kind === "meetings-missing-calendars" ? (
      // Meetings are on screen, but not from every government's calendar.
      // Leads with what we have (2j — the inversion rule): the failure frame
      // "we're missing X" buried the fact that most calendars are watched.
      // The numbers stay honest and computed; only the frame changed.
      g.withSource === 0 ? (
        // Zero tracked is not a lead-with-what-we-have case; say it straight.
        <>
          {g.total === 1
            ? "One body governs the area around "
            : `${g.total} bodies govern the area around `}
          {zip}.{" "}
          <WorkingOnIt inline about={g.total === 1 ? "its calendar" : "their calendars"} />
        </>
      ) : (
        <>
          We track the {g.withSource === 1 ? "calendar" : "calendars"} of{" "}
          {g.withSource} of the {g.total} bodies that govern the area around{" "}
          {zip}.{" "}
          <WorkingOnIt inline about={g.total - g.withSource === 1 ? "the other calendar" : `the other ${g.total - g.withSource} calendars`} />
        </>
      )
    ) : kind === "all-wired" ? (
      // The state the old notice had no words for: every government here is
      // on our watch. Said plainly, because the list below is the reader's
      // answer to "who governs me" and deserves an opening line.
      <>
        {g.total === 1 ? "One body governs" : `${g.total} bodies govern`} the
        area around {zip}. We watch{" "}
        {g.total === 1 ? "its calendar" : "all of their calendars"}.
      </>
    ) : (
      <>
        {g.total === 1 ? "One body governs" : `${g.total} bodies govern`} the
        area around {zip}.{" "}
        {g.withSource > 0 && <>We track {g.withSource} calendars. </>}
        <WorkingOnIt inline about={g.total - g.withSource === 1 ? "the remaining calendar" : "the remaining calendars"} />
      </>
    );

  // The advisory boards, committees and commissions, stated apart from the
  // governments — real bodies a reader can follow, not extra governments.
  // Leads with what is tracked (2j): "56 more boards ... we watch 5" read as
  // failure when it describes a live, growing watch list. Numbers stay
  // honest and computed; only the frame changed.
  const othersLine =
    kind !== "unmapped" && others > 0 ? (
      othersWithSource > 0 ? (
        <>
          We also track{" "}
          {othersWithSource === others
            ? `all ${others === 1 ? "" : others + " "}of the area's other board, committee and commission calendars`
            : `${othersWithSource} more board and committee ${othersWithSource === 1 ? "calendar" : "calendars"} here`}
          .
          {othersWithSource < others &&
            <WorkingOnIt inline about={`${others - othersWithSource} more calendars`} />}
        </>
      ) : (
        <>
          {others} more boards, committees and commissions serve the area. {" "}
          <WorkingOnIt inline about="their calendars" />
        </>
      )
    ) : null;

  return (
    <>
      {unincorporated && (
        // The no-mayor case is a stated fact, not an empty slot (5b): say
        // what this place has instead of what it lacks.
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

      {/* The app's voice (design pass): coverage explanation is guidance,
          not record — it renders in the voice register. */}
      <p className="mt-1.5 t-body leading-relaxed text-voice">
        {lead}
      </p>

      {/* What Meanwhile holds for this ZIP, level by level, so a blank reads as
          "not collected yet" and never as "nothing here". Counts come from the
          same arrays the sections below render. */}
      <p className="mt-1 t-detail leading-relaxed text-voice" data-mw-covers>
        <strong className="font-semibold text-voice">What Meanwhile has for {zip}:</strong>{" "}
        {[
          seats.some((seat) => seat.tier === "national" && seat.representatives.length > 0) || senators.length > 0
            ? "your federal representatives and senators"
            : "federal officials not collected yet",
          seats.some((seat) => seat.tier === "state" && seat.representatives.length > 0) || statewideExecutives.length > 0
            ? "state officials"
            : "state officials not collected yet",
          g.total === 0
            ? "local bodies not mapped yet"
            : `${g.total} local ${g.total === 1 ? "body" : "bodies"}${g.withSource > 0 ? `, with ${g.withSource === 1 ? "one calendar" : `${g.withSource} calendars`}` : ", calendars not collected yet"}`,
        ].join(" · ")}
        .
      </p>

      {/* WGH-15: which question this card answers, said once, at the top. */}
      <SubjectLine zip={zip} standing={subject.location.certainty} />

      {/*
        **RULING 222 (2026-08-31) — THE COUNTING SENTENCE IS GONE WITH THE
        ROWS IT COUNTED.**

        A line stood here reading "N of these govern a different part of
        85641 than your address, and they are marked below." It was written
        for WGH-15 when those rows were rendered and annotated. They are not
        rendered any more — scopedToAddress drops them before this list is
        built — so the sentence would be describing rows that are not there,
        which is a surface asserting something its own contents contradict:
        the WGH-19 / WGH-21 / MAP-5 class, on a fourth surface.

        Nothing replaces it. "We hold N more you cannot see" is a claim about
        our collection dressed as a claim about the reader's government, and
        the ZIP-scoped view is one tap away — clearing the address restores it
        in full, which is where completeness is owed.

        deriveWhoGoverns still COUNTS the excluded rows; it is a derivation
        over an annotated list and tests/resolved-location.test.ts reads it.
        What is gone is the render.
      */}

      {othersLine && (
        <p className="mt-1 t-detail leading-relaxed text-voice">
          {othersLine}
        </p>
      )}

      {/*
        **WGH-18 (2026-08-30) — "SEE THE REST", AND IT OPENS IN PLACE.**

        The sentence above states how many boards, committees and commissions
        we track here. Until now that was the end of it: reaching one meant
        closing this panel, opening the sidebar, and clicking Bodies here.
        A reader had no way to find out which ones they were.

        A number a reader cannot open is a panel describing contents it does
        not show — the same defect as WGH-19's completeness claim, one step
        earlier. The count in the label is `derived.otherRows.length` and the
        rows are `derived.otherRows`, so the label cannot state a number the
        list does not contain.

        Collapsed by default (the same rule for long content as MTG-5,
        BAL-8, BAL-16, ASK-21), and each row opens the same battlecard the
        governing rows open — a board is a real body a reader can follow.
      */}
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
        // Structural label (design pass): organizes, confident, with its
        // shelf rule — never smaller than the names it organizes.
        <p className="t-structure mt-3 text-local">Local</p>
      )}
      {/*
        6g (2026-08-15): "Why these five?" — the top list surfaces
        a Board of Adjustment beside a county, a city and a school district,
        and nothing on the surface says why those and not others.

        One honest sentence about the SELECTION, and deliberately not a new
        ranking: the list is the bodies whose calendars this product watches
        here, in the order the coverage summary returns them, cut at five with
        the remainder counted below. There is no scoring, no importance
        judgement, and no ordering by anything a reader could mistake for one.
        Saying so is cheaper than being asked.
      */}
      {/*
        ITEM 1a (2026-08-17): the disclosure renders whenever there are rows,
        not only when something is hidden. Its number is `shown.length` — the
        same expression the lead sentence counts and the same rows the list
        renders — so the walk's three-way equality holds by construction.

        The question it answers has changed with the list. It used to be "why
        these five of sixty"; the list is now exactly the governments, so the
        honest question is what makes something a government here and where the
        boards and committees went.
      */}
      {shown.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer t-caption text-link">
            Why these {shown.length}?
          </summary>
          {/*
            **WGH-19 (2026-08-30) — A TRUE SENTENCE THAT READS AS A FALSE ONE.**

            This said *"All of them are listed; none is left out."* Read
            against its own subject — the GOVERNMENTS — it was true, and the
            following sentence separated boards and committees out explicitly.
            Beside a sidebar reading 65 bodies here, it read as factually
            wrong and grammatically poor, and that reading is fair: a claim of
            completeness sitting above eight rows, on a panel that elsewhere
            says twenty-seven more calendars are tracked and thirty more
            bodies are being added, cannot be parsed as narrowly as it was
            written.

            So the completeness claim goes and the SCOPE claim stays. What is
            on the list is now said by naming the criterion — boundaries cover
            this area, and this is a government rather than a board — which is
            the fact we can source, in place of a "nothing was omitted" that
            invites the reader to check it against a bigger number on the same
            screen and find it wanting.

            The neutrality sentence changes with it. WGH-17 orders these rows
            by governmental layer, so *"nothing here is ordered"* would become
            the next false self-description. The order and its criterion are
            stated instead: county, municipality, school district, then the
            rest — a structural fact about governments, never a judgment about
            them, which is what `CLAUDE.md`'s neutral-criterion rule requires
            of any ordering that reaches a reader.
          */}
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
              /*
               * ITEM 1a (2026-08-17): an explicit hook for the permanent walk
               * check that counts rendered government rows against the two
               * numbers the card states. The check used to have to infer a
               * row from a Tailwind class, and a class is a styling decision
               * — the next design pass would have silently disarmed the guard
               * that exists because this list once disagreed with itself.
               */
              data-governing-row=""
              className="flex items-baseline justify-between gap-3 pb-1"
            >
              {/*
                ITEM 3 (2026-08-16): A BODY ROW OPENS ITS
                LARGE BATTLECARD. It used to be an outbound link straight to
                the body's own website — Pima and Tucson threw the reader out
                of the product from the list, before they had been told
                anything about the body at all. The official site is still
                one tap away; it is inside the card now, with the roster, the
                sittings and the sources, which is where every external door
                on this surface lives.

                Still the division label and never an invented name: Body.name
                is null on derived rows, and the text is Census's.
              */}
              {/*
                **WGH-11 (2026-08-25) — THE MARK SITS AGAINST THE WORD IT
                ANNOTATES, so it is inside the NAME's flex item.**

                It used to be the row's own second child. The row is
                `justify-between` with three children, so the asterisk was
                distributed into the dead space between the body name and the
                right-aligned type label — screenshot `17-30-58` shows the
                marks on `Rockaway township`, `Denville township` and
                `Rockaway` floating a third of the way across the panel, nowhere
                near the words they belong to.

                **The asterisk itself is fine** — the defect is the
                placement, not the mark, which is why this moves it rather than
                taking the RULING 138 route and removing it. `.could-govern-mark`
                already carried `display: inline; margin-left: 3px`, which was
                doing exactly nothing while the element was a flex ITEM: flex
                blows away `display: inline` on its children, and a 3px margin
                is invisible against a `justify-between` gap. Wrapping is the
                whole fix; the mark's own CSS was right all along.
              */}
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
                {/*
                  RULING 71 (NJ Hunt 3, 2026-08-22). This card's heading is "Who
                  governs here", and at a zip that crosses a municipal line it had
                  no way to say that two of eight bodies govern everyone and six
                  govern some readers and not others. The pill says which.

                  Only bodies whose territory covers PART of the zip carry it, and
                  only when the reader TYPED a zip — a panned viewport names no
                  place, so `couldGovern` is absent and nothing renders.

                  It is an INVITATION, not a disclosure of our incompleteness: we
                  hold Rockaway Borough's government and Rockaway Township's, both
                  in full, and what is unsettled is which is the reader's. RULING
                  44 is not weakened; see components/ballot/jurisdiction-note.tsx.
                */}
                {body.couldGovern && (
                  <CouldGovernMark jurisdiction={bodyDisplayName(body)} />
                )}
                {/*
                  RULING 222: there is no exclusion mark here any more. A body
                  the reader's own address settled AGAINST never reaches this
                  list — `scopedToAddress` drops it upstream — so there is no
                  row for a "not yours" sentence to sit on, which is the whole
                  point of the ruling.
                */}
                {/*
                  WGH-16: the weaker case, which is the COMMON one on this
                  list. Municipal and school-district rows sit at levels that
                  overlap, so the exclusion is unreachable for them and this is
                  the mark they get instead. The seat lists further down
                  carry only `sldl`, `sldu` and `cd` — all measured exclusive —
                  so this mark is deliberately not repeated there: it could never
                  fire, and a branch that cannot fire is a branch a later reader
                  has to disprove.
                */}
                {marksOverlap(body.standing) && <OverlapMark zip={zip} />}
              </span>
              <span
                className={`trailing-space-trimmed shrink-0 font-mono t-caption uppercase tracking-[0.15em] ${TYPE_LABEL_CLASS}`}
              >
                {/* A derived row is the division's government and tags by
                    division type. A curated row tags by what it is — the PHA
                    board tagged "Municipal" would claim a second city
                    government, and a commission isn't a government at all. */}
                {/* NH94: a body with NO division has no division noun, and
                    "Municipal" was the placeholder that used to appear there —
                    a claim about what kind of government it is, made by a
                    default. It renders its body class instead, which is a fact
                    about the body rather than a guess about its division. */}
                {body.name === null && body.divisionType !== null
                  ? DIVISION_NOUN[body.divisionType]
                  : BODY_CLASS_NOUN(body.bodyClass)}
              </span>
            </li>
          ))}
          {/*
            ITEM 6 (2026-08-17): THE MAYOR ROW IS GONE
            FROM THIS PANEL, everywhere it appeared, no exceptions.

            3e (2026-08-16) put it here because 85701 showed Tucson's
            government without its highest-profile office. But the placement
            is awkward and the office already renders in
            the battlecard's Representation tab, which it does.

            **Reachability after removal, checked against the committed
            rosters rather than assumed — no zip loses the office:**

              85701  Mayor Regina Romero, on the City of Tucson roster.
                     Reachable: the Tucson row opens its large battlecard →
                     Representation tab. Also on Tucson meeting cards.
              85641  No mayor EXISTS — Vail is unincorporated, and the card
                     says so in its own first line ("This area isn't a city or
                     town — it has no mayor or city council"). Nothing lost.
              07866  Mayor Joseph Jackson, on the Rockaway township roster.
                     Same path: the township row → Representation tab.
              03255  No mayor exists; Newbury is run by a Selectboard.

            **The no-mayor FACT is not this row and survives untouched.**
            Newbury's select-board fact and explainer (M32) is the separate
            block immediately below, keyed on the office title rather than on
            "Mayor", so removing the Mayor filter does not reach it. It still
            renders on the who-governs card at 03255, with the three
            Selectboard members under it — which is the point: the statement
            is about how the town IS governed, not about what it lacks.
          */}
          {/* 2e (2026-08-17): the no-mayor town, stated as what it HAS. A
              New England town run by a Select Board gets the fact named and
              its members shown — the people filling the substitute role
              matter exactly as much as a mayor would. Same pattern anywhere
              the expected office doesn't exist. */}
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
          {/*
            ITEM 1a (2026-08-17): the "and N more" row is GONE, and the reason
            matters more than the row.

            It was a bare `<li>` of static text — no link, no button, no
            handler. Once the list above became exactly the governments, that
            row said "and 56 more boards and committees" directly beneath a
            sentence that already reads "We also track 5 more board and
            committee calendars here. 51 more bodies are being added." Same
            set, same number, twice, four lines apart. A duplicate message is a
            defect with the same standing as a wrong number.

            **A note for item 4b, which is deferred (G05).** The g6 brief keeps
            this row on the reasoning that "removing 'and 55 more' makes 55
            bodies unreachable from the surface whose job is coverage." That
            premise does not hold: the row was never an affordance and led
            nowhere, so it made nothing reachable and removing it makes nothing
            unreachable. The reachability concern is REAL and is now stated
            plainly rather than answered by an element that only looked like an
            answer — those bodies are counted in the sentence above and in the
            "Why these N?" disclosure, and neither opens them either. Building
            a way in is item 4b's to rule on, with the false premise removed.
          */}
        </ul>
      )}

      {/*
        WGH-1 and WGH-2 (2026-08-22): ONE pill for the whole panel, between
        the Local listing and the State listing. Every affected row above carries an asterisk and nothing more.

        What was here before: the full sentence "Could govern — add your
        address to confirm" on EVERY affected row. At 12 bodies that was
        noise; the registry now holds 174, and the repetition is what made the
        product look like it was ballparking. The old pill was also DEAD —
        clicking it did nothing. This one opens the address prompt.
      */}
      <CouldGovernNotice
        zip={zip}
        count={shown.filter((body) => body.couldGovern === true).length}
        onResolved={onAddressResolved}
        onCleared={onAddressCleared}
      />

      {/*
        G05 RULE 4b (2026-08-17): three things left this position.

        The rule: *"WGH contains exactly: the Ballot/zip+Ask pill cluster, the
        explainer of the bodies that govern the area, then Local/State/Federal.
        Remove What's on the ballot from the panel. The Who do I talk to about
        box does not render by default."*

        * The **ask box** is gone from here entirely. It is not hidden and it
          is not duplicated: there is now exactly one ask input in the product
          and it lives in the pill cluster's expansion, which renders at the
          TOP of this card whenever this card is the open surface (4e). "Does
          not render by default" is literally true — the pill is closed until
          the reader taps it.
        * The **narrowing prompt** and the **Moving here** link move to AFTER
          Local/State/Federal, which is where G05's own preserve-and-report
          clause puts the things this rule keeps. The narrowing prompt keeps
          every property CLAUDE.md's second load-bearing friction requires:
          declining stays the effortless default, and moving it changes only
          where it sits, never how easy it is to ignore.
      */}

      {/*
        D17, split 2026-08-13. The statutory sentence — New Hampshire does not
        require an agenda — is a fact about the law and renders for every NH
        body here. The diligence sentence ("we searched high and low") is a
        claim about our work and renders only for a hunt the audit records as
        exhausted, so the statute can never explain away a body nobody has
        searched.
      */}
      {/*
        The snapshot's per-source failure, attributed to the bodies it serves.
        Without this, a source that was unreachable this morning renders its
        bodies exactly like bodies with nothing scheduled — a gap of ours
        presented as a fact about their government.
      */}
      {/* F01 7.2 (2026-08-19), rewritten 2026-09-14 — TWO FACTS, in plain
          language and dated, never "couldn't reach" and never an adapter id
          (RULING 254: no verdict on ourselves; RULING 258: reader-plain, dated
          through the one formatter).

          A body whose calendar page did not answer at the last refresh is one of
          two cases. If it has listings on screen, they were carried from before,
          so the fact is "what's shown is older". If it has none, its meetings may
          genuinely be missing here. Two different facts; each says its own, and
          neither reads as "nothing is scheduled". */}
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

      {/* 2026-09-24 — the calendar READ date, per division, when it is old.
          "Last checked" in the footer is the newest read anywhere; a division
          whose own calendar has not been read for a day and a half says so,
          dated, as a fact about our read and never as a verdict on the body. */}
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

      {collapseFootnotes(shown, (body) =>
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

      {seats.length > 0 && seatCounts.named === 0 ? (
        // Nothing sourced for any seat — the original wording, still true.
        <p className="mt-2.5 t-detail leading-relaxed text-voice">
          You&apos;re also represented in {seatLine}.
        </p>
      ) : (
        <>
          {/* Item 2c: STATE — legislators first (district scope), then the
              governor (2b, statewide scope). Item 2b's honesty line: the
              governor is the only statewide office listed, said rather
              than implied complete. */}
          {(stateSeats.length > 0 || statewideExecutives.length > 0) && (
            <>
              <p className="t-structure mt-4 text-state">
                State
              </p>
              <ul className="mt-1 space-y-1">
                {/* THE REPORTED ROWS. After a confirmed address this list is
                    the reader's own districts — District 17 at 85641 — and
                    the ones their address ruled out are not on it. */}
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
              {/*
                * **WGH-21 (2026-08-30) — THE LINE THAT CONTRADICTED THE LIST
                * DIRECTLY ABOVE IT.**
                *
                * This rendered *"The governor is the only statewide office
                * listed so far"* whenever `statewideExecutives.length > 0`.
                * It was written when the slate held one person and it was
                * true then. It was never re-derived, so when the slate
                * populated the panel printed nine statewide officeholders by
                * name and party — Mayes, Yee, Horne, Presmyk and five
                * corporation commissioners — and then said the governor was
                * the only one.
                *
                * It is not stale. It is FALSE about content rendered inches
                * above it, and the governor is not even the nearest entry.
                *
                * The line is gone rather than corrected: the contents are
                * right, so the line is the thing that goes. Nothing replaces it, because the only
                * replacement would be a completeness claim — *these are all
                * the statewide offices* — and we hold no source for the
                * denominator of statewide offices. Asserting it would be the
                * manufactured claim `CLAUDE.md` forbids, and the product does
                * not announce its own failure either (RULING 139). No claim
                * beats a false one and beats an invented one.
                *
                * The CLASS, which is the part that matters: a surface
                * asserting something about ITSELF from a hardcoded string
                * that its own rendered contents can contradict. WGH-19 and
                * MAP-5 in this same report are the same defect on other
                * surfaces. `tests/self-description.test.ts` is the guard.
                */}
            </>
          )}

          {/* Item 2c: FEDERAL — the House member (district scope) before
              the senators (statewide). "Federal", never "National": it
              matches every ballot and source the app cites. */}
          {(federalSeats.length > 0 || senators.length > 0) && (
            <>
              <p className="t-structure mt-4 text-national">
                Federal
              </p>
              <ul className="mt-1 space-y-1">
                {/* Same rule at the federal level. A zip that crosses a
                    congressional line is rarer, not different — and it is the
                    same component, so it cannot be treated differently. */}
                {federalSeats.map((seat) => (
                  <SeatRow
                    key={seat.ocdId}
                    seat={seat}
                    zip={zip}
                    onOpenOfficial={onOpenOfficial}
                  />
                ))}
                {/*
                  ALIGN-2 (2026-08-26, the 8/26 walkthrough). This
                  used to map over PEOPLE and emit a heading per person, so
                  every Arizona zip printed `U.S. Senator` twice — once above
                  Mark Kelly and once above Ruben Gallego.

                  RULING 136: the senators are the EXAMPLE. The grouping is in
                  `lib/officials/seat-grouping.ts` so that every multi-seat
                  body — a two-member state house district, five county
                  supervisors, a multi-member school board — gets one heading
                  and a list, rather than the Senate getting a special case.

                  The callback still receives the SINGULAR office title. A
                  person holds `U.S. Senator`; the plural is a heading over a
                  list and is not anybody's job.
                */}
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

          {/*
            **RULING 222 (2026-08-31) — THE DISCLOSURE IS GONE.**

            A collapsed <details> stood here listing the districts the
            reader's address ruled out, under the reading that RULING 26/27
            forbade dropping them. That reading is settled now: after a
            confirmed address the scope IS the address, and an entity we have
            determined does not govern this reader is out of scope rather than
            disclosed. Show-everything guarantees completeness WITHIN the
            correct scope; it never licensed carrying another district's
            representatives on the panel a reader reads as theirs.

            The rows are still computed — panelSeatsFor().excluded — so a
            check can assert they were DROPPED rather than never found, and
            tests/address-scope.test.ts asserts exactly that.
          */}
        </>
      )}

      {stateLegislatorGaps.map(({ authority, text }) => (
        <p
          key={`state-legislator-authority:${authority.scope}`}
          data-state-legislator-authority={authority.kind}
          data-state-legislator-scope={authority.scope}
          className={`mt-2.5 t-caption leading-relaxed ${
            authority.kind === "STORE_UNREACHABLE" ? "text-signal" : "text-voice"
          }`}
        >
          {text}
        </p>
      ))}

      {(bodies.some(
        (b) =>
          b.name === null &&
          b.coverageStatus !== "LIVE" &&
          b.coverageStatus !== "MANUAL",
      ) ||
        seatCounts.named < seatCounts.total) && (
        // The honest footnote, now narrowed to what is still unsourced. It used
        // to claim we had sourced no names at all, which stopped being true the
        // moment the federal roster landed — AZ-6 has a name on it. Claiming
        // otherwise beside a rendered name is its own small lie.
        <p className="mt-2.5 t-caption leading-relaxed text-voice">
          {counts.withoutSource > 0 && (
            <>
              We know these bodies exist because the district boundaries do. We
              haven&apos;t collected their names or meeting schedules yet, and
              finding them is open work. This list fills in as we do.
            </>
          )}
          {counts.withoutSource > 0 && seatCounts.named < seatCounts.total && " "}
          {seatCounts.named < seatCounts.total && (
            <>
              {seatCounts.named > 0 && stateLegislatorGaps.length === 0
                ? "State legislators aren't sourced yet either."
                : ""}
            </>
          )}
        </p>
      )}

      {/*
        4b's preserve-and-report tail: the two affordances the rule KEEPS,
        placed after Local/State/Federal exactly as G05 words it. Neither is a
        new element and neither changed — only where they sit.

        WGH-3 and WGH-4 (2026-08-22): "Narrow to this area?" used to expand into
        a pitch — *"07866 covers 4 municipalities and 3 school districts. Do you
        want to narrow it?"* — with a municipality picker and its own street
        input, and it was the SECOND implementation of the address feature on a
        screen that already had one. Both are gone. This is the same component
        the pill above opens and the ballot page uses: street only, and a house
        number only when the reader's own street crosses a line.
      */}
      {/*
        **WGH-7 (2026-08-24) — DELETED, AND THIS IS WHAT
        CLOSES WGH-3 AND WGH-4 RATHER THAN MERGING THEM.**

        The "Narrow this area" link under the federal representatives is
        deleted: the pill is the single entry point.

        That pill is `CouldGovernNotice`, above the Local list, which
        has opened this exact `AddressPrompt` since 2026-08-22. So the card was
        carrying TWO doors onto one surface — the duplicate-entry friction
        `CLAUDE.md` names — separated by the whole Local/State/Federal list, so
        a reader who took the second one had scrolled past the first.

        WGH-3 and WGH-4 removed a SECOND IMPLEMENTATION of the address feature
        and left one component in two places. This removes the second PLACE. It
        is a deletion rather than a merge because there is nothing here the pill
        does not already do: same component, same zip, same handlers.

        **What is NOT lost.** `onNarrowApplied` fired from here to tell the map
        to shade its boundaries, and the pill's own `onAddressResolved` path
        reaches the same handler in `map-entry` — the shading follows the
        RESOLUTION, not the control that asked for it.
      */}

      {/* 7 (2026-08-17): the mover's page, one tap from who-governs. */}
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
  tier,
  zip,
  radiusKm,
  requestedRadiusKm,
  count,
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
  // Item 1 (2026-08-15): a press outside minimizes the card, the way a native
  // sheet does. It MINIMIZES rather than closing — the card's collapsed form
  // is its corner bubble, and there is no state in which it is gone, so the
  // gesture lands the reader exactly where the explicit control does.
  //
  // Declared before the early return below so the hook order is stable; the
  // hook itself no-ops when `onMinimize` is absent.
  useDismissOnOutside(rootRef, onMinimize ?? (() => {}), Boolean(onMinimize));

  // The notice renders on every failure rung, and on the exact rung whenever
  // there is representation to show. It used to return null on `exact`
  // outright — and since this is the only surface that renders who governs
  // and represents a point, the composite making every zip exact silently
  // deleted the officials from the product. The gate now lives in
  // lib/registry/representation.ts, where a test holds it against the
  // committed rosters.
  if (!shouldRenderNotice(tier, coverage)) return null;

  const near = formatMiles(requestedRadiusKm);
  const wide = formatMiles(radiusKm);

  const isEmpty = tier === "none";
  const label = noticeLabel(tier, coverage);

  // Amber marks the rungs where something needs explaining. "Who governs
  // here" on the exact rung is information, not an alert, so it stays quiet.
  const accent =
    tier === "concluded"
      ? "text-concluded"
      : tier === "exact"
        ? "text-muted"
        : "text-signal";

  // The ballot entry travels with the zip the card is already about, so the
  // click never re-asks for something the app knows.
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
        // The explicit way out (3) — engagement still collapses it, but the
        // reader shouldn't have to know that.
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
      {/* Pinned: the header never scrolls with the body, so the ballot entry
          below it cannot be scrolled away. */}
      <div className="coverage-notice-head">
        <p
          className={`font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] ${accent}`}
        >
          {label}
        </p>

        {/*
          G05 RULE 4b: *"Remove What's on the ballot from the panel."*

          The tester's 2026-08-14 finding is the reason this entry existed and
          it is NOT being reversed. Her words — the floater never appeared on
          her phone, and "I don't think I would have found that without knowing
          it existed" — were about REACHABILITY, and reachability is now better
          than the link she was rescued with: the pill cluster renders at the
          top of this card whenever this card is the open surface (4e), pinned
          outside the scroll exactly as this link was, carrying the ballot pill
          AND the zip it is about. What is removed is the DUPLICATE, not the
          door. A reader who cannot reach the ballot does not have it, and this
          card still reaches it in one tap at the same place on the screen.

          The fallback below is not a second door. It renders only when the
          cluster is somewhere else — the frame before the breakpoint is read,
          or a card with no resolved zip — so the count on screen is always
          exactly one.
        */}
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
      {tier === "widened" && (
        <p className="mt-1.5 t-body leading-relaxed text-paper-dim">
          Nearby results: {listingCount?.unresolved ? `${count} ${listingCount.unit}` : count === 1 ? "one meeting" : `${count} meetings`} within {wide} miles of {zip}.

        </p>
      )}

      {result?.readerScope?.governments && result.readerScope.governments.length > 0 && (
        <section className="mt-3" aria-label="Upcoming meetings of the place’s governments" data-place-government-meetings>
          <h3 className="t-heading text-paper">Governments at this place</h3>
          <ul className="mt-2 space-y-2">
            {result.readerScope.governments.map(body => <li key={body.bodyId} data-upcoming-body={body.bodyId}>
              <span className="t-body text-paper">{body.name}</span>
              {body.upcoming > 0 ? <p className="t-detail text-muted">{body.upcoming} upcoming {body.upcoming === 1 ? "meeting" : "meetings"} held · {body.agendasLinked} {body.agendasLinked === 1 ? "agenda" : "agendas"} linked</p>
                : <WorkingOnIt subject={{ type: "BODY", id: body.bodyId }} />}
            </li>)}
          </ul>
        </section>
      )}
      {tier === "concluded" && <p className="mt-2 t-body text-paper-dim">Concluded meetings within {wide} miles of {zip}.</p>}

      {/*
        The coverage block rides *alongside* the cascade's explanation rather
        than replacing it, because the widened rung is where it matters most: a
        reader in Vail is shown fourteen meetings from thirty-seven miles away,
        none of which are their government. Saying which bodies actually govern
        there — and that we hold no calendar for them — is the difference
        between a helpful answer and a misleading one.
      */}
      {coverage && hasRepresentation(coverage) ? (
        <CoverageBody
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
      ) : (
        !coverage &&
        isEmpty && (
          // The registry could not be read. Fall back to what the cascade alone
          // knows rather than inventing a coverage claim.
          <p className="mt-1.5 t-body leading-relaxed text-paper-dim">
            No meetings on file near {zip} yet. We&apos;re still checking
            local calendars. A meeting may be listed before its agenda is posted.
          </p>
        )
      )}
      </div>
    </div>
  );
}
