"use client";


import { WorkingOnIt } from "@/components/demand/working-on-it";
import { ExternalLink } from "lucide-react";

import { useMemberDirectory, type MemberDirectory as DirectoryPayload } from "@/hooks/use-member-directory";
import {
  buildCommitteeTree,
  type CommitteeNode,
} from "@/lib/officials/committee-tree";
import {
  BATTLECARD_SECTIONS,
  battlecardSectionTitle,
  type BattlecardSectionId,
} from "@/lib/ballot/battlecard-sections";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { officeDirectionsUrl } from "@/lib/registry/links";
import type { SeatHolder } from "@/lib/officials/lookup";

import { CardSection } from "./card-section";

/*
 * BAL-34: the titles and the empty lines come from the SAME table the ballot
 * battlecard reads, so the two surfaces cannot word one absence two ways.
 */
const sectionTitle = (id: BattlecardSectionId) => battlecardSectionTitle(id);
const sectionEmptyLine = (id: BattlecardSectionId) =>
  BATTLECARD_SECTIONS.find((s) => s.id === id)?.emptyLine ?? "";

/**
 * **Committees, and the offices near the reader** — item 7's render
 * surfaces, 2026-08-16.
 *
 * ## Two sections, identical for all 537
 *
 * Equal effort applies to the SET of sections as much as to the hunt: a
 * rank-and-file member with no chair title renders the same two headers a
 * committee chairman does, with the honest content behind each. Collapse is
 * organization; it is never a way to render some people smaller than others.
 *
 * ## The clean render
 *
 * Directory facts carry NO per-surface source annotations. Full provenance
 * lives in the snapshot — SHA, read date, per-row tags — and one line on the
 * sources page; the card's Sources section names the project once for all of
 * it, not once per row. **Money, votes and PRL keep their per-section
 * citations**: a claim surface is a different register from a directory fact,
 * and that doctrine is unchanged.
 *
 * A committee's JURISDICTION is one tap down and does carry its source,
 * because a jurisdiction statement is prose about what a committee may do
 * rather than a directory entry.
 *
 * ## The key prop
 *
 * Keyed on the holder by the parent (D40 hygiene): a fetched slice must never
 * survive a holder change. A client component holding fetched state and not
 * resetting it when its key changes is the same defect class as a cache
 * keyed on the wrong thing.
 */

export function MemberDirectory({ holder }: { holder: SeatHolder }) {
  return <MemberDirectoryInner key={holder.id} holder={holder} />;
}


/**
 * **THE SAME TWO SECTIONS, AS CONTENT ONLY** (BC-1, 2026-08-22, item 14).
 *
 * The ballot page battlecard renders a FIXED set of seven drop-downs and owns
 * the headers itself, so it needs what goes INSIDE Committees and Offices near
 * you rather than two more collapsible sections nested inside its own.
 *
 * Both return null where the member is outside the source scope — sitting
 * federal members only — and a null slot renders the battlecard own honest
 * empty line. For a school-board candidate that is the correct answer: not
 * "no committees", but nothing on record from a source that does not reach
 * them.
 */
export function MemberCommitteesContent({ holder }: { holder: SeatHolder }) {
  return <DirectoryContent key={holder.id} holder={holder} only="committees" />;
}

export function MemberOfficesContent({ holder }: { holder: SeatHolder }) {
  return <DirectoryContent key={holder.id} holder={holder} only="offices" />;
}

/**
 * The two section BODIES, with no headers of their own.
 *
 * One implementation, two callers: the officials modal wraps these in its own
 * CardSections below, and the ballot battlecard drops them straight into its
 * fixed seven. A second copy of either body is a second place for the loading,
 * failed and empty branches to drift apart.
 */
function DirectoryContent({
  holder,
  only,
}: {
  holder: SeatHolder;
  only: "committees" | "offices";
}) {
  const { directory, failed } = useMemberDirectory(holder.id);
  return <DirectoryRecordsContent holderId={holder.id} only={only} directory={directory} failed={failed} />;
}

