/**
 * **FLEET · IS IT LEARNING.** (Admin redesign, 2026-09-23.) Six fair
 * questions, and what the records can say about each today.
 */
import type { SearchParams } from "../../_mw/page-base.ts";
import { LearningScreen } from "../../_mw/screens/learning.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default function FleetLearningPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <LearningScreen searchParams={searchParams} />;
}
