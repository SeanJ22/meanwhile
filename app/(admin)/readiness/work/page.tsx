/**
 * **READINESS · WORK AND INSTRUCTIONS.** (Admin redesign, 2026-09-23.) The
 * same screen as Fleet · Work — one queue, one set of references.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { WorkScreen } from "../../_mw/screens/work.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function ReadinessWorkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <WorkScreen area="readiness" searchParams={searchParams} />;
}
