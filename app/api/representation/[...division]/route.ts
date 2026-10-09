import { stageTimer } from "@/lib/api/server-timing";
import {
  ensureReaderAuthorityEdge,
  readReaderManifest,
  READER_MANIFEST_CACHE_TAG,
  READER_MAP_AUTHORITY_FAMILIES,
} from "@/lib/meetings/edge-serving";
import { governingRosterHoldersForDivision, rosterGapsForDivision } from "@/lib/registry/body-rosters";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { divisionsByOcdIds, prefetchReaderGeography, seatHoldersForDivision } from "@/lib/registry/server";

/**
 * GET /api/representation/ocd-division/country:us/state:<st>/sldl:<n>
 *
 * Who holds a division's seats, keyed by the division, with its `label`, `divisionType` and `tier` (`null`
 * where the registry does not hold it). The division is the path, so every cache keys on it; the answer is
 * public and CDN-held on the same terms as `/api/meetings`, and the refused shape stays `no-store`.
 */

export const runtime = "nodejs";

const CDN_HELD = {
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=3600",
  "Netlify-Cache-Tag": READER_MANIFEST_CACHE_TAG,
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;

/** The identifier shape, refused rather than guessed at. */
const OCD_ID = /^ocd-division\/country:us(\/[a-z_]+:[A-Za-z0-9~._-]+)+$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ division: string[] }> },
) {
  const { division } = await context.params;
  const ocdId = division.map((segment) => decodeURIComponent(segment)).join("/");

  if (!OCD_ID.test(ocdId)) {
    // Not an OCD-ID. An empty answer in the same shape, and the client
    // renders its named gap — never a failure dressed as an absence.
    return Response.json(
      { ocdId: null, label: null, divisionType: null, tier: null, holderStatus: "HOLDING_UNAVAILABLE", holders: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const timing = stageTimer();
  // The registry load reads the committed geometry too; start it beside the edge fetch.
  prefetchReaderGeography();
  // The reader authority edge, entered in this handler's own execution
  // before any edge-aware read below (see the header note).
  const manifest = await timing.time("manifest", () => readReaderManifest().catch(() => null));
  if (manifest?.authorityArtifacts) {
    const edge = await timing.time("authority", () =>
      ensureReaderAuthorityEdge(manifest, undefined, READER_MAP_AUTHORITY_FAMILIES).catch(() => null),
    );
    if (edge) enterReaderAuthorityEdge(edge);
  }

  // Both stores, the same two the shared resolver reads: legislative seats
  // off the officeholder index, local governing bodies off the curated
  // rosters. Asked by division key, so neither depends on where the reader is.
  const seats = await timing.time("holders", () => seatHoldersForDivision(ocdId));

  // Division labels and roster gaps are separate from a sourced person's identity. A registry
  // failure leaves that metadata unavailable while held legislative people still reach the card.
  const metadata = await timing.time("division", async () => {
    try {
      const [known] = await divisionsByOcdIds([ocdId]);
      return { known, rosterGaps: rosterGapsForDivision(ocdId), available: true };
    } catch {
      return { known: undefined, rosterGaps: [], available: false };
    }
  });
  const holders = seats.length > 0 ? seats : metadata.available ? governingRosterHoldersForDivision(ocdId) : [];
  const { known } = metadata;

  return Response.json(
    {
      ocdId,
      label: known?.label ?? null,
      divisionType: known?.divisionType ?? null,
      tier: known?.tier ?? null,
      holderStatus: holders.length > 0 ? "HELD"
        : !metadata.available || /\/(?:sldu|sldl):/.test(ocdId) ? "HOLDING_UNAVAILABLE" : "NOT_RECORDED",
      holders,
      rosterGaps: metadata.rosterGaps,
      metadataStatus: metadata.available ? "HELD" : "HOLDING_UNAVAILABLE",
    },
    {
      headers: { ...(metadata.available ? CDN_HELD : { "Cache-Control": "no-store" }), "Server-Timing": timing.header() },
    },
  );
}
