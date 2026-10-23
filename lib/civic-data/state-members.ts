import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NhMemberReadModel } from "./candidate-builders.ts";
import { readPromotedOrBootstrap, type CivicDataBootstrap, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { requiredRoutineContract, routineFreshnessMs } from "./contracts.ts";

const NH_CONTRACT = requiredRoutineContract("nh-members");
const NH_SCOPE = NH_CONTRACT.scope;

function validateNhMembers(payload: NhMemberReadModel, versionId: string): void {
  if (
    payload.formatVersion !== 1 ||
    payload.jurisdiction !== "US-NH" ||
    !Array.isArray(payload.members) ||
    !Array.isArray(payload.identities) ||
    payload.identities.length !== payload.members.length ||
    payload.identities.some((identity) => !identity.officeholderId.startsWith("nh-general-court:"))
  ) {
    throw new Error(`NH member projection ${versionId} does not satisfy the Reader contract.`);
  }
}

interface TrackedNhMembers {
  readonly source: { readonly collectedAt: string };
  readonly members: NhMemberReadModel["members"];
}

async function nhMembersBootstrap(): Promise<CivicDataBootstrap<NhMemberReadModel>> {
  const {expectedNhMembersTerm,trustedNhMembersImportReadModel} = await import("./candidate-builders.ts");
  const corpus = JSON.parse(
    readFileSync(join(process.cwd(), "data/states/nh/hunt/nh-gencourt-members.json"), "utf8"),
  ) as TrackedNhMembers;
  const sourceThrough = corpus.source.collectedAt;
  const value = trustedNhMembersImportReadModel(
    corpus.members,
    expectedNhMembersTerm(sourceThrough),
  );
  return {
    value,
    sourceId: NH_CONTRACT.sourceId,
    version: value.term,
    versionId: `bootstrap:nh-members:${sourceThrough}`,
    sourceThrough,
    retrievedAt: `${sourceThrough}T00:00:00.000Z`,
    detail: "Bundled NH General Court bootstrap selected only because the canonical store answered with no promoted pointer.",
  };
}

/** Typed NH roster read outcome; a store failure never opens the tracked corpus. */
export async function readNhMembers(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<NhMemberReadModel>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedOrBootstrap({
    ...options,
    now,
    recordClass: "STATE_LEGISLATOR",
    scope: NH_SCOPE,
    maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(NH_CONTRACT.id, now),
    bootstrap: nhMembersBootstrap,
    allowUnconfiguredBootstrap: process.env.NODE_ENV !== "production",
  });
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateNhMembers(result.value, result.metadata.versionId ?? result.kind);
  }
  return result;
}
