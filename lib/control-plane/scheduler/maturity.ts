import type { FieldManualRepos } from "../field-manual.ts";
import { readRuntimeMaturity } from "../../method/runtime-manual.ts";

/** Route graduation is an exact disk identity lookup; an unreadable or empty manual still throws. */
export async function methodMaturityFromManual(repos: FieldManualRepos) {
  return readRuntimeMaturity(repos);
}
