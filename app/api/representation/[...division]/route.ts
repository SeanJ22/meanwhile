import { READER_MANIFEST_CACHE_TAG } from "@/lib/meetings/edge-blob-store";
import { stageTimer } from "@/lib/api/server-timing";
import {
  ensureReaderAuthorityEdge,
  readReaderAuthorityManifest,
  READER_MAP_AUTHORITY_FAMILIES,
} from "@/lib/meetings/edge-serving";
import { rosterGapsForDivision } from "@/lib/registry/body-rosters";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { divisionsByOcdIds, prefetchReaderGeography, seatHoldersForDivision } from "@/lib/registry/server";

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
  const manifest = await timing.time("manifest", () => readReaderAuthorityManifest().catch(() => null));
  if (manifest?.authorityArtifacts) {
    const edge = await timing.time("authority", () =>
      ensureReaderAuthorityEdge(manifest, undefined, READER_MAP_AUTHORITY_FAMILIES).catch(() => null),
    );
    if (edge) enterReaderAuthorityEdge(edge);
  }

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
  const holders = seats;
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
