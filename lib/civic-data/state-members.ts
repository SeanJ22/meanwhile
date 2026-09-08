import { promotedReadModel } from "./read-model.ts";
import type { NhMemberReadModel } from "./candidate-builders.ts";

/** One promoted official state-member projection; never acquisition staging. */
export async function promotedNhMembers(): Promise<{ versionId: string; data: NhMemberReadModel } | null> {
  const projection = await promotedReadModel<NhMemberReadModel>("STATE_LEGISLATOR", "US-NH");
  if (!projection) return null;
  if (projection.payload.formatVersion !== 1 || projection.payload.jurisdiction !== "US-NH" || !Array.isArray(projection.payload.members)) {
    throw new Error(`Promoted NH member projection ${projection.versionId} does not satisfy the Reader contract.`);
  }
  return { versionId: projection.versionId, data: projection.payload };
}

