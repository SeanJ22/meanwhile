import "server-only";

import type { RoutineObservabilityRead } from "./observability.ts";
import { readRoutineDataObservabilityFromConnection } from "./observability-store.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { observableRoutineContracts } from "./meeting-partitions.ts";
import { projectPublicationStatus, type PublicationStatusRead } from "./publication-status.ts";
import { readPublicationStatusRows } from "./publication-status-store.ts";
import { doorReadModeFromEnv } from "../doors/install.ts";
import type { DoorRepository } from "../doors/registry.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";

/** The narrow publication read's per-statement limit: pointers, latest attempts, readbacks; no payload. */
export const ADMIN_PUBLICATION_STATUS_STATEMENT_TIMEOUT_MS = 4_000;

/**
 * Published versus reader-visible, per routine contract, from narrow evidence
 * (`publication-status.ts`). Measured against production on 2026-09-23 at
 * about 3 s and 2 MB. Any failure is a named unread state, never zero counts.
 */
export async function readRoutinePublicationStatus(): Promise<PublicationStatusRead> {
  const connection = process.env.DATABASE_URL?.trim() ?? "";
  if (connection === "") {
    return { kind: "NOT_CONNECTED", detail: "This Admin runtime has no routine civic-data store connection; nothing was read." };
  }
  try {
    const rows = await readPublicationStatusRows(connection, ADMIN_PUBLICATION_STATUS_STATEMENT_TIMEOUT_MS);
    return {
      kind: "HELD",
      asOf: new Date().toISOString(),
      view: projectPublicationStatus([...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS], rows),
    };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `The narrow publication read could not be completed (${error instanceof Error ? error.name : "unknown error"}). No publication count is claimed.`,
    };
  }
}

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
  // DB-14: with the doors switch on, a door added as data is listed here.
  // Without it, or when the registry cannot be opened, the code's list is used.
  let doors: DoorRepository | undefined;
  const url = controlPlaneUrlFromEnv();
  if (doorReadModeFromEnv() === "registry" && url) {
    try { doors = (await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })).doors; } catch { doors = undefined; }
  }
  return readRoutineDataObservabilityFromConnection(process.env.DATABASE_URL, {
    ...options,
    ...(doors ? { doors } : {}),
    statementTimeoutMs: ADMIN_ROUTINE_READ_STATEMENT_TIMEOUT_MS,
    currentReaderBuild: {
      codeSha: process.env.WTP_BUILD_COMMIT ?? null,
      branch: process.env.WTP_BUILD_BRANCH ?? null,
      context: process.env.WTP_BUILD_CONTEXT ?? null,
    },
  });
}
