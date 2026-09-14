/**
 * **FLEET OPERATIONS — the committed, authenticated Admin surface for the fleet
 * operations report.** (Design/integration, 2026-09-13.)
 *
 * Reachable only on `ADMIN_ORIGIN` with a valid session — both enforced upstream
 * in `middleware.ts`, because `/admin` is an admin prefix and `isAdminPath`
 * matches `/admin/fleet` via the `startsWith("/admin/")` clause. The two rules
 * apply exactly as they do to every other admin page: on the PUBLIC host the path
 * is a bare 404 (a prober is told nothing), and on the ADMIN host an
 * unauthenticated PAGE request is redirected to `/admin/login?why=…` before any
 * control-plane data is read (only `/api/admin/*` returns a 401; this page is
 * RSC, not an API route, so it redirects). An operator reaches it by signing in
 * and choosing "Fleet operations" in the console view selector, or by navigating
 * to `/admin/fleet`.
 *
 * ## What this page reads, and when
 *
 * Like every sibling admin page, this is an async server component that opens the
 * control plane and reads ONCE at request time — a read taken because the
 * operator navigated here, never on the 8-second heartbeat pulse (that stays in
 * `app/api/admin/live`). The first read is folded through the SAME consumer
 * projection a client refresh uses (`applyRefresh` in
 * `lib/admin/fleet-operations-view.ts`) and handed to the panel as `initialState`,
 * so a server-rendered first paint and a later client refresh cannot disagree
 * about how a report is interpreted. When the runtime cannot reach the control
 * plane (the deployed web function has no DSN — the same limit `admin/agents`
 * documents), the seed is an honest CONTROL_PLANE_UNAVAILABLE state, not an empty
 * "all clear".
 *
 * The panel's Refresh control then re-reads ON DEMAND through the authenticated
 * `GET /api/admin/fleet/operations` endpoint. All the report's honesty rules are
 * enforced by that shared consumer: each section's typed outcome, HTTP 200 ≠
 * every section measured, publication UNKNOWN, delivery-is-local-not-served,
 * spending-never-$0-when-unknown, next-prerequisite ≠ dispatch, and
 * retain-the-timestamp on a failed refresh.
 *
 * ## ZIP preparation is not mounted here
 *
 * ZIP PREPARATION is deliberately NOT a live feed on this surface: it has no HTTP
 * endpoint. It is offline, side-effect-free planning produced by the fleet
 * services `lib/control-plane/zip-queue.ts` (`fleet/zip-preparation@1`) and
 * `lib/control-plane/zip-acquisition-plan.ts` (`fleet/zip-acquisition-plan@1`),
 * PLAN_ONLY / NOT_AUTHORIZED, and is supplied as committed evidence artifacts
 * under `docs/evidence/`. Rendering those here would present historical planning
 * as live coverage, so this surface names where the data comes from instead. The
 * excluded preview harness (`/lumen-admin-preview`) demonstrates the prepared-queue
 * rendering as clearly-labelled inactive preparation.
 */

import { ConsoleNav } from "@/app/(admin)/console-nav";
import { FleetOperationsMap } from "@/components/admin/fleet-operations-map";
import { openControlPlane } from "@/lib/control-plane/admin-data";
import { US_STATES } from "@/lib/control-plane/readiness/catalog";
import { readFleetSeedState } from "@/lib/admin/fleet-seed";

// The live admin surfaces are never cached — the same route-segment config every
// sibling admin page uses. This fleet console must not be prerendered into a
// stale HTML snapshot, and the read below must run at request time.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Fleet operations",
  robots: { index: false, follow: false, nocache: true },
};

export default async function FleetOperationsPage() {
  // The trusted READER filesystem receipt store is NOT mounted here — mounting it
  // in a served bundle was rebuilt and MEASURED to refuse check-build-output (the
  // store's request-time process.cwd() receipt read is the R23 over-trace shape;
  // Fleet's zero-import leaf did not change that, the trace is the fs read not the
  // import graph). Instead receipt readings arrive through the existing
  // control-plane OWNER SNAPSHOT: with no store injected, readFleetSeedState →
  // readFleetOperations reads OwnerSnapshot.fleetReceipts (Fleet's `e174e219`
  // transport). The OPTIONAL receiptStore seam is preserved for runner/isolated
  // tests, so this first paint and endpoint Refresh read the SAME snapshot —
  // populated/missing page↔Refresh parity is proven in
  // tests/fleet-operations-page.test.ts. See the handoff doc.
  const initialState = await readFleetSeedState({
    open: openControlPlane,
    now: () => new Date().toISOString(),
  });
  return (
    <main className="admin console-page">
      <ConsoleNav view="fleet" currentState={null} states={US_STATES} />

      <h1>Fleet operations</h1>
      <p className="note">
        On-demand read of the fleet operations report. The first read is taken server-side because you
        navigated here; Refresh re-reads on demand through the authenticated endpoint. Neither is the
        heartbeat. Lanes are derived from each work item&rsquo;s task states; a live lease means activity,
        not proven progress.
      </p>
      <FleetOperationsMap initialState={initialState} />

      <h2>ZIP preparation</h2>
      <p className="note">
        ZIP preparation and acquisition planning are offline, side-effect-free fleet services
        (<code>fleet/zip-preparation@1</code>, <code>fleet/zip-acquisition-plan@1</code>), PLAN_ONLY /
        NOT_AUTHORIZED, supplied as committed evidence under <code>docs/evidence/</code>. There is no
        live ZIP-preparation feed, and historical stamps (TIER_0, people:0) are not current coverage.
        Prepared queues are inactive preparation, never scheduled work.
      </p>
    </main>
  );
}
