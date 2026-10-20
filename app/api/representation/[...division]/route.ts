import { readerRoute } from "@/lib/api/reader-route";
import { stageTimer } from "@/lib/api/server-timing";
import { readerCacheHeaders, readerCacheScopeForPublication } from "@/lib/reader/cache";
import { rosterGapsForDivision } from "@/lib/registry/body-rosters";
import { representationDivisionMetadata, seatHoldersForDivision } from "@/lib/registry/server";
import { federalDirectoryReadState } from "@/lib/officials/federal-directory-read-model";



export const runtime = "nodejs";

/** The identifier shape, refused rather than guessed at. */
const OCD_ID = /^ocd-division\/country:us(\/[a-z_]+:[A-Za-z0-9~._-]+)+$/;

export const GET = readerRoute("/api/representation/[division]", async function GET(
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

  const seats = await timing.time("holders", () => seatHoldersForDivision(ocdId));

  // Division labels and roster gaps are separate from a sourced person's identity. A registry
  // failure leaves that metadata unavailable while held legislative people still reach the card.
  const metadata = await timing.time("division", async () => {
    try {
      const known = await representationDivisionMetadata(ocdId);
      return { known, rosterGaps: rosterGapsForDivision(ocdId), available: true };
    } catch {
      return { known: undefined, rosterGaps: [], available: false };
    }
  });
  const holders = seats;
  const { known } = metadata;
  const federal = federalDirectoryReadState();
  const vacancy = !holders.length && (federal.kind === "PROMOTED" || federal.kind === "BOOTSTRAP")
    ? federal.value.vacancies?.find(row => row.ocdId === ocdId) : undefined;

  return Response.json(
    {
      ocdId,
      label: known?.label ?? null,
      divisionType: known?.divisionType ?? null,
      tier: known?.tier ?? null,
      holderStatus: holders.length > 0 ? "HELD"
        : !metadata.available || /\/(?:sldu|sldl):/.test(ocdId) ? "HOLDING_UNAVAILABLE" : "NOT_RECORDED",
      holders,
      ...(vacancy ? { vacancy } : {}),
      rosterGaps: metadata.rosterGaps,
      metadataStatus: metadata.available ? "HELD" : "HOLDING_UNAVAILABLE",
    },
    {
      headers: { ...(metadata.available ? readerCacheHeaders({ ...readerCacheScopeForPublication(ocdId), places: [ocdId] })
        : { "Cache-Control": "no-store" }), "Server-Timing": timing.header() },
    },
  );
});
