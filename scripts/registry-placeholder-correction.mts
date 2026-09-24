/**
 * `pnpm registry:placeholder-correction -- --reviewed-by="<owner>" --out=<absolute path>`
 *
 * Builds, and proves before anything is written, the owner-reviewed registry
 * correction for the two school boards minted on Census "no district here"
 * placeholders (Arizona 0499997, New Hampshire 3399997), which also names New
 * Hampshire's placeholder in plain words (Sean, 2026-09-23).
 *
 * READ-ONLY toward production. It reads the live registry through the
 * read-only role (WTP_PRODUCTION_DATABASE_URL_READONLY), fetches the exact
 * Census directory the placeholder divisions cite, builds a package that
 * re-reviews only those divisions, and runs the plane's own validator against
 * the live base. It writes one file, the package, and only on a GOOD verdict.
 * The promotion is the owner's, from the installed runtime:
 *
 *   pnpm registry:promote -- --promote --package=<the same absolute path>
 *
 * It needs the code that carries the rule installed there (merged, deployed,
 * and picked up by the runtime): the owner door that builds on the
 * transfer-time import, and the plane's placeholder removal contract.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { config as loadEnv } from "dotenv";

import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { CENSUS_PLACEHOLDER_LABELS, isCensusPlaceholderDivision } from "../lib/registry/census-placeholders.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, type RegistryRuntimePackage } from "../lib/registry/runtime-data-plane.ts";
import { assignment } from "./cli-args.mts";

loadEnv({ path: join(process.cwd(), ".env.local") });

async function main(): Promise<void> {
  const reviewedBy = assignment(process.argv, "reviewed-by")?.trim();
  const out = assignment(process.argv, "out");
  if (!reviewedBy) throw new Error("Pass --reviewed-by=<the owner who reviews this receipt>.");
  if (!out || !isAbsolute(out)) throw new Error("Pass --out=<absolute path>; the installed runtime reads the package from another directory.");
  const readOnly = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!readOnly) throw new Error("WTP_PRODUCTION_DATABASE_URL_READONLY is not set; this builder reads production only through the read-only role.");
  process.env.DATABASE_URL = readOnly;
  const store = new PostgresRoutineDataStore();

  const prior = await readRegistryRuntimePrior(store, new Date().toISOString());
  if (!prior) throw new Error("No registry version is promoted; there is nothing to correct.");
  const placeholders = prior.payload.registry.divisions.filter((division) => isCensusPlaceholderDivision(division));
  const cited = [...new Set(placeholders.map((division) => division.provenance?.sourceUrl ?? ""))];
  if (placeholders.length === 0 || cited.length !== 1 || !/^https:\/\//.test(cited[0]!)) {
    throw new Error(`The live registry holds ${placeholders.length} placeholder division(s) citing ${JSON.stringify(cited)}; expected them under one Census directory.`);
  }
  const census = cited[0]!;
  const response = await fetch(census, { redirect: "follow" });
  const bytes = Buffer.from(await response.arrayBuffer());
  const retrievedAt = new Date().toISOString();
  if (!response.ok || bytes.length === 0) throw new Error(`${census} answered HTTP ${response.status} with ${bytes.length} bytes; a receipt needs the exact bytes.`);

  const reviewedAt = new Date().toISOString();
  const pkg: RegistryRuntimePackage = {
    contractId: "registry-runtime-bindings",
    version: reviewedAt,
    sourceThrough: retrievedAt,
    payload: {
      ...prior.payload,
      registry: {
        generatedAt: prior.payload.registry.generatedAt,
        divisions: placeholders.map((division) => ({ ...division, label: CENSUS_PLACEHOLDER_LABELS[division.label] ?? division.label })),
        bodies: [],
      },
      bodyRosters: [],
      rosterReaderDispositions: [],
      statewideExecutives: [],
      officialCandidacies: { ...prior.payload.officialCandidacies, rows: [] },
      officialPhotos: { photos: [] },
      rosterPhotos: {},
    },
    sourceReceipt: {
      contractVersion: 1,
      reviewedAt,
      reviewedBy,
      sources: [{
        requestedUrl: census,
        finalUrl: response.url || census,
        publisher: "U.S. Census Bureau",
        sourceClass: "OFFICIAL_PUBLISHER",
        retrievedAt,
        httpStatus: response.status,
        rawHash: createHash("sha256").update(bytes).digest("hex"),
        reviewedEvidence: `The Census cartographic boundary directory every registry division cites. Its unified school district layers code land inside no unified district as LEA 99997, "School District Not Defined": ${placeholders.map((division) => `${division.state} ${division.geoid ?? division.ocdId}`).join(", ")}. No board meets for it, so no body is registered on it.`,
      }],
    },
  };

  const candidate = registryRuntimeCandidate(pkg, { prior });
  const lkg = await store.readCandidate(prior.versionId);
  const changeSet = candidateChangeSet(candidate, prior.payload);
  const verdict = validateRoutineCandidate({ ...candidate, changeSet }, lkg, reviewedAt).receipt;
  const failing = verdict.checks.filter((check) => check.verdict !== "PASS");
  console.log(JSON.stringify({
    base: prior.versionId,
    baseIsTransferImport: lkg?.candidate.bootstrapImport?.kind === "TRUSTED_LKG_IMPORT",
    census: { url: census, finalUrl: response.url || census, status: response.status, bytes: bytes.length },
    removed: changeSet.removed.map((delta) => delta.key),
    changed: changeSet.changed.map((delta) => delta.key),
    added: changeSet.added.map((delta) => delta.key),
    inheritedFromBase: candidate.manualPriorAuthority?.retainedMembers.length ?? 0,
    violations: candidate.semantics.violations,
    decision: verdict.decision,
    failing,
  }, null, 2));
  if (verdict.decision !== "GOOD") {
    process.exitCode = 1;
    console.error("The plane would refuse this correction; no package was written.");
    return;
  }
  writeFileSync(out, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`\nPackage written: ${out}\nPromote it, as the owner: pnpm registry:promote -- --promote --package=${out}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
