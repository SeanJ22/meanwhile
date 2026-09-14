import "server-only";

import type { RoutineObservabilityRead } from "./observability.ts";
import { readRoutineDataObservabilityFromConnection } from "./observability-store.ts";

/**
 * Server-only production entry point. The connection value never crosses the
 * data-access boundary; only the explicit observation union reaches Admin.
 */
export async function readRoutineDataObservability(
  options: { readonly now?: string } = {},
): Promise<RoutineObservabilityRead> {
  return readRoutineDataObservabilityFromConnection(process.env.DATABASE_URL, {
    ...options,
    currentReaderBuild: {
      codeSha: process.env.WTP_BUILD_COMMIT ?? null,
      branch: process.env.WTP_BUILD_BRANCH ?? null,
      context: process.env.WTP_BUILD_CONTEXT ?? null,
    },
  });
}
