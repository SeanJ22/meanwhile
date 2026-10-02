/**
 * **A CROSSWALK'S EVIDENCE, HELD IN THE VAULT BEFORE THE CROSSWALK IS PROMOTED.** (C16, 2026-09-24.)
 *
 *   node --experimental-strip-types scripts/vault-crosswalk-evidence.mts --package=<crosswalk package.json> --evidence=<dir>
 *     [--vault=<vault root, default data/control-plane/vault>]
 *
 * Rulings §3 verification asks for saved evidence: vaulted bytes plus the sha256 of the government's own page naming
 * the body ("C16" was a session label, not Sean's decision: Sean, 2026-10-01). The reviewing agent runs this in the standing runtime's checkout, beside the manual
 * promotion of the same package: for every row, the page naming the body and the calendar are found in the
 * evidence folder by their cited sha256 (a file whose bytes do not hash to the citation is never used), and put
 * into the runtime vault under the work item `crosswalk-evidence:<sha256>`. A page carrying a credential is held
 * as its sanitized derivative, never raw, filed under the raw page's sha256 so the derived wiring can find it.
 *
 * It writes the local evidence vault only: no database, no repository file, no network.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import type { ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { deriveSanitized, recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { crosswalkEvidenceWorkItem, READ_ONLY_VAULT_PROJECT } from "../lib/control-plane/evidence/read-only-vault.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { assignment } from "./cli-args.mts";

const packagePath = assignment(process.argv, "package");
const evidenceDir = assignment(process.argv, "evidence");
if (!packagePath || !evidenceDir) {
  throw new Error("usage: scripts/vault-crosswalk-evidence.mts --package=<crosswalk package.json> --evidence=<dir> [--vault=<root>]");
}
const vaultRoot = resolve(assignment(process.argv, "vault") ?? join("data", "control-plane", "vault"));
const pkg = JSON.parse(readFileSync(resolve(packagePath), "utf8")) as ManualProjectionPackage;
if (pkg.contractId !== "meeting-body-crosswalk") throw new Error(`CROSSWALK_PACKAGE_EXPECTED:${pkg.contractId}`);
const rows = (pkg.payload as { records?: unknown[] }).records ?? [];

/* Every evidence file, by the sha256 of its exact bytes. */
const byHash = new Map<string, Buffer>();
for (const name of readdirSync(resolve(evidenceDir))) {
  const bytes = readFileSync(join(resolve(evidenceDir), name));
  byHash.set(createHash("sha256").update(bytes).digest("hex"), bytes);
}

const store = new DurableEvidenceStore(vaultRoot);
const now = new Date().toISOString();
let held = 0;
for (const value of rows) {
  const issue = crosswalkRowIssue(value);
  if (issue !== null) throw new Error(`CROSSWALK_ROW_INVALID: ${issue}`);
  const row = value as MeetingBodyCrosswalkRow;
  for (const [what, cited, url, contentType] of [
    ["the page naming the body", row.evidence.bodyPage.sha256, row.evidence.bodyPage.url, "text/html"],
    ["the calendar", row.evidence.calendar.sha256, row.evidence.calendar.url, row.kind === "ICAL" ? "text/calendar" : "text/html"],
  ] as const) {
    const bytes = byHash.get(cited);
    if (bytes === undefined) throw new Error(`CROSSWALK_EVIDENCE_MISSING: ${row.id}: no file in ${evidenceDir} hashes to ${what}'s ${cited}`);
    const body = bytes.toString("utf8");
    const { artifact } = recordAcquisition({
      canonicalUrl: url,
      retrievedAt: row.evidence.readAt,
      httpStatus: 200,
      contentType,
      sourceId: "meeting-body-crosswalk",
      methodRouteId: "crosswalk:evidence",
      workItemId: crosswalkEvidenceWorkItem(cited),
      attemptId: `crosswalk:${row.id}`,
      permission: "ALLOWED",
      transport: "REACHABLE",
    }, body);
    if (artifact.contentHash !== `sha256-${cited}`) throw new Error(`CROSSWALK_EVIDENCE_NOT_BYTE_EXACT: ${row.id}: ${what} does not round-trip as text`);
    const kept = artifact.tier === "RESTRICTED_RAW" ? deriveSanitized(artifact, body, now) : null;
    const target = kept?.artifact ?? artifact;
    const { key, written } = await putArtifact(store, READ_ONLY_VAULT_PROJECT, target, Buffer.from(kept?.text ?? body, "utf8"));
    held += 1;
    console.log(`${row.id}: ${what} held as ${target.tier} ${target.id} (${written ? "written" : "already held"}) at ${key}`);
  }
}
console.log(`CROSSWALK_EVIDENCE_VAULTED=${JSON.stringify({ package: resolve(packagePath), rows: rows.length, held, vaultRoot })}`);
