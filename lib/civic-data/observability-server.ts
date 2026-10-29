import "server-only";

import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { observableRoutineContracts } from "./meeting-partitions.ts";
import { projectPublicationStatus, type PublicationStatusRead } from "./publication-status.ts";
import { readPublicationStatusRows, readPublicationCounts } from "./publication-status-store.ts";
import { databaseReadOnlySql } from "../reader/database.ts";

export const ADMIN_PUBLICATION_STATUS_STATEMENT_TIMEOUT_MS = 4_000;

export async function readRoutinePublicationCounts(): Promise<{ readonly total: number; readonly readBack: number } | null> {
  const connection = process.env.DATABASE_URL?.trim();
  return connection ? readPublicationCounts(databaseReadOnlySql(connection, ADMIN_PUBLICATION_STATUS_STATEMENT_TIMEOUT_MS),
    [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS]) : null;
}

export async function readRoutinePublicationStatus(): Promise<PublicationStatusRead> {
  const connection = process.env.DATABASE_URL?.trim() ?? "";
  if (connection === "") {
    return { kind: "NOT_CONNECTED", detail: "This Admin runtime has no routine civic-data store connection; nothing was read." };
  }
  try {
    const contracts = [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS];
    const rows = await readPublicationStatusRows(connection, ADMIN_PUBLICATION_STATUS_STATEMENT_TIMEOUT_MS, contracts);
    return {
      kind: "HELD",
      asOf: new Date().toISOString(),
      view: projectPublicationStatus(contracts, rows),
    };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail: `The narrow publication read could not be completed (${error instanceof Error ? error.name : "unknown error"}). No publication count is claimed.`,
    };
  }
}
