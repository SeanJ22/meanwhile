"use client";


import { useMemberDirectory } from "@/hooks/use-member-directory";
import type { SeatHolder } from "@/lib/officials/lookup";

import { CardSection } from "./card-section";

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
 * ## The clean render (the author's ruling)
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

interface DirectoryOffice {
  city: string | null;
  state: string | null;
  address: string | null;
  zip: string | null;
  phone: string | null;
}

export function MemberDirectory({ holder }: { holder: SeatHolder }) {
  return <MemberDirectoryInner key={holder.id} holder={holder} />;
}

function MemberDirectoryInner({ holder }: { holder: SeatHolder }) {
  // The fetch moved to hooks/use-member-directory.ts when g4 item 8 gave the
  // contact pill row a use for the same payload — one request, one arrival,
  // and no way for the two surfaces to disagree about whether it landed.
  const { directory, failed } = useMemberDirectory(holder.id);
  const offices = directory?.districtOffices ?? null;
  const committees = directory?.committees ?? null;

  // The source's scope is sitting federal members. A state legislator or a
  // school-board member renders nothing here rather than an empty
  // "Committees" heading, which would read as "this person sits on none".
  if (!holder.id.startsWith("congress:")) return null;

  return (
    <>
      <CardSection
        title="Committees"
        meta={committees ? String(committees.length) : null}
      >
        {failed ? (
          <p className="text-[0.75rem] leading-relaxed text-muted">
            Couldn&apos;t load the committee record just now.
          </p>
        ) : committees === null ? (
          <p className="text-[0.75rem] leading-relaxed text-muted">Loading…</p>
        ) : committees.length === 0 ? (
          <p className="text-[0.75rem] leading-relaxed text-muted">
            No committee seat on record for this member.
          </p>
        ) : (
          <ul>
            {committees.map((seat) => (
              <li
                key={seat.committeeId}
                className="border-b border-[var(--panel-border)] py-2 last:border-0"
              >
                <p className="text-[0.8125rem] leading-snug text-paper">
                  {/* Names AS FILED, and the title in front of the committee
                      the way the chamber states it: "Chairman, Armed
                      Services". Never a rank rendered as a rating. */}
                  {seat.title ? `${seat.title}, ` : ""}
                  {seat.name}
                </p>
                {seat.jurisdiction && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[0.6875rem] text-paper-dim underline decoration-dotted hover:text-link">
                      What this committee handles
                    </summary>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-voice">
                      {seat.jurisdiction}
                    </p>
                    {seat.jurisdictionSource && (
                      <p className="mt-0.5 text-[0.625rem] text-muted">
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
                )}
              </li>
            ))}
          </ul>
        )}
      </CardSection>

      <CardSection
        title="Offices near you"
        meta={offices ? String(offices.length) : null}
      >
        {failed ? (
          <p className="text-[0.75rem] leading-relaxed text-muted">
            Couldn&apos;t load the office list just now.
          </p>
        ) : offices === null ? (
          <p className="text-[0.75rem] leading-relaxed text-muted">Loading…</p>
        ) : offices.length === 0 ? (
          <p className="text-[0.75rem] leading-relaxed text-muted">
            No district office on record for this member.
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-[0.6875rem] leading-relaxed text-voice">
              These are the member&apos;s offices in the district, not the one
              in Washington. They are usually the ones that answer.
            </p>
            <ul>
              {offices.map((office, i) => (
                <li
                  key={`${office.city}-${i}`}
                  className="border-b border-[var(--panel-border)] py-2 last:border-0"
                >
                  <p className="text-[0.8125rem] font-medium text-paper">
                    {office.city}
                    {office.state ? `, ${office.state}` : ""}
                  </p>
                  {office.address && (
                    <p className="mt-0.5 text-[0.75rem] leading-relaxed text-paper-dim">
                      {office.address}
                      {office.zip ? ` ${office.zip}` : ""}
                    </p>
                  )}
                  {office.phone && (
                    <a
                      href={`tel:${office.phone.replace(/[^\d+]/g, "")}`}
                      className="mt-1 inline-flex text-[0.75rem] text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    >
                      {office.phone}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardSection>
    </>
  );
}
