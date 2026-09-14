/**
 * The committed `/admin/fleet` page's server-side FIRST read.
 *
 * **Server-only.** It pulls the fleet read service (`readFleetOperations` →
 * `admin-data` → `pg-store` → `node:fs`) and is imported ONLY by the page (a
 * server component) and by tests — never by the client panel, whose bundle must
 * stay free of the filesystem.
 *
 * The read is folded through the SAME consumer projection (`applyRefresh`) a
 * client Refresh uses, so a server-rendered first paint and a later on-demand
 * refresh cannot disagree about how a report is interpreted. Dependencies are
 * injectable — the exact shape the real GET handler (`handleFleetOperationsRequest`)
 * accepts — so the actual page composition can be exercised with isolated
 * repositories, a temporary receipt root and a fixture clock. In the served path
 * NO store is injected: `readFleetOperations` reads receipt loading from the
 * existing control-plane OWNER SNAPSHOT (`OwnerSnapshot.fleetReceipts`, Fleet's
 * `e174e219` transport), so this first paint and the endpoint Refresh read the
 * SAME snapshot. The optional `receiptStore` seam is kept only for runner/isolated
 * tests that supply a trusted filesystem store directly.
 */

import type { openControlPlane } from "@/lib/control-plane/admin-data";
import { readFleetOperations } from "@/lib/control-plane/fleet-operations";
import type { FleetReceiptStore } from "@/lib/control-plane/fleet-receipt-store";
import {
  applyRefresh,
  EMPTY_CONSUMER_STATE,
  type FleetConsumerState,
} from "@/lib/admin/fleet-operations-view";

export async function readFleetSeedState(deps: {
  readonly open: typeof openControlPlane;
  /** Optional. The served page omits it (mounting the fs store over-traces the
   *  bundle) and receipt loading then comes from the owner snapshot; when absent
   *  AND the snapshot has no extension, receiptLoading is NOT_RECORDED. Tests
   *  inject a real store to exercise the filesystem loader directly. */
  readonly receiptStore?: FleetReceiptStore;
  readonly now: () => string;
}): Promise<FleetConsumerState> {
  const observedAt = deps.now();
  const opened = await deps.open();
  if (!opened.ok) {
    // A missing control plane is a stated fact, never an empty success.
    return applyRefresh(EMPTY_CONSUMER_STATE, { status: "CONTROL_PLANE_UNAVAILABLE", observedAt, detail: opened.detail });
  }
  const report = await readFleetOperations(opened.repos, { observedAt, receiptStore: deps.receiptStore });
  return applyRefresh(EMPTY_CONSUMER_STATE, { status: "REPORT", report });
}
