/**
 * **READINESS · FIX LIST.** (Admin redesign, 2026-09-23.) The same screen as Fleet · Fix list — one list, one queue.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { FixScreen } from "../../_mw/screens/fix.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function ReadinessFixPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <FixScreen area="readiness" searchParams={searchParams} />;
}
