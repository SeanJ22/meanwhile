/**
 * **SYSTEM MAP — the Target Operating Model**, the committed, authenticated Admin
 * surface for the architecture explainer. (Design/integration, 2026-09-13.)
 *
 * Guarded exactly like every sibling admin page by `middleware.ts` (bare 404 on the
 * public host; login redirect on the admin host without a session). Unlike the other
 * admin surfaces this page reads NOTHING — no control plane, no receipt store, no
 * owner snapshot. It is a static, illustrative description of how the system should
 * behave at full effectiveness (`lib/admin/system-map-model.ts`), and it authorises
 * no backend change. Live status belongs to the Fleet operations overlay
 * (`/admin/fleet`); this surface says so on its own banner rather than implying it.
 */

import { ConsoleNav } from "@/app/(admin)/console-nav";
import { SystemMap } from "@/components/admin/system-map";
import { US_STATES } from "@/lib/control-plane/readiness/catalog";

export const metadata = {
  title: "System map",
  robots: { index: false, follow: false, nocache: true },
};

export default function SystemMapPage() {
  return (
    <main className="admin console-page">
      <ConsoleNav view="system-map" currentState={null} states={US_STATES} />
      <SystemMap />
    </main>
  );
}
