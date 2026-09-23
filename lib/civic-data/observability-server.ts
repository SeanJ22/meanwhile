import "server-only";

import type { RoutineObservabilityRead } from "./observability.ts";
import { readRoutineDataObservabilityFromConnection } from "./observability-store.ts";

/**
 * A request-scoped read is bounded server-side. (2026-09-23.) Unbounded, the
 * selection took minutes and returned 3.8 GB, so an Admin page that waited
 * for it timed out whole. Bounded, the page renders and names the routine
 * section as unread.
 */
export const ADMIN_ROUTINE_READ_STATEMENT_TIMEOUT_MS = 1_500;

/**
 * Server-only production entry point. The connection value never crosses the
 * data-access boundary; only the explicit observation union reaches Admin.
 */
export async function readRoutineDataObservability(
  options: { readonly now?: string } = {},
): Promise<RoutineObservabilityRead> {
  return readRoutineDataObservabilityFromConnection(process.env.DATABASE_URL, {
    ...options,
    statementTimeoutMs: ADMIN_ROUTINE_READ_STATEMENT_TIMEOUT_MS,
    currentReaderBuild: {
      codeSha: process.env.WTP_BUILD_COMMIT ?? null,
      branch: process.env.WTP_BUILD_BRANCH ?? null,
      context: process.env.WTP_BUILD_CONTEXT ?? null,
    },
  });
}
