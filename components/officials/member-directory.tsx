"use client";


import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { ExternalLink } from "lucide-react";

import { useMemberDirectory, type MemberDirectory as DirectoryPayload } from "@/hooks/use-member-directory";
import {
  buildCommitteeTree,
  type CommitteeNode,
} from "@/lib/officials/committee-tree";
import {
  battlecardSectionTitle,
  type BattlecardSectionId,
} from "@/lib/ballot/battlecard-sections";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { officeDirectionsUrl } from "@/lib/registry/links";
import type { SeatHolder } from "@/lib/officials/lookup";

import { CardSection } from "./card-section";

/* Titles come from the same table the ballot battlecard reads. */
const sectionTitle = (id: BattlecardSectionId) => battlecardSectionTitle(id);

/**
 * Committees and offices near the reader. Directory facts carry no per-row
 * source annotation; the card's Sources section names the project once. A
 * committee's jurisdiction, one tap down, carries its source. Keyed on the
 * holder by the parent.
 */

export function MemberDirectory({ holder }: { holder: SeatHolder }) {
  return <MemberDirectoryInner key={holder.id} holder={holder} />;
}


/**
 * The same two sections as content only, for the ballot battlecard's fixed
 * sections. Missing records contribute to the card gap.
 */
export function MemberCommitteesContent({ holder }: { holder: SeatHolder }) {
  return <DirectoryContent key={holder.id} holder={holder} only="committees" />;
}

export function MemberOfficesContent({ holder }: { holder: SeatHolder }) {
  return <DirectoryContent key={holder.id} holder={holder} only="offices" />;
}

/** The two section bodies without headers, shared by the officials modal and the ballot battlecard. */
function DirectoryContent({
  holder,
  only,
}: {
  holder: SeatHolder;
  only: "committees" | "offices";
}) {
  const { directory, failed } = useMemberDirectory(holder.id,holder.state);
  return <DirectoryRecordsContent holderId={holder.id} state={holder.state} only={only} directory={directory} failed={failed} />;
}

/** The exact fetched body, also executable for every canonical directory slice. */
export function DirectoryRecordsContent({ holderId, state, only, directory, failed }: {
  holderId: string;
  state?:string;
  only: "committees" | "offices";
  directory: DirectoryPayload | null;
  failed: boolean;
}) {
  const offices = directory?.districtOffices ?? null;
  const committees = directory?.committees ?? null;

  // Committees are sourced for sitting federal members only; offices also for
  // state legislators. The predicate is lib/officials/member-directory-scope.ts.
  if (!memberDirectoryReaches(holderId, only,state)) return <CardGapContribution id={`${only}:${holderId}`} label={only === "committees" ? "committee assignments" : "district offices"} />;
  const details = directory?.officeDetails ?? null;

  if (only === "committees") {
    return (
      <>
        {committees && committees.some(seat => !seat.jurisdiction) && <CardGapContribution id={`committee-descriptions:${holderId}`} label="committee responsibilities" count={committees.filter(seat => !seat.jurisdiction).length} unit="committee" />}
        {failed ? (
          <CardGapContribution id={`committees:${holderId}`} label="committee assignments" />
        ) : committees === null ? (
          <p className="t-detail leading-relaxed text-muted">Loading…</p>
        ) : committees.length === 0 ? (
          <CardGapContribution id={`committees:${holderId}`} label="committee assignments" />
        ) : (
          /* Subcommittees indent under their parent and drop its name (lib/officials/committee-tree.ts). */
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
          <CardGapContribution id={`offices:${holderId}`} label="district offices" />
        ) : offices === null ? (
          <p className="t-detail leading-relaxed text-muted">Loading…</p>
        ) : offices.length === 0 ? (
          <CardGapContribution id={`offices:${holderId}`} label="district offices" />
        ) : (
          <>
            <p className="mb-1.5 t-caption leading-relaxed text-voice">
              {details
                ? <>Office contacts at the capitol and in the district, as Open States lists them.{details.some((d) => !d.official) ? " Not yet checked against the legislature’s own site." : ""}</>
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
                  {/*
                    A handoff to Google Maps with the published address
                    verbatim; nothing is geocoded. A missing address renders as
                    plain text.
                  */}
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
                  {office.email && (
                    <a
                      href={`mailto:${office.email}`}
                      className="mt-1 block t-detail text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    >
                      {office.email}
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

/** Keep only sections with held records; gaps are collected by the card frame. */
function MemberDirectoryInner({ holder }: { holder: SeatHolder }) {
  const { directory, failed } = useMemberDirectory(holder.id, holder.state);
  return <>
    {(["committees", "offices"] as const).map(only => {
      const records = only === "committees" ? directory?.committees : directory?.districtOffices;
      if (!memberDirectoryReaches(holder.id, only, holder.state) || failed || records?.length === 0) {
        return <CardGapContribution key={only} id={`${only}:${holder.id}`} label={only === "committees" ? "committee assignments" : "district offices"} subject={{ type: "CANDIDATE", id: holder.id }} />;
      }
      return <CardSection key={only} title={sectionTitle(only)} meta={records ? String(records.length) : null}>
        <DirectoryRecordsContent holderId={holder.id} state={holder.state} only={only} directory={directory} failed={failed} />
      </CardSection>;
    })}
  </>;
}

/**
 * One committee seat. The jurisdiction text comes from
 * `unitedstates/congress-legislators`, which carries none for subcommittees;
 * a row without it omits that detail.
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
        {/* Names as filed, with the chamber's title for this (sub)committee; never a rank. */}
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
          {seat.jurisdictionSource && <CardSourcesContribution id={`jurisdiction:${seat.committeeId}`} sources={[{ what: `What ${label} handles`, provenance: { sourceUrl: seat.jurisdictionSource, sourceOrg: label, collectedAt: "", verifiedAt: null } }]} />}
        </details>
      ) : null}
    </>
  );
}
