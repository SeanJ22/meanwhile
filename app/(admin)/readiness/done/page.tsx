/**
 * **READINESS · WHAT COUNTS AS DONE.** (Admin redesign, 2026-09-23.) The
 * standard in force, and the design's slots that have no record yet.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { DoneScreen } from "../../_mw/screens/done.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function ReadinessDonePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <DoneScreen searchParams={searchParams} />;
}
