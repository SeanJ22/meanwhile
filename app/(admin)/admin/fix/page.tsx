/**
 * **FLEET · FIX LIST.** (Admin redesign, 2026-09-23.) The MW items and the fix queue; the same screen as Readiness · Fix list.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { FixScreen } from "../../_mw/screens/fix.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function FleetFixPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <FixScreen area="fleet" searchParams={searchParams} />;
}
