"use client";

import { useRef } from "react";

import { useDismissOnOutside } from "@/hooks/use-dismiss-on-outside";
import { useNarrowing } from "@/hooks/use-narrowing";
import { formatMiles } from "@/lib/map/format";

import { AskBox } from "@/components/ask/ask-box";
import { NarrowingPrompt } from "./narrowing-prompt";
import type { StreetPoint } from "@/lib/geo/census-geocoder";
import type { CoverageTier } from "@/lib/meetings/query";
import type { CoverageSummary, CoveredBody, Seat } from "@/lib/registry/coverage";
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
}

/** How many bodies to name before collapsing the rest into a count. */
const NAME_LIMIT = 5;

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

const DIVISION_NOUN: Record<CoveredBody["divisionType"], string> = {
  county: "County",
  place: "Municipal",
  school_district: "School district",
  cd: "Congressional",
  sldu: "State senate",
  sldl: "State house",
};

const BODY_CLASS_NOUN: Record<CoveredBody["bodyClass"], string> = {
  GOVERNING: "Governing",
  ADVISORY: "Advisory",
  COMMISSION: "Commission",
  REGIONAL: "Regional",
  PRIVATE_ASSOCIATION: "Private",
};

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
        {holder.sourceUrl && (
          <a
            href={holder.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title="Where this record was read from"
            className="source-tag font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted underline decoration-dotted underline-offset-2 hover:text-link"
          >
            source
          </a>
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
  onOpenOfficial,
  onOpenBody,
  onNarrowApplied,
  onStreetPoint,
}: {
  zip: string;
  coverage: CoverageSummary;
  failedSourceOcdIds?: string[];
  onOpenOfficial?: OpenOfficial;
  onOpenBody?: (body: CoveredBody) => void;
  onNarrowApplied?: () => void;
  onStreetPoint?: (point: StreetPoint) => void;
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

  // Item 2c (2026-08-14 second session): officials group under three
  // headers, closest-first — Local, State, Federal. The state seats and
  // the federal seat split by division type (structure, never a label
  // match); the governor (2b) rides under STATE after the legislators —
  // order of scope, district before statewide.
  const stateSeats = seats.filter(
    (s) => s.divisionType === "sldl" || s.divisionType === "sldu",
  );
  const federalSeats = seats.filter((s) => s.divisionType === "cd");

  /*
   * The reader's device-local narrowing (M26): where they picked their
   * municipality or school district, bodies of that TYPE narrow to the
   * choice; every other type stays fully listed. The choice never leaves
   * the device — see hooks/use-narrowing.ts.
   */
  const narrowing = useNarrowing(zip);
  const selected = new Set(narrowing.divisions);
  const narrowedTypes = new Set(
    bodies
      .filter((b) => b.ocdId !== null && selected.has(b.ocdId))
      .map((b) => b.divisionType),
  );
  const narrowedBodies = bodies.filter(
    (b) =>
      !narrowedTypes.has(b.divisionType) ||
      (b.ocdId !== null && selected.has(b.ocdId)),
  );

  const shown = narrowedBodies.slice(0, NAME_LIMIT);
  const hidden = narrowedBodies.length - shown.length;
  const seatLine = seatPhrase(seats);
  const kind = leadKind(coverage);
  const g = counts.governing;
  const others = counts.total - g.total;
  const othersWithSource = counts.withSource - g.withSource;

  const lead =
    kind === "unmapped" ? (
      <>
        We haven&apos;t mapped the governing bodies covering {zip} yet. That is a
        gap in our data, not a gap in your government.
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
      {hidden > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[0.6875rem] text-link">
            Why these {shown.length}?
          </summary>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">
            These are the bodies whose calendars we watch here, listed in the
            order our coverage check returns them and cut at {shown.length}.
            It isn&apos;t a ranking — nothing here is scored or ordered by
            importance. The {hidden} others are counted in the line below.
          </p>
        </details>
      )}
      {shown.length > 0 && (
        <ul className="mt-1 space-y-1">
          {shown.map((body) => (
            <li
              key={body.bodyId}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] pb-1 last:border-0"
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
              <span
                className={`shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] ${TYPE_LABEL_CLASS}`}
              >
                {/* A derived row is the division's government and tags by
                    division type. A curated row tags by what it is — the PHA
                    board tagged "Municipal" would claim a second city
                    government, and a commission isn't a government at all. */}
                {body.name === null
                  ? DIVISION_NOUN[body.divisionType]
                  : BODY_CLASS_NOUN[body.bodyClass]}
              </span>
            </li>
          ))}
          {/* 3e (2026-08-16): the mayor surfaces in who-governs. The roster
              was curated (5b) but only rendered on meeting cards, so 85701
              showed Tucson's government without its highest-profile office.
              The chief elected official of each governing body's roster now
              renders under the body list; the full roster stays on the
              body's meeting card. */}
          {shown.flatMap((body) =>
            rosterHoldersForBody(body.bodyId)
              .filter((holder) => holder.officeTitle === "Mayor")
              .map((holder) => (
                <li
                  key={holder.id}
                  className="flex items-baseline justify-between gap-3 pb-1 text-[0.75rem] leading-snug"
                >
                  <span className={TYPE_LABEL_CLASS}>Mayor</span>
                  <span className="block">
                    <Holder
                      holder={holder}
                      onOpen={
                        onOpenOfficial
                          ? () =>
                              onOpenOfficial(holder, "Mayor", "local", body.ocdId)
                          : undefined
                      }
                    />
                  </span>
                </li>
              )),
          )}
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
                  <span className={TYPE_LABEL_CLASS}>{holder.officeTitle}</span>
                  <span className="block">
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
          {hidden > 0 && (
            <li className="pt-0.5 text-[0.75rem] text-muted">
              and {hidden} more
            </li>
          )}
        </ul>
      )}

      {/* The M26 narrowing affordance — a passive chip (item 6), rendered
          only where the computed street index says the answer would change.
          Keyed on the zip so a new zip mounts a fresh chip. */}
      {/^\d{5}$/.test(zip) && (
        <NarrowingPrompt
          key={zip}
          zip={zip}
          onApplied={onNarrowApplied}
          onPoint={onStreetPoint}
        />
      )}

      {/* 7 (2026-08-17): the mover's page, one tap from who-governs. */}
      {/^\d{5}$/.test(zip) && (
        <p className="mt-2 text-[0.75rem]">
          <a
            href={`/about-area?zip=${zip}`}
            className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Moving here? Know the basics — Taxes, schools, registering, and
            more. →
          </a>
        </p>
      )}

      {/* 5 (2026-08-19): the ask box — routing without generation, on the
          card that answers who governs. */}
      <AskBox
        coverage={coverage}
        zip={/^\d{5}$/.test(zip) ? zip : null}
        ocdIds={[
          ...new Set(
            [
              ...coverage.bodies.map((b) => b.ocdId),
              ...coverage.seats.map((s) => s.ocdId),
            ].filter((id): id is string => Boolean(id)),
          ),
        ]}
      />

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
      {collapseFootnotes(
        shown.filter(
          (body) => body.ocdId !== null && failedSourceOcdIds.includes(body.ocdId),
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
              <p className="t-structure mt-3 text-state">State</p>
              <ul className="mt-1 space-y-1">
                {stateSeats.map((seat) => (
                  <li
                    key={seat.ocdId}
                    className="text-[0.75rem] leading-snug"
                  >
                    <span className={TYPE_LABEL_CLASS}>{seat.label}</span>
                    <span className="block">
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
                    <span className={TYPE_LABEL_CLASS}>{holder.officeTitle}</span>
                    <span className="block">
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
              <p className="t-structure mt-3 text-national">Federal</p>
              <ul className="mt-1 space-y-1">
                {federalSeats.map((seat) => (
                  <li
                    key={seat.ocdId}
                    className="text-[0.75rem] leading-snug"
                  >
                    <span className={TYPE_LABEL_CLASS}>{seat.label}</span>
                    <span className="block">
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
                {senators.map((holder) => (
                  <li
                    key={holder.id}
                    className="text-[0.75rem] leading-snug"
                  >
                    <span className={TYPE_LABEL_CLASS}>U.S. Senator</span>
                    <span className="block">
                      <Holder
                        holder={holder}
                        onOpen={
                          onOpenOfficial
                            ? () =>
                                onOpenOfficial(holder, "U.S. Senator", "national", null)
                            : undefined
                        }
                      />
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
  refreshing = false,
  onOpenOfficial,
  onOpenBody,
  onMinimize,
  onNarrowApplied,
  onStreetPoint,
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
          className={`font-mono text-[0.625rem] uppercase tracking-[0.2em] ${accent}`}
        >
          {label}
        </p>

        {/*
          Item 2 of the tester's mobile pass (2026-08-14). Her words: the
          floater never appears on her phone and "I don't think I would have
          found that without knowing it existed" — the only entry she could
          find sat at the very bottom of the drawer, under the browser
          chrome. The floater's occlusion is fixed above; this is the entry
          that does not depend on a reader spotting a 10px pill among the
          map controls. It says what it is in words, it sits at the top of
          the surface she was actually reading, and it is pinned outside the
          card's scroll so it is on screen the moment the card is.

          Reader friction is a defect: same tab, zip attached, no
          interstitial. This is the product's core surface — reactions, the
          picks card — and a reader who cannot reach it does not have it.
        */}
        <a
          href={ballotZip ? `/ballot?zip=${ballotZip}` : "/ballot"}
          className="coverage-notice-ballot mt-2 flex items-center justify-between gap-2 rounded border border-[var(--signal)]/45 bg-[var(--signal)]/5 px-2.5 py-2 text-[0.8125rem] leading-snug text-paper hover:border-[var(--signal)]"
        >
          <span className="font-semibold">What&apos;s on the ballot</span>
          <span aria-hidden="true" className="shrink-0 text-signal">
            →
          </span>
        </a>
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
          onOpenOfficial={onOpenOfficial}
          onOpenBody={onOpenBody}
          onNarrowApplied={onNarrowApplied}
          onStreetPoint={onStreetPoint}
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
