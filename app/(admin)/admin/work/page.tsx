/**
 * **FLEET · WORK.** (Admin redesign, 2026-09-23.) The composer and the one
 * list of assignments; the same screen as Readiness · Work and instructions.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { WorkScreen } from "../../_mw/screens/work.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function FleetWorkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <WorkScreen area="fleet" searchParams={searchParams} />;
}
