"use client";

import { readerOfficeTitle } from "@/lib/officials/reader-office-title";
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
import type { CoverageSummary, CoveredBody, Seat } from "@/lib/registry/coverage";
import { deriveWhoGoverns } from "@/lib/registry/who-governs";
import {
  applyResolvedLocation,
  homeSubject,
  type BodyStanding,
  type LocationCertainty,
} from "@/lib/state/resolved-location";
import { bodyClassShort } from "@/lib/registry/body-class-labels";
import { rosterHoldersForBody } from "@/lib/registry/body-rosters";
import {
  hasRepresentation,
  leadKind,
  noticeLabel,
  shouldRenderNotice,
} from "@/lib/registry/representation";
import { agendaAbsenceNote, collapseFootnotes } from "@/lib/registry/wording";
import type { SeatHolder } from "@/lib/officials/lookup";
import { partyColorVar } from "@/lib/officials/party-color";
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
  coverage: CoverageSummary | null;
  /**
   * Divisions whose calendar source failed at the last snapshot refresh. A
   * body on this list showing nothing means "we couldn't reach their source
   * this time", which is a different claim from "nothing is scheduled" and
   * must never render the same way.
   */
  failedSourceOcdIds?: string[];
  /**
   * **F01 7.2 (2026-08-19, the author)** — which of those bodies nevertheless
   * has meetings ON SCREEN right now.
   *
   * His finding: the New Hampshire card said it couldn’t reach Kearsarge’s and
   * Newbury’s calendar sources “so their meetings may be missing here”, and
   * clicking the maroon dot in New London showed Kearsarge meetings anyway.
   * *"Something’s not right."*
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
   * The answer under this card is the previous area's, and a fresher one is
   * in flight (6f). The card DIMS rather than un-rendering — un-rendering is
   * what made the bubble blink on every pan — and the dim is what keeps a
   * held answer from reading as a settled one.
   */
  refreshing?: boolean;
  onOpenOfficial?: OpenOfficial;
  /**
   * Opens a BODY's large battlecard (item 3, 2026-08-16, the author's
   * ruling). The click grammar on this surface is exactly two moves: a
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
      className="mt-1 text-[0.6875rem] leading-relaxed text-muted"
    >
      {standing === "ADDRESS_RESOLVED" ? (
        <>Your area — {zip}, narrowed by the address you gave.</>
      ) : (
        <>Your area — {zip}, the area you asked about.</>
      )}
    </p>
  );
}

/**
 * A row the reader's own address EXCLUDES.
 *
 * **It marks, it never removes** (RULING 26, RULING 27). We hold this
 * government in full and it governs real people in this zip; what the address
 * settled is that it is not the reader's. The old surface said nothing at all
 * here, which is what let District 19's members sit under a prompt reading
 * District 17 and read as the reader's own.
 *
 * The sentence names no district number it cannot source. `session-address`
 * stores the confirmed division IDS and not their labels, and a reader surface
 * may not print an OCD-ID — so the honest claim is the one the evidence
 * actually supports: *this covers another part of your zip*, which is a fact
 * about the boundary and not a guess about the reader.
 */
function ElsewhereMark({ zip }: { zip: string }) {
  return (
    <span
      data-standing="ELSEWHERE_IN_ZIP"
      className="ml-1.5 shrink-0 text-[0.625rem] leading-none text-muted"
    >
      not yours — covers another part of {zip}
    </span>
  );
}

