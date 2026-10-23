import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { GOOGLE_CIVIC_RECORD_CLASS, GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_SCOPE } from "./targets.ts";
import { assertCivicProjection, type CivicProjection } from "./model.ts";

export async function readCivicProjection(scope = GOOGLE_CIVIC_SCOPE, options: PromotedCivicDataReadOptions = {}) {
  const result = await readPromotedCivicData<CivicProjection>(GOOGLE_CIVIC_RECORD_CLASS, scope, options);
  if (result.kind === "PROMOTED") {
    if (result.metadata.sourceId !== GOOGLE_CIVIC_SOURCE_ID) throw new Error("Google Civic pointer names another publisher.");
    assertCivicProjection(result.value);
    if (result.value.kind === "LOOKUP") throw new Error("Stored Google voting answers cannot be used; request a live answer.");
  }
  return result;
}
