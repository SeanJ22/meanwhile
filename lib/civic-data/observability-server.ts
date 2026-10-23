import "server-only";

import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { observableRoutineContracts } from "./meeting-partitions.ts";
import { projectPublicationStatus, type PublicationStatusRead } from "./publication-status.ts";
import { readPublicationStatusRows } from "./publication-status-store.ts";

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
