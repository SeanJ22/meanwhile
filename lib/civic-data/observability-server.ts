import "server-only";

import type { RoutineObservabilityRead } from "./observability.ts";
import { readRoutineDataObservabilityFromConnection } from "./observability-store.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { observableRoutineContracts } from "./meeting-partitions.ts";
import { projectPublicationStatus, type PublicationStatusRead } from "./publication-status.ts";
import { readPublicationStatusRows } from "./publication-status-store.ts";
import type { DoorRepository } from "../doors/registry.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";

export const ADMIN_PUBLICATION_STATUS_STATEMENT_TIMEOUT_MS = 4_000;

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

/** Bounded server-side: unbounded, the selection runs for minutes and returns gigabytes. */
export const ADMIN_ROUTINE_READ_STATEMENT_TIMEOUT_MS = 1_500;

/** Server-only: the connection value never crosses the data-access boundary. */
export async function readRoutineDataObservability(
  options: { readonly now?: string } = {},
): Promise<RoutineObservabilityRead> {
  let doors: DoorRepository | undefined;
  const url = controlPlaneUrlFromEnv();
  if (url) {
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
