/**
 * **READINESS · COST.** (Admin redesign, 2026-09-23.) The same screen as
 * Fleet · Money, read from the Readiness area — one set of figures.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { MoneyScreen } from "../../_mw/screens/money.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function ReadinessCostPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <MoneyScreen area="readiness" searchParams={searchParams} />;
}
