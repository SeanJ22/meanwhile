import { RouteCard } from "@/components/shell/route-card";

export default function BallotCardLoading() {
  return (
    <RouteCard kicker="Ballot">
      <p className="mw-loading-inline" role="status" aria-live="polite">
        Finding what&apos;s on the ballot…
      </p>
    </RouteCard>
  );
}