/** The exact fetched body, also executable for every canonical directory slice. */
export function DirectoryRecordsContent({ holderId, only, directory, failed }: {
  holderId: string;
  only: "committees" | "offices";
  directory: DirectoryPayload | null;
  failed: boolean;
}) {
  const offices = directory?.districtOffices ?? null;
  const committees = directory?.committees ?? null;

  // Committees are sourced for sitting federal members only; offices also for
  // state legislators. Anyone a section's source does not reach renders
  // nothing here rather than an empty heading, which would read as "this
  // person sits on none".
  //
  // The predicate is `lib/officials/member-directory-scope.ts` and it is the
  // ONE copy: a caller that does not ask it hands this component a slot that
  // looks filled and renders blank, which is what a reader met on the ballot
  // battlecard (Part C, 2026-08-31).
  if (!memberDirectoryReaches(holderId, only)) return null;
  const details = directory?.officeDetails ?? null;

  if (only === "committees") {
    return (
      <>
        {failed ? (
          <p className="t-detail leading-relaxed text-muted">
            Couldn&apos;t load the committee record just now.
          </p>
        ) : committees === null ? (
          <p className="t-detail leading-relaxed text-muted">Loading…</p>
        ) : committees.length === 0 ? (
          <WorkingOnIt />
        ) : (
          /* F01 4.2 (2026-08-19): PARENTS AND SUBCOMMITTEES, TOLD APART.
             The list was flat, so "Senate Committee on Armed Services" and
             "Senate Committee on Armed Services — Airland" read as two peers
             and a reader could not see that the second sits under the
             first. Subcommittees now indent behind a rule under the parent
             they belong to, and drop the parent's name from their own label
             because it is directly above them. See lib/officials/committee-tree.ts
             for how the relationship is derived and what happens if the
             source's convention ever stops holding. */
          <ul>
            {buildCommitteeTree(committees).map((node) => (
              <li
                key={node.seat.committeeId}
                data-committee-seat={node.seat.committeeId}
                className="border-b border-[var(--panel-border)] py-2 last:border-0"
              >
                <CommitteeRow node={node} />
                {node.children.length > 0 && (
                  <ul className="mt-1.5 border-l border-[var(--panel-border)] pl-3">
                    {node.children.map((child) => (
                      <li key={child.seat.committeeId} data-committee-seat={child.seat.committeeId} className="py-1.5">
                        <CommitteeRow node={child} sub />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return (
    <>
        {failed ? (
          <p className="t-detail leading-relaxed text-muted">
            Couldn&apos;t load the office list just now.
          </p>
        ) : offices === null ? (
          <p className="t-detail leading-relaxed text-muted">Loading…</p>
        ) : offices.length === 0 ? (
          <WorkingOnIt />
        ) : (
          <>
            <p className="mb-1.5 t-caption leading-relaxed text-voice">
              {details
                ? <>Where to reach this legislator in person: their office at the capitol and in the district, as Open States lists them.{details.some((d) => !d.official) ? " Not yet checked against the legislature’s own site." : ""}</>
                : <>These are the member&apos;s offices in the district, not the one in Washington. They are usually the ones that answer.</>}
            </p>
            <ul>
              {offices.map((office, i) => (
                <li
                  key={`${office.city}-${i}`}
                  data-directory-office={i}
                  className="border-b border-[var(--panel-border)] py-2 last:border-0"
                >
                  <p className="t-body font-medium text-paper">
                    {details?.[i] ? (details[i].officeKind === "CAPITOL" ? "Capitol office" : "District office") + (office.city ? " · " : "") : ""}
                    {office.city}
                    {office.state ? `, ${office.state}` : ""}
                  </p>
                  {/* F01 4.3 (2026-08-19): the address is a handoff to Google
                      Maps with the office loaded and ready to navigate. A
                      DECLARED exception to nothing-leaves-the-app, in the same
                      class as B19's directions link from a polling-place pin —
                      the reader's next action is physically going there. The
                      link carries the published address verbatim; nothing is
                      geocoded here.

                      A row whose address is missing renders as plain text
                      rather than a dead link, because a link that opens a map
                      of a city is an answer-shaped non-answer. */}
                  {office.address &&
                    (() => {
                      const url = officeDirectionsUrl({
                        address: office.address,
                        city: office.city,
                        state: office.state,
                        zip: office.zip,
                      });
                      const text = `${office.address}${office.zip ? ` ${office.zip}` : ""}`;
                      return url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Directions to the ${office.city ?? "district"} office (Google Maps)`}
                          className="mt-0.5 inline-flex items-baseline gap-1 t-detail leading-relaxed text-paper-dim underline decoration-dotted underline-offset-2 hover:text-link hover:decoration-solid"
                        >
                          {text}
                          <ExternalLink
                            className="size-3 shrink-0 translate-y-0.5"
                            aria-hidden="true"
                          />
                        </a>
                      ) : (
                        <p className="mt-0.5 t-detail leading-relaxed text-paper-dim">
                          {text}
                        </p>
                      );
                    })()}
                  {office.phone && (
                    <a
                      href={`tel:${office.phone.replace(/[^\d+]/g, "")}`}
                      className="mt-1 inline-flex t-detail text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    >
                      {office.phone}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
    </>
  );
}

/** How many rows a section has, for the header meta. Null while loading. */
function useDirectoryCounts(holder: SeatHolder): {
  committees: number | null;
  offices: number | null;
} {
  const { directory } = useMemberDirectory(holder.id);
  return {
    committees: directory?.committees?.length ?? null,
    offices: directory?.districtOffices?.length ?? null,
  };
}

/**
 * **BAL-34 (2026-08-31) — THE SECTIONS EXIST FOR EVERYONE, OR THEY ARE A
 * SIGNAL ABOUT THE PERSON.**
 *
 * The map battlecard was missing its *Offices near you* pill.
 * The cause was the line below this comment: `if (!holder.id.startsWith(
 * "congress:")) return null` — the whole component, headers included, vanished
 * for every state legislator, mayor and school-board member in the product.
 *
 * The ballot battlecard has not had this shape since BC-1: it renders the
 * fixed SEVEN drop-downs on EVERY card, always, and fills an absent slot with
 * the section's own honest empty line. Its reasoning is the equal-effort rule,
 * and it applies here word for word — *a card class that answers the question
 * differently is fine; a card class that cannot answer it at all was the
 * defect.* A pill present for federal members and absent for local ones is a
 * completeness claim about the PERSON, made by a missing header.
 *
 * So the sections are unconditional and the SCOPE fact moves inside them,
 * where it is a sentence about our source rather than a hole in the card.
 * `DirectoryContent` already returns null out of scope, and the empty lines
 * come from `BATTLECARD_SECTIONS` — the same table the ballot card reads, so
 * the two surfaces cannot word the same absence differently.
 */
function MemberDirectoryInner({ holder }: { holder: SeatHolder }) {
  const counts = useDirectoryCounts(holder);
  const inScope = memberDirectoryReaches(holder.id);
  const officesInScope = memberDirectoryReaches(holder.id, "offices");
  return (
    <>
      <CardSection
        title={sectionTitle("committees")}
        meta={inScope && counts.committees !== null ? String(counts.committees) : null}
      >
        {inScope ? (
          <DirectoryContent holder={holder} only="committees" />
        ) : (
          <p className="t-detail leading-relaxed text-muted">
            {sectionEmptyLine("committees")}
          </p>
        )}
      </CardSection>

      <CardSection
        title={sectionTitle("offices")}
        meta={officesInScope && counts.offices !== null ? String(counts.offices) : null}
      >
        {officesInScope ? (
          <DirectoryContent holder={holder} only="offices" />
        ) : (
          <p className="t-detail leading-relaxed text-muted">
            {sectionEmptyLine("offices")}
          </p>
        )}
      </CardSection>
    </>
  );
}

/**
 * One committee seat — F01 4.2, 2026-08-19.
 *
 * ## "Only some rows say what the committee handles"
 *
 * The other half of 4.2: a member sits on several committees, but only some
 * rows say what the committee handles.
 *
 * That is a SOURCE fact, and it is now stated as one instead of rendering as
 * silence. The directory's jurisdiction text comes from
 * `unitedstates/congress-legislators`, whose `committees-current` file carries
 * `jurisdiction` on 42 of 49 parent committees and — verified against the LIVE
 * file on 2026-08-19, not only the pinned snapshot — on **0 of 181
 * subcommittees**. The field does not exist there. So a subcommittee row with
 * no description is not a row somebody forgot to fill in; it is a rung of the
 * ladder that this source does not have, and the next rung is each committee's
 * own published rules. That hunt is recorded in `docs/source-ladder.md` and
 * tracked; it is not something a render change can close.
 *
 * Until it lands, the row says so, in the gap's own register (`CLAUDE.md`: a
 * null renders as its NAMED GAP, on every surface, always — and the name says
 * whose gap it is). "We haven't sourced what this subcommittee handles yet" is
 * a fact about us. Silence would have read as a fact about the subcommittee.
 */
function CommitteeRow({ node, sub = false }: { node: CommitteeNode; sub?: boolean }) {
  const { seat, label } = node;
  return (
    <>
      <p
        className={
          sub
            ? "t-detail leading-snug text-paper-dim"
            : "t-body leading-snug text-paper"
        }
      >
        {/* Names AS FILED, and the title in front of the committee the way the
            chamber states it: "Chairman, Armed Services". Never a rank
            rendered as a rating. On a child row the title belongs to the
            SUBCOMMITTEE — Kelly is ranking member of Airland, not of Armed
            Services — which the flat list made impossible to see. */}
        {seat.title ? `${seat.title}, ` : ""}
        {label}
      </p>
      {seat.jurisdiction ? (
        <details className="mt-1">
          <summary className="cursor-pointer t-caption text-paper-dim underline decoration-dotted hover:text-link">
            What this committee handles
          </summary>
          <p className="mt-1 t-caption leading-relaxed text-voice">
            {seat.jurisdiction}
          </p>
          {seat.jurisdictionSource && (
            <p className="mt-0.5 t-caption text-muted">
              Jurisdiction text from{" "}
              <a
                href={seat.jurisdictionSource}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted hover:text-link"
              >
                the committee&apos;s own statement
              </a>
              .
            </p>
          )}
        </details>
      ) : (
        <WorkingOnIt />
      )}
    </>
  );
}
