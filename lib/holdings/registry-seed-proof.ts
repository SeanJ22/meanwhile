import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const REGISTRY_FIRST_SEED = "lib/registry/registry.json";
export const CURATED_BODY_SEED = "lib/registry/curated-bodies.ts";

/** build-registry appends CURATED_BODIES verbatim to bodies. No other
 * holding has demonstrated this encoding. A shared division is not a body,
 * and a matching body identity is not proof of its fields or provenance. */
export function curatedRegistrySeedProblems(input: {
  holdingPath: string;
  family: string;
  artifactPath: string;
  artifactBytes: Buffer;
  artifactSha256: string;
  artifactTraced: boolean;
  records: readonly { auditId: string; value: Record<string, unknown> }[];
}): string[] {
  if (input.holdingPath !== CURATED_BODY_SEED || input.family !== "curated-body-identities") return ["Holding has no demonstrated registry-first-seed encoding"];
  if (input.artifactPath !== REGISTRY_FIRST_SEED || !input.artifactTraced || createHash("sha256").update(input.artifactBytes).digest("hex") !== input.artifactSha256) return ["Registry first-seed artifact is not byte-bound to the delivered holding"];
  let seed: { bodies?: unknown };
  try { seed = JSON.parse(input.artifactBytes.toString("utf8")); }
  catch { return ["Registry first-seed artifact is not valid JSON"]; }
  if (!seed || !Array.isArray(seed.bodies)) return ["Registry first-seed has no bodies collection"];
  if (!input.records.length) return ["Curated holding has no applicable records to prove"];
  const problems: string[] = [];
  for (const { auditId, value } of input.records) {
    if (typeof value.id !== "string" || !value.id || value.bodyOrigin !== "CURATED") { problems.push(`${auditId}: invalid curated body record`); continue; }
    const matches = seed.bodies.filter((body) => body && typeof body === "object" && body.id === value.id);
    if (matches.length !== 1) { problems.push(`${auditId}: expected exactly one matching body, found ${matches.length}`); continue; }
    for (const key of Object.keys(value)) {
      // loadManifestContext adds this top-level census classification after
      // reading the module. It is not a held body field and build-registry
      // does not encode it. No other field or nested metadata is exempt.
      if (key === "_manifestStateCodes") continue;
      if (!isDeepStrictEqual(matches[0][key], value[key])) problems.push(`${auditId}: delivered body differs at ${key}`);
    }
  }
  return problems;
}
