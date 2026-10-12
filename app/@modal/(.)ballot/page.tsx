import BallotPage from "@/app/ballot/page";
import { RouteCard } from "@/components/shell/route-card";

// The same runtime as the page it renders (segment config cannot be re-exported).
export const runtime = "nodejs";

/** Renders the same server page (`app/ballot/page.tsx`) inside the card frame; closing is a browser Back to the map, which stays mounted. */
export default async function BallotCard({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string }>;
}) {
  const { zip } = await searchParams;
  return (
    <RouteCard kicker="Ballot" zip={zip}>
      <BallotPage searchParams={searchParams} />
    </RouteCard>
  );
}
