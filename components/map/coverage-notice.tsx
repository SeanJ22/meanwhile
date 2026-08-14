"use client";

import { useNarrowing } from "@/hooks/use-narrowing";
import { formatMiles } from "@/lib/map/format";

import { NarrowingPrompt } from "./narrowing-prompt";
import type { CoverageTier } from "@/lib/meetings/query";
import type { CoverageSummary, CoveredBody, Seat } from "@/lib/registry/coverage";
import { rosterHoldersForBody } from "@/lib/registry/body-rosters";
import {
  hasRepresentation,
  leadKind,
  noticeLabel,
  shouldRenderNotice,
} from "@/lib/registry/representation";
import { agendaAbsenceNote } from "@/lib/registry/wording";
import type { SeatHolder } from "@/lib/officials/lookup";

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
  onOpenOfficial?: OpenOfficial;
  /** Shrinks the card to its corner bubble — the explicit control (3). */
  onMinimize?: () => void;
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

const TIER_CLASS: Record<CoveredBody["tier"], string> = {
  local: "text-local",
  state: "text-state",
  national: "text-national",
};

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
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {onOpen ? (
        // The name opens the rep popup (3c) — photo, contact, what the
        // office does — rather than navigating away. The official page and
        // the source link both live inside it.
        <button
          type="button"
          onClick={onOpen}
          className="text-paper underline decoration-dotted underline-offset-2 hover:text-signal"
        >
          {holder.name}
        </button>
      ) : (
        <span className="text-paper">{holder.name}</span>
      )}
      {holder.partyLabel && (
        // Display only. Nothing here or downstream infers a position from it.
        <span className="text-muted">· {holder.partyLabel}</span>
      )}
      {holder.sourceUrl && (
        <a
          href={holder.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title="Where this record was read from"
          className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted hover:text-signal"
        >
          source
        </a>
      )}
    </span>
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
  return (
    <>
      {holders.map((holder, i) => (
        <span key={holder.id}>
          {i > 0 && <span className="text-muted">, </span>}
          <Holder
            holder={holder}
            onOpen={
              onOpenOfficial
                ? () => onOpenOfficial(holder, seatLabel, tier, seatOcdId)
                : undefined
            }
          />
        </span>
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
}: {
  zip: string;
  coverage: CoverageSummary;
  failedSourceOcdIds?: string[];
  onOpenOfficial?: OpenOfficial;
}) {
  const { bodies, seats, unincorporated, counts, senators, seatCounts } = coverage;

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
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
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

      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
        {lead}
      </p>

      {othersLine && (
        <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
          {othersLine}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {shown.map((body) => (
            <li
              key={body.bodyId}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] pb-1 last:border-0"
            >
              {/*
                The division's label, linked to the body's own page when a
                source hunt found one. This is the smallest form of the 4.6.10
                fix: a reader told "Newbury town governs here, and we don't have
                their calendar" previously had no way to reach Newbury at all.
                Still the division label and never Body.name, which is null on
                every row — the link's destination is sourced, the text is
                Census's, and neither is invented.
              */}
              {body.homepageUrl ? (
                <a
                  href={body.homepageUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="The body's own website"
                  className="text-[0.8125rem] leading-snug text-paper underline decoration-dotted underline-offset-2 hover:text-signal"
                >
                  {body.name ?? body.divisionLabel}
                </a>
              ) : (
                <span className="text-[0.8125rem] leading-snug">
                  {body.name ?? body.divisionLabel}
                </span>
              )}
              <span
                className={`shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.15em] ${TIER_CLASS[body.tier]}`}
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
                  <span className="text-local">Mayor</span>
                  <span className="text-right">
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
                  <span className="text-local">{holder.officeTitle}</span>
                  <span className="text-right">
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

      {/* The M26 narrowing prompt — renders only where the computed street
          index says the answer would change. Declining stays effortless.
          Keyed on the zip so a new zip mounts a fresh prompt. */}
      {/^\d{5}$/.test(zip) && <NarrowingPrompt key={zip} zip={zip} />}

      {/* 7 (2026-08-17): the mover's page, one tap from who-governs. */}
      {/^\d{5}$/.test(zip) && (
        <p className="mt-2 text-[0.75rem]">
          <a
            href={`/about-area?zip=${zip}`}
            className="underline decoration-dotted hover:text-signal"
          >
            Moving here? The basics — taxes, schools, registering →
          </a>
        </p>
      )}

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
      {shown
        .filter(
          (body) => body.ocdId !== null && failedSourceOcdIds.includes(body.ocdId),
        )
        .map((body) => (
          <p
            key={`${body.bodyId}-source-failed`}
            className="mt-1.5 text-[0.6875rem] leading-relaxed text-signal"
          >
            <span className="text-paper-dim">{body.divisionLabel}</span> — we
            couldn&apos;t reach their calendar source at the last check, so
            their meetings may be missing here.
          </p>
        ))}

      {shown.map((body) => {
        const note = agendaAbsenceNote(body.ocdId, body.coverageStatus);
        return note ? (
          <p
            key={`${body.bodyId}-absence`}
            className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted"
          >
            <span className="text-paper-dim">{body.divisionLabel}</span> — {note}
          </p>
        ) : null;
      })}

      {seats.length > 0 &&
        (seatCounts.named === 0 ? (
          // Nothing sourced for any seat — the original wording, still true.
          <p className="mt-2.5 text-[0.75rem] leading-relaxed text-muted">
            You&apos;re also represented in {seatLine}.
          </p>
        ) : (
          <>
            <p className="mt-2.5 text-[0.75rem] leading-relaxed text-muted">
              You&apos;re also represented in:
            </p>
            <ul className="mt-1 space-y-1">
              {seats.map((seat) => (
                <li
                  key={seat.ocdId}
                  className="flex items-baseline justify-between gap-3 text-[0.75rem] leading-snug"
                >
                  <span className={TIER_CLASS[seat.tier]}>{seat.label}</span>
                  <span className="text-right">
                    {seat.representatives.length > 0 ? (
                      <HolderList
                        holders={seat.representatives}
                        seatLabel={seat.label}
                        seatOcdId={seat.ocdId}
                        tier={seat.tier}
                        onOpenOfficial={onOpenOfficial}
                      />
                    ) : (
                      // Not "vacant" — we simply have no record. The two are
                      // completely different claims and only one is ours to
                      // make.
                      <span className="text-muted">no record yet</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ))}

      {senators.length > 0 && (
        // 3h (2026-08-16): the label on its own line, the names beneath it —
        // the inline form wrapped awkwardly at phone width.
        <div className="mt-2 text-[0.75rem] leading-relaxed text-muted">
          <p className="text-national">
            {senators.length === 1 ? "U.S. Senator" : "U.S. Senators"}
          </p>
          <p className="mt-0.5">
            <HolderList
              holders={senators}
              seatLabel={null}
              seatOcdId={null}
              tier="national"
              onOpenOfficial={onOpenOfficial}
            />
          </p>
        </div>
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
        <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-muted">
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
  onOpenOfficial,
  onMinimize,
}: CoverageNoticeProps) {
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

  return (
    <div className="panel pointer-events-auto relative max-w-md px-4 py-3.5">
      {onMinimize && (
        // The explicit way out (3) — engagement still collapses it, but the
        // reader shouldn't have to know that.
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimize — the card stays one tap away"
          className="absolute top-2 right-2 cursor-pointer p-1 text-muted hover:text-paper"
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
      <p
        className={`font-mono text-[0.625rem] uppercase tracking-[0.2em] ${accent}`}
      >
        {label}
      </p>

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
  );
}
