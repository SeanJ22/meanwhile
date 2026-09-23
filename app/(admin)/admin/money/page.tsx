/**
 * **FLEET · MONEY.** (Admin redesign, 2026-09-23.) Overall spending and the
 * cost of work; the same screen as Readiness · Cost.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { MoneyScreen } from "../../_mw/screens/money.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function FleetMoneyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <MoneyScreen area="fleet" searchParams={searchParams} />;
}
