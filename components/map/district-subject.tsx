import type { DistrictHit } from "@/lib/map/districts";
import type { Meeting } from "@/lib/sources/types";
import type { CoverageSummary } from "@/lib/registry/coverage";
import type { DivisionRepresentation } from "@/hooks/use-division-representation";
import type { ModalSubject } from "./popup/entity-modal";
import { stateOcdIdFrom } from "@/lib/ocd/state-division";
import { districtCardSources } from "@/lib/officials/card-sources";
import { projectedRosterGapsForDivision } from "@/lib/registry/body-roster-client";
import { noteStateFor, representationForDivision, representationNoteFor } from "@/lib/registry/representation";
import { tierForMeeting } from "@/lib/state/derive";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";

/** The legislative divisions hit at the click, plus that jurisdiction's statewide offices. */
export function spotDivisionsFor(district: DistrictHit, hits: readonly DistrictHit[]) {
  const stateOcdId = stateOcdIdFrom(district.ocdId);
  const divisions = new Map<string, { ocdId: string; label: string; tier: Tier }>();
  for (const hit of hits) {
    const seat = /\/(cd|sldu|sldl):([^/]+)$/.exec(hit.ocdId);
    if (!seat || stateOcdIdFrom(hit.ocdId) !== stateOcdId) continue;
    const label = seat[1] === "cd" ? `${hit.state}-${seat[2]}` : hit.label;
    divisions.set(hit.ocdId, { ocdId: hit.ocdId, label, tier: hit.tier });
  }
  if (stateOcdId) divisions.set(stateOcdId, { ocdId: stateOcdId, label: `${district.state} statewide`, tier: "state" });
  return [...divisions.values()];
}

export function districtSubject(
  district: DistrictHit,
  allMeetings: Meeting[] = [],
  coverage: CoverageSummary | null = null,
  resolvedById: Record<string, DivisionRepresentation> = {},
  hits: readonly DistrictHit[] = [],
): ModalSubject {
  const resolved = resolvedById[district.ocdId];
  const vacancy = resolved?.vacancy ?? coverage?.seats.find(seat => seat.ocdId === district.ocdId)?.vacancy;
  // A county card accepts its exact published ID and child jurisdictions
  // whose OCD path names this county. A same-state match or a missing ID
  // cannot establish county ownership.
  const isCounty = /\/county:[^/]+$/.test(district.ocdId);
  const meetings = allMeetings
    .filter((m) =>
      isCounty
        ? tierForMeeting(m) === "local" && (m.ocdId === district.ocdId || m.ocdId?.startsWith(`${district.ocdId}/`))
        : m.ocdId === district.ocdId,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  // This answer belongs to the selected division; the point's other seats
  // are grouped separately below.
  const roster = resolved?.holders ?? representationForDivision(coverage, district.ocdId);
  const spotRepresentation = spotDivisionsFor(district, hits).map(division => {
    const answer = resolvedById[division.ocdId];
    return {
      ...division,
      holders: answer?.holders ?? representationForDivision(coverage, division.ocdId),
      rosterGaps: answer?.rosterGaps ?? projectedRosterGapsForDivision(coverage, division.ocdId),
      vacancy: answer?.vacancy ?? coverage?.seats.find(seat => seat.ocdId === division.ocdId)?.vacancy,
      note: representationNoteFor(division.tier, answer ? noteStateFor(answer.status) : "gap", answer?.vacancy ?? coverage?.seats.find(seat => seat.ocdId === division.ocdId)?.vacancy),
    };
  });
  return {
    // The division's own ocd-id.
    subjectId: district.ocdId,
    subjectKind: "BODY" as const,
    title: district.label,
    subtitle: `${district.typeLabel} · ${district.state}`,
    tier: district.tier,
    // Congressional, state-senate and state-house answer false.
    divisionKind: district.type,
    facts: [
      // No OCD-ID row: internal identifiers never render to readers.
      { label: "Type", value: district.typeLabel },
      { label: "Tier", value: TIER_LABEL[district.tier] },
      { label: "State", value: district.state, mono: true },
      /* Every distinct governing body's own site; none is elected to speak for the division. */
      ...bodyHomepageFacts(coverage, district.ocdId),
    ],
    /* The office title comes from the division's type, so vacant seats still get the explainer. */
    divisionOcdId: district.ocdId,
    representedByOfficeTitle: officeTitleForDivision(district.ocdId),
    representation: roster,
    vacancy,
    spotRepresentation,
    rosterGaps: resolved?.rosterGaps ?? projectedRosterGapsForDivision(coverage, district.ocdId),
    representationNote: representationNoteFor(
      district.tier,
      resolved ? noteStateFor(resolved.status) : "gap",
      vacancy,
    ),
    meetings,
    /* Built from the same rows the card renders. */
    sources: [...districtCardSources([...roster, ...spotRepresentation.flatMap(division => division.holders)], meetings),
      ...[...new Map([vacancy, ...spotRepresentation.map(division => division.vacancy)].flatMap(row => row ? [[row.ocdId, row] as const] : [])).values()]
        .map(row => ({ what: "Seat vacancy", provenance: { sourceUrl: row.sourceUrl, sourceOrg: row.sourceOrg, collectedAt: row.collectedAt, verifiedAt: row.collectedAt } }))],
  };
}

/**
 * Each held body's own website as an Overview row. No `homepageUrl`, no row.
 */
function bodyHomepageFacts(
  coverage: CoverageSummary | null,
  ocdId: string,
): { label: string; value: React.ReactNode }[] {
  /* Deduped on the rendered host, since stored URLs differ by `www.`, slash or path. */
  const seen = new Set<string>();
  const rows: { label: string; value: React.ReactNode }[] = [];
  for (const body of coverage?.bodies ?? []) {
    if (body.ocdId !== ocdId || !body.homepageUrl) continue;
    let host: string;
    try {
      host = new URL(body.homepageUrl).hostname.replace(/^www\./, "");
    } catch {
      // A malformed stored URL renders no row rather than a broken link.
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    rows.push({
      label: "Official site",
      value: (
        <a
          href={body.homepageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {host} →
        </a>
      ),
    });
  }
  return rows;
}

/**
 * The office that represents a division, from its OCD-ID segment. Null for
 * segments with no representative (county, place): no explainer renders.
 */
function officeTitleForDivision(ocdId: string): string | null {
  if (/\/cd:[^/]+$/.test(ocdId)) return "U.S. Representative";
  if (/\/sldu:[^/]+$/.test(ocdId)) return "State Senator";
  if (/\/sldl:[^/]+$/.test(ocdId)) return "State Representative";
  if (/\/school_district:[^/]+$/.test(ocdId)) return "School Board Member";
  return null;
}
