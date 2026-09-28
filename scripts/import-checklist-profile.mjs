import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

// Explicit local source import. No network, runtime writes or civic facts.
const source = process.argv[2];
if (!source) throw new Error("Pass the reviewed implementation-package directory.");
const root = resolve(import.meta.dirname, "..");
const register = JSON.parse(readFileSync(join(source, "Requirement-register.json"), "utf8"));
const crosswalk = JSON.parse(readFileSync(join(source, "Scoring-crosswalk-325.json"), "utf8"));
const checklist = readFileSync(join(source, "Checklist-current-baseline.md"));
const sha = createHash("sha256").update(checklist).digest("hex");
if (sha !== crosswalk.sourceSha256 || register.rows.length !== 325 || crosswalk.rows.length !== 325) throw new Error("Checklist source/version/count mismatch.");
const shared = { "REC-17": "REC-08", "REC-18": "REC-09", "REC-19": "REC-10", "MTG-20": "MTG-17" };
const residuals = new Set(["DOC-04", "ELE-09", "CAM-13", "CAM-14", "CAM-15", "LEG-20", "LEG-21", "LEG-22", "ELE-26", "REF-04", "REF-05", "REF-06"]);
function owner(group) {
  if (["ACQ", "REC"].includes(group)) return "A";
  if (["GATE", "SAFE"].includes(group)) return "LEAD";
  return "C";
}
const definitions = crosswalk.rows.map(row => {
  const original = register.rows.find(r => r.id === row.id);
  if (!original || original.requirement !== row.requirement || original.label !== row.originalLabel) throw new Error(`Changed definition ${row.id}`);
  return { id: row.id, label: row.originalLabel, requirement: row.requirement, group: row.group,
    dimension: row.dimension, originalCore: row.originalCore, owner: owner(row.group),
    policyOverride: row.policyOverride, overlapGroups: row.overlapGroups,
    canonicalPredicate: shared[row.id] ?? (residuals.has(row.id) ? `${row.id}:residual` : row.id),
    contribution: row.policyOverride ? "SUPERSEDED" : shared[row.id] ? "SHARED" : residuals.has(row.id) ? "SUMMARY_WITH_RESIDUAL" : "DIRECT",
  };
});
if (new Set(definitions.map(d => d.id)).size !== 325) throw new Error("Duplicate requirement ID.");
const profile = { version: crosswalk.profile, sourceSha256: sha, overlapVersion: "checklist-overlap/2026-09-28@1", definitionCount: 325,
  policyOverrideEvidence: "Sean implementation instruction 2026-09-28: one original lifetime $50 Anthropic hunt; no secondary discretionary review/count/spend stop.",
  overlapRules: crosswalk.overlapRules, definitions };
writeFileSync(join(root, "lib/control-plane/readiness/checklist-profile.json"), JSON.stringify(profile, null, 2) + "\n");
mkdirSync(join(root, "docs/implementation"), { recursive: true });
const ledger = { formatVersion: 1, profile: profile.version, baseRevision: "afc590ea2294b7e4defa0f50b4ea2eabea5a0508", observationState: "BASELINE_RECONCILIATION_IN_PROGRESS",
  scope: "Existing zcta:2020/85635 hunt; shared applicable records reused; no new geography", originalBudgetStartedAt: "2026-09-27T22:17:50.236Z", anthropicLifetimeLimitUsd: 50,
  preparedEvidenceDisclosure: "Sierra Vista calendar captured September 26 before this hunt; prior route and held-document preparation is disclosed, not counted as newly discovered.",
  rows: definitions.map(d => ({ ...d, priorEvidence: register.rows.find(r => r.id === d.id).current,
    applicability: "UNRESOLVED", implementation: "UNDER_RECONCILIATION", readerCoverage: "NOT_MEASURED", evidence: [], nextAction: "Join current requirement instances and receipts; repair assigned path and verify through normal workflow." })),
  admin: Array.from({length: 15}, (_,i) => ({id: `ADMIN-${String(i+1).padStart(2,"0")}`, owner:"B+C", acceptance:"UNVERIFIED", evidence:[]})) };
const ledgerPath = join(root, "docs/implementation/completion-ledger.json");
// A repeated import must not erase acceptance accumulated during implementation.
try { readFileSync(ledgerPath); } catch { writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"); }
console.log(JSON.stringify({definitions: definitions.length, sourceSha256:sha, dimensions:[...new Set(definitions.map(d=>d.dimension))]}));
