/** The shared read-only adapter for the canonical post-deploy outcome log. */
import { NEVER_CHECKED } from "../lib/ops/production-integrity.ts";
import {
  CONTROL_PLANE_INTEGRITY_READ_URL_VAR,
  readLatestProductionIntegrity,
  type ProductionIntegrityRead,
} from "../lib/ops/production-integrity-data-plane.ts";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { assertDurableRepositories } from "../lib/control-plane/repository/types.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

export async function readIntegrityAuthority(): Promise<ProductionIntegrityRead> {
  const connection = process.env[CONTROL_PLANE_INTEGRITY_READ_URL_VAR]?.trim() ?? "";
  if (connection === "") {
    const detail = `${CONTROL_PLANE_INTEGRITY_READ_URL_VAR} is not set, so the canonical post-deploy outcome log was not read.`;
    return { kind: "STORE_UNREACHABLE", record: { ...NEVER_CHECKED, detail }, detail };
  }
  try {
    const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
    assertDurableRepositories(repos, "release-freeze post-deploy readback");
    return await readLatestProductionIntegrity(repos.softwareReleaseReviews);
  } catch (error) {
    const detail =
      `The canonical post-deploy outcome log could not be opened ` +
      `(${error instanceof Error ? error.name : "error"}).`;
    return { kind: "STORE_UNREACHABLE", record: { ...NEVER_CHECKED, detail }, detail };
  }
}
