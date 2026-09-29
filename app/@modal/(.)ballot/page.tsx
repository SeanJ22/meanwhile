import BallotPage from "@/app/ballot/page";
import { RouteCard } from "@/components/shell/route-card";

// The same runtime as the page it renders (segment config cannot be re-exported).
export const runtime = "nodejs";

/**
 * APPROVED READER DESIGN (2026-09-28) — Ballot opens as the one large card
 * over the map.
 *
 * This intercepts a click on Ballot from the map and renders the SAME server
 * page (`app/ballot/page.tsx`) inside the card frame, so every race, candidate,
 * pick, date, registration link and source is the page's own — nothing is
 * re-implemented. Closing the card is a browser Back to the map, which is
 * still mounted underneath. A direct visit or a reload of /ballot?zip= is the
 * full page, unchanged, so deep links keep working.
 */
export default function BallotCard({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string }>;
}) {
  return (
    <RouteCard kicker="Ballot">
      <BallotPage searchParams={searchParams} />
    </RouteCard>
  );
}
