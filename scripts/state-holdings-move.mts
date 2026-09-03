/** Execute the reviewed base-tree plan as one worktree sweep; never acquire data. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { sha256, type HoldingMovePlan } from "../lib/holdings/classification.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const root = process.cwd();
const planPath = "data/state-holdings/move-plan.json";
const plan = JSON.parse(readFileSync(planPath, "utf8")) as HoldingMovePlan;
const apply = process.argv.includes("--apply");
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (branch === "main" || !branch) throw new Error("The atomic sweep requires the isolated session branch");
if (!plan.discoveredStates.length || !plan.discoveredStateInputs.length) throw new Error("Freeze the discovered-state and readback denominator before moving");
function checkedPath(path: string) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Path escapes session worktree: ${path}`);
  return target;
}
for (const row of plan.rows) {
  const from = checkedPath(row.oldPath);
  const to = checkedPath(row.newPath!);
  if (!existsSync(from) || sha256(readFileSync(from)) !== row.sha256) throw new Error(`Base holding changed before sweep: ${row.oldPath}`);
  if (existsSync(to)) throw new Error(`Move target already exists: ${row.newPath}`);
}
const moves = new Map(plan.rows.map((r) => [r.oldPath, r.newPath!]));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matcher = new RegExp([...moves.keys()].sort((a, b) => b.length - a.length).map(escape).join("|"), "g");
const tracked = filesThatWouldBeCommitted({ cwd: root });
// The ledger's adopted words and external observations are historical evidence,
// not live filesystem pointers. Generated governance views resolve their links.
const immutable = new Set(["docs/governance/ledger.jsonl", "lib/governance/adoptions.ts", "docs/governance/legacy/CLAUDE.pre-remediation.md", "docs/governance/legacy/rulings.pre-remediation.md", "docs/tracker.csv"]);
const edits: { path: string; beforeHash: string; after: string; count: number }[] = [];
for (const path of tracked) {
  if (immutable.has(path) || path.startsWith("data/state-holdings/")) continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  let count = 0;
  const after = bytes.toString("utf8").replace(matcher, (old) => { count++; return moves.get(old)!; });
  if (count) edits.push({ path, beforeHash: sha256(bytes), after, count });
}
const report = {
  schemaVersion: 1, baseSha: plan.baseSha, generatedBy: "scripts/state-holdings-move.mts",
  moved: plan.rows.map((r) => ({ path: r.newPath, sourceBlobSha256: r.sha256 })),
  exempted: plan.exemptions.map((r) => ({ path: r.oldPath, reason: r.reason })),
  referencesUpdated: edits.map((e) => ({ path: moves.get(e.path) ?? e.path, count: e.count })),
  counts: { moved: plan.rows.length, exempted: plan.exemptions.length, referenceFiles: edits.length, references: edits.reduce((n, e) => n + e.count, 0) },
};
if (apply) {
  // Recheck every edited input before any mutation; refuse a concurrent save.
  for (const edit of edits) if (sha256(readFileSync(edit.path)) !== edit.beforeHash) throw new Error(`Concurrent edit: ${edit.path}`);
  for (const row of plan.rows) {
    mkdirSync(dirname(checkedPath(row.newPath!)), { recursive: true });
    execFileSync("git", ["mv", "--", row.oldPath, row.newPath!], { stdio: "pipe" });
  }
  for (const edit of edits) writeFileSync(moves.get(edit.path) ?? edit.path, edit.after);
  writeFileSync("data/state-holdings/move-report.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ apply, ...report.counts }));
