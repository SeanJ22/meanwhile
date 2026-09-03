import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { classifyHolding, isHoldingCandidate, sha256, type HoldingMovePlan, type HoldingPlanRow } from "../lib/holdings/classification.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = resolve(option("--root") ?? process.cwd());
const out = resolve(root, option("--out") ?? "data/state-holdings/move-plan.json");
const previous = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) as HoldingMovePlan : null;
const base = option("--base") ?? previous?.baseSha;
if (!base) throw new Error("First snapshot requires --base <exact session base SHA>.");
const git = (...gitArgs: string[]) => execFileSync("git", gitArgs, { cwd: root, maxBuffer: 1024 * 1024 * 512 });
const baseSha = git("rev-parse", `${base}^{commit}`).toString().trim();
const tree = git("ls-tree", "-r", "-z", baseSha).toString().split("\0").filter(Boolean).map((line) => {
  const [, , , blob, path] = /^(\d+) (\S+) ([0-9a-f]+)\t([\s\S]*)$/.exec(line)!;
  return { path, blob };
}).sort((a, b) => a.path.localeCompare(b.path, "en"));
const candidates = tree.filter(({ path }) => isHoldingCandidate(path));
const contents = new Map<string, Buffer>();
// A single cat-file process reads the immutable base; the standing checkout is never consulted.
const batch = execFileSync("git", ["cat-file", "--batch"], { cwd: root,
  input: tree.map(({ blob }) => blob).join("\n") + "\n", maxBuffer: 1024 * 1024 * 512 });
let offset = 0;
for (const { path, blob } of tree) {
  const end = batch.indexOf(10, offset);
  const [actualBlob, kind, sizeText] = batch.subarray(offset, end).toString().split(" ");
  if (actualBlob !== blob || kind !== "blob") throw new Error(`Invalid base blob read for ${path}`);
  const size = Number(sizeText);
  contents.set(path, batch.subarray(end + 1, end + 1 + size));
  offset = end + 1 + size + 1;
}
const referenceMap = new Map<string, Map<string, number>>();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const referencesPattern = new RegExp(candidates.map(({ path }) => escapeRegExp(path)).sort((a, b) => b.length - a.length).join("|"), "g");
for (const [path, bytes] of contents) {
  if (bytes.includes(0)) continue;
  for (const match of bytes.toString("utf8").matchAll(referencesPattern)) {
    if (!referenceMap.has(match[0])) referenceMap.set(match[0], new Map());
    const counts = referenceMap.get(match[0])!;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
}
const referenceCounts = (oldPath: string) => [...(referenceMap.get(oldPath) ?? [])].map(([path, count]) => ({ path, count }));
const all: HoldingPlanRow[] = candidates.map(({ path }) => {
  const bytes = contents.get(path)!;
  const references = referenceCounts(path);
  return { ...classifyHolding(path), sha256: sha256(bytes), bytes: bytes.length, referenceCount: references.reduce((sum, r) => sum + r.count, 0), references };
});
const rows = all.filter((row) => row.disposition === "MOVE");
const exemptions = all.filter((row) => row.disposition === "EXEMPT");
const excluded = all.filter((row) => row.disposition === "NON_HOLDING");
const plan: HoldingMovePlan = {
  schemaVersion: 1, baseSha, generatedBy: "scripts/state-holdings-plan.mts",
  universeDefinition: "Exact immutable base tree: all committed data/ artifacts, public geometry/street/portrait artifacts, lib registry/geo JSON, legacy descent JSON, and root acquisition file formats. Non-holdings are explicitly classified rather than silently omitted.",
  referenceDefinition: "Case-sensitive literal oldPath occurrences across UTF-8 nonbinary files at baseSha. references supplies every file and occurrence count; dynamic composed paths are separately covered by the permanent residual-layout check and integration tests.",
  sourceFiles: candidates, discoveredStateInputs: previous?.discoveredStateInputs ?? [], discoveredStates: previous?.discoveredStates ?? [],
  rows, exemptions, excluded, allowedHistoricalReferences: previous?.allowedHistoricalReferences ?? [],
  ...(previous?.classificationCorrections ? { classificationCorrections: previous.classificationCorrections } : {}),
  counts: { candidates: all.length, classifiedHoldings: rows.length + exemptions.length, moved: rows.length, exempted: exemptions.length, excluded: excluded.length, references: rows.reduce((sum, r) => sum + r.referenceCount, 0) },
};
const rendered = JSON.stringify(plan, null, 2) + "\n";
if (args.includes("--check")) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== rendered) { console.error("State holdings move-plan snapshot is stale."); process.exitCode = 1; }
} else { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, rendered); }
console.log(JSON.stringify({ baseSha, ...plan.counts, identityHolds: plan.counts.classifiedHoldings === plan.counts.moved + plan.counts.exempted }));
