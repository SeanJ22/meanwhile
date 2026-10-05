import type { NextRequest } from "next/server";

import { loadLearningTrends } from "@/app/(admin)/_mw/data/learning-trends.ts";
import { buildLearningTrends } from "@/lib/control-plane/admin-view/learning-trends.ts";
import { v6LearningView } from "@/lib/control-plane/admin-view/v6-learning-read.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** `admin-v6/learning@1`: the weekly Scout series and single readings behind "Is it learning". Read only; the same for every place. */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const read = await loadLearningTrends(observedAt);
    if (read.kind === "UNREAD") throw new Error(read.detail);
    return {
      contract: "admin-v6/learning@1",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `learning:${observedAt.slice(0, 13)}`,
      asOf: observedAt,
      data: v6LearningView(buildLearningTrends(read.facts.weeks, observedAt), read.facts.doors, read.facts.bankWriteErrors),
      missingParts: [],
    };
  });
}