/** Only an EXCLUSION is marked. Confirmed and unsettled rows read as before. */
function marksElsewhere(standing: BodyStanding | undefined): boolean {
  return standing === "ELSEWHERE_IN_ZIP";
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
   * ITEM 3 (2026-08-16, the author's ruling): THE LIST GOES BACK TO CLEAN.
   *
   * The prior pass gave this row the battlecards' full element grammar — a
   * filled party chip and a "Their site →" link beside every name — and the
   * author's verdict on the result was "way overcrowded... a forever scroll."
   * It was: this card can carry twenty-odd people, and twenty rows each
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
   * grammar the author set for this whole surface: a PERSON opens a person's
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
            {holder.partyLabel}
          </span>
        )}
        {/*
          **BC-14 (2026-08-25) — the same right-edge source link, on the same
          class of surface, removed for the same reason.**

          RULING 136: the author's id names an instance and the defect is the
          class. He boxed the small battlecard; this is the who-governs card,
          which carries the identical `· SOURCE` run at the right edge of every
          holder row. Fixing only the row he photographed is what the last two
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
   * **The row is annotated and never dropped.** A reader whose zip crosses a
   * legislative line is still shown the whole zip's representation; what
   * changes is that the card no longer presents another district's members as
   * theirs by saying nothing.
   */
  const seatsHere = applyResolvedLocation(seats, subject.location);

  // Item 2c (2026-08-14 second session): officials group under three
  // headers, closest-first — Local, State, Federal. The state seats and
  // the federal seat split by division type (structure, never a label
  // match); the governor (2b) rides under STATE after the legislators —
  // order of scope, district before statewide.
  const stateSeats = seatsHere.filter(
    (s) => s.divisionType === "sldl" || s.divisionType === "sldu",
  );
  const federalSeats = seatsHere.filter((s) => s.divisionType === "cd");

  /*
   * The reader's device-local narrowing (M26): where they picked their
   * municipality or school district, bodies of that TYPE narrow to the
   * choice; every other type stays fully listed. The choice never leaves
   * the device — see hooks/use-narrowing.ts.
   */
  const narrowing = useNarrowing(zip);
  const selected = new Set(narrowing.divisions);

  // The same subject the seats above were annotated against. One location, one
  // question, every list on this card.
  const bodiesHere = applyResolvedLocation(bodies, subject.location);

  /*
   * ITEM 1a (2026-08-17, the author's ruling): ONE DENOMINATOR.
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
        We haven&apos;t mapped the governing bodies covering {zip} yet. This is
        not a statement that no government covers it.
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
          {g.total === 1
            ? "Its calendar is being added — we don't have it yet."
            : "Their calendars are being added — we don't have them yet."}
        </>
      ) : (
        <>
          We track the {g.withSource === 1 ? "calendar" : "calendars"} of{" "}
          {g.withSource} of the {g.total} bodies that govern the area around{" "}
          {zip}.{" "}
          {g.total - g.withSource === 1
            ? "The other body's calendar is being added."
            : `The other ${g.total - g.withSource} are being added.`}
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
        {g.withSource === 0
          ? g.total === 1
            ? "Its calendar is being added — we don't have it yet."
            : "Their calendars are being added — we don't have them yet."
          : `We track ${g.withSource === 1 ? "the calendar" : "the calendars"} of ${g.withSource}; the other ${
              g.total - g.withSource === 1
                ? "one is"
                : `${g.total - g.withSource} are`
            } being added.`}
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
            ` ${others - othersWithSource} more ${others - othersWithSource === 1 ? "body is" : "bodies are"} being added.`}
        </>
      ) : (
        <>
          {others === 1
            ? "One more board, committee or commission serves the area — being added."
            : `${others} more boards, committees and commissions serve the area — being added.`}
        </>
      )
    ) : null;

  return (
    <>
      {unincorporated && (
        // The no-mayor case is a stated fact, not an empty slot (5b): say
        // what this place has instead of what it lacks.
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-voice">
          <span className="text-signal">
            This area isn&apos;t a city or town
          </span>{" "}
          — it has no mayor or city council.
          {(() => {
            const county = bodies.find((b) => b.divisionType === "county");
            return county
              ? ` The ${county.name ?? `${county.divisionLabel} County board`} is the closest thing here.`
              : "";
          })()}
        </p>
      )}

      {/* The app's voice (design pass): coverage explanation is guidance,
          not record — it renders in the voice register. */}
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-voice">
        {lead}
      </p>

      {/* WGH-15: which question this card answers, said once, at the top. */}
      <SubjectLine zip={zip} standing={subject.location.certainty} />

      {/*
        WGH-15: and how many of the rows below their own address excludes.
        Stated rather than left to be spotted — a reader who gave an address
        and then sees a neighbouring district's board in the list needs to be
        told which is which, not left to compare it against a prompt.

        It is a SENTENCE, never a filter. Every row is still rendered and every
        row is still openable (RULING 26, RULING 27).
      */}
      {derived.elsewhere > 0 && (
        <p
          data-elsewhere-count={derived.elsewhere}
          className="mt-1 text-[0.75rem] leading-relaxed text-voice"
        >
          {derived.elsewhere === 1
            ? "One of these governs a different part of "
            : `${derived.elsewhere} of these govern a different part of `}
          {zip} than your address, and{" "}
          {derived.elsewhere === 1 ? "it is marked" : "they are marked"} below.
          We hold {derived.elsewhere === 1 ? "it" : "them"} in full — nothing is
          hidden from you.
        </p>
      )}

      {othersLine && (
        <p className="mt-1 text-[0.75rem] leading-relaxed text-voice">
          {othersLine}
        </p>
      )}

      {shown.length > 0 && (
        // Structural label (design pass): organizes, confident, with its
        // shelf rule — never smaller than the names it organizes.
        <p className="t-structure mt-3 text-local">Local</p>
      )}
      {/*
        6g (2026-08-15, the author): "Why these five?" — the top list surfaces
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
          <summary className="cursor-pointer text-[0.6875rem] text-link">
            Why these {shown.length}?
          </summary>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">
            {shown.length === 1
              ? "This is the government whose boundary covers this area"
              : `These are the ${shown.length} governments whose boundaries cover this area`}{" "}
            — the county, the city or town, the school district, and any
            special district that governs here. All of them are listed; none is
            left out. It isn&apos;t a ranking — nothing here is scored or
            ordered by importance.
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
                ITEM 3 (2026-08-16, the author's ruling): A BODY ROW OPENS ITS
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
                right-aligned type label — the author's `17-30-58` shows the
                marks on `Rockaway township`, `Denville township` and
                `Rockaway` floating a third of the way across the panel, nowhere
                near the words they belong to.

                **He is fine with the asterisk existing** — his objection is the
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
                    title={`More about ${body.name ?? body.divisionLabel}`}
                    className="cursor-pointer text-left text-[0.8125rem] leading-snug text-paper hover:text-link hover:underline"
                  >
                    {body.name ?? body.divisionLabel}
                  </button>
                ) : (
                  <span className="text-[0.8125rem] leading-snug">
                    {body.name ?? body.divisionLabel}
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
                  <CouldGovernMark jurisdiction={body.name ?? body.divisionLabel} />
                )}
                {/*
                  WGH-15: the reader's own address settled this level and named
                  a DIFFERENT division, so this government is not theirs. It
                  keeps its `CouldGovernMark` too, deliberately —
                  `keepsCouldGovernPill` explains why an unmarked row would read
                  as "this governs you", and this sentence is the stronger copy
                  that comment says the mark is waiting for.
                */}
                {marksElsewhere(body.standing) && <ElsewhereMark zip={zip} />}
              </span>
              <span
                className={`trailing-space-trimmed shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] ${TYPE_LABEL_CLASS}`}
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
            ITEM 6 (2026-08-17, the author's ruling): THE MAYOR ROW IS GONE
            FROM THIS PANEL, everywhere it appeared, no exceptions.

            3e (2026-08-16) put it here because 85701 showed Tucson's
            government without its highest-profile office. The author's ruling
            is that the placement is awkward and the office already renders in
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
            const board = rosterHoldersForBody(body.bodyId).filter((holder) =>
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
                className="pb-1 text-[0.75rem] leading-relaxed text-paper-dim"
              >
                <span className="text-signal">
                  {townName} isn&apos;t a city — it has no mayor.
                </span>{" "}
                The Select Board runs the town.
              </li>,
              ...board.map((holder) => (
                <li
                  key={holder.id}
                  className="flex items-baseline justify-between gap-3 pb-1 text-[0.75rem] leading-snug"
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
        the Local listing and the State listing, exactly where the author put
        it. Every affected row above carries an asterisk and nothing more.

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
      {/* F01 7.2 (2026-08-19) — TWO SENTENCES, because there are two facts.

          This used to be one footnote over every body whose source refused,
          saying their meetings “may be missing here”. For a body whose rows
          were carried forward that is false ON ITS FACE: the rows are on the
          map, and the author clicked one. What is true of that body is that we
          could not REFRESH it — which is what the carried rows already say
          individually, and what this card was contradicting.

          A body with no rows on screen keeps the original sentence, which was
          right all along for the case it was written for. */}
      {collapseFootnotes(
        shown.filter(
          (body) =>
            body.ocdId !== null &&
            failedSourceOcdIds.includes(body.ocdId) &&
            ocdIdsWithMeetings.includes(body.ocdId),
        ),
        () =>
          "we couldn’t reach their calendar source at the last check, so what’s on the map for them is from our previous check.",
      ).map((footnote) => (
        <p
          key={`source-stale:${footnote.subjects}`}
          className="mt-1.5 text-[0.6875rem] leading-relaxed text-signal"
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
          "we couldn’t reach their calendar source at the last check, so their meetings may be missing here.",
      ).map((footnote) => (
        <p
          key={`source-failed:${footnote.subjects}`}
          className="mt-1.5 text-[0.6875rem] leading-relaxed text-signal"
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
          className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted"
        >
          <span className="text-paper-dim">{footnote.subjects}</span> —{" "}
          {footnote.note}
        </p>
      ))}

      {seats.length > 0 && seatCounts.named === 0 ? (
        // Nothing sourced for any seat — the original wording, still true.
        <p className="mt-2.5 text-[0.75rem] leading-relaxed text-voice">
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
                {stateSeats.map((seat) => (
                  <li
                    key={seat.ocdId}
                    /* WGH-15: the walk reads the standing off the row rather
                       than inferring it from a Tailwind class, so the next
                       design pass cannot silently disarm the guard. */
                    data-seat-standing={seat.standing}
                    className="text-[0.75rem] leading-snug"
                  >
                    <span className={TYPE_LABEL_CLASS}>{seat.label}</span>
                    {/* THE REPORTED ROW. District 19's members under a prompt
                        reading District 17 — both facts true, one of them not
                        the reader's, and nothing on screen saying which. */}
                    {marksElsewhere(seat.standing) && <ElsewhereMark zip={zip} />}
                    <span className="block person-under-heading">
                      {seat.representatives.length > 0 ? (
                        <HolderList
                          holders={seat.representatives}
                          seatLabel={seat.label}
                          seatOcdId={seat.ocdId}
                          tier={seat.tier}
                          onOpenOfficial={onOpenOfficial}
                        />
                      ) : (
                        // Not "vacant" — we simply have no record. The two
                        // are completely different claims and only one is
                        // ours to make.
                        <span className="text-muted">no record yet</span>
                      )}
                    </span>
                  </li>
                ))}
                {statewideExecutives.map((holder) => (
                  <li
                    key={holder.id}
                    className="text-[0.75rem] leading-snug"
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
              {statewideExecutives.length > 0 && (
                <p className="mt-1 text-[0.625rem] leading-relaxed text-muted">
                  The governor is the only statewide office listed so far.
                </p>
              )}
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
                {federalSeats.map((seat) => (
                  <li
                    key={seat.ocdId}
                    data-seat-standing={seat.standing}
                    className="text-[0.75rem] leading-snug"
                  >
                    <span className={TYPE_LABEL_CLASS}>{seat.label}</span>
                    {/* Same rule at the federal level. A zip that crosses a
                        congressional line is rarer, not different. */}
                    {marksElsewhere(seat.standing) && <ElsewhereMark zip={zip} />}
                    <span className="block person-under-heading">
                      {seat.representatives.length > 0 ? (
                        <HolderList
                          holders={seat.representatives}
                          seatLabel={seat.label}
                          seatOcdId={seat.ocdId}
                          tier={seat.tier}
                          onOpenOfficial={onOpenOfficial}
                        />
                      ) : (
                        <span className="text-muted">no record yet</span>
                      )}
                    </span>
                  </li>
                ))}
                {/*
                  ALIGN-2 (2026-08-26, the author's 8/26 walkthrough). This
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
                    className="text-[0.75rem] leading-snug"
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
        <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-voice">
          {counts.withoutSource > 0 && (
            <>
              We know these bodies exist because the district boundaries do. We
              haven&apos;t sourced their names or meeting schedules yet.{" "}
              {/*
                4.6.1. Without this sentence the one above implies we searched
                and came up empty, which is true for almost none of them — 258
                of 265 bodies have never been looked at. Claiming a diligence
                nobody spent is the same family of overclaim as a fabricated
                source URL, just harder to catch because there is nothing to
                click.
              */}
              {/*
                Says only that a search happened, never what it turned up —
                a searched body can still be blocked by vendor terms or publish
                nothing at all. Where a search did find the body's page, the
                link on its name above is the evidence, and it needs no caption.
              */}
              {counts.lookedAt === 0
                ? "Nobody has searched for their agendas yet."
                : counts.lookedAt < counts.total
                  ? `We've searched for the agendas of ${counts.lookedAt} of the ${counts.total}.`
                  : counts.total === 1
                    ? "We have searched for its agendas."
                    : "We have searched for all of their agendas."}
            </>
          )}
          {counts.withoutSource > 0 && seatCounts.named < seatCounts.total && " "}
          {seatCounts.named < seatCounts.total && (
            <>
              {seatCounts.named > 0
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
        **WGH-7 (2026-08-24, the author's ruling) — DELETED, AND THIS IS WHAT
        CLOSES WGH-3 AND WGH-4 RATHER THAN MERGING THEM.**

        His words: *delete the "Narrow this area" link under the federal
        representatives — the pill is the single entry point.*

        The pill he means is `CouldGovernNotice`, above the Local list, which
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
        <p className="mt-2 text-[0.75rem]">
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
  coverage,
  failedSourceOcdIds,
  ocdIdsWithMeetings,
  refreshing = false,
  onOpenOfficial,
  onOpenBody,
  onMinimize,
  onAddressResolved,
  onAddressCleared,
  pillCluster,
  clusterElsewhere = false,
}: CoverageNoticeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
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
      className="coverage-notice panel pointer-events-auto relative max-w-md px-4 py-3.5"
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
          className={`font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] ${accent}`}
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
              className="coverage-notice-ballot mt-2 flex items-center justify-between gap-2 rounded border border-[var(--signal)]/45 bg-[var(--signal)]/5 px-2.5 py-2 text-[0.8125rem] leading-snug text-paper hover:border-[var(--signal)]"
            >
              <span className="font-semibold">What&apos;s on the ballot</span>
              <span aria-hidden="true" className="shrink-0 text-signal">
                →
              </span>
            </a>
          ))}
      </div>

      <div className="coverage-notice-body">
      {tier === "widened" && (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
          Nothing scheduled within {near} miles of {zip}. Showing the{" "}
          {count === 1 ? "one meeting" : `${count} meetings`} within {wide}{" "}
          miles.
        </p>
      )}

      {tier === "concluded" && (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
          No upcoming meetings within {wide} miles of {zip}. These already
          happened — the agendas still show what was decided.
        </p>
      )}

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
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
            No meetings on file near {zip} yet. We&apos;re still adding
            jurisdictions, starting with the ones that publish machine-readable
            agendas.
          </p>
        )
      )}
      </div>
    </div>
  );
}
