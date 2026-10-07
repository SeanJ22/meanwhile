import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDomainFiles } from "../lib/holdings/discovery.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

/** Offline byte projection of data/states geo and street holdings into public/. Check mode changes nothing. */
function projectStateHoldings(root: string, check: boolean): { files: number; issues: string[] } {
  const inputs = ["geo", "streets"].flatMap((domain) => stateDomainFiles(root, domain));
  const expected = new Set(inputs.map((file) => file.replace(/^data\//, "public/")));
  const issues: string[] = [];
  for (const source of inputs) {
    const target = source.replace(/^data\//, "public/");
    if (existsSync(join(root, target)) && readFileSync(join(root, source)).equals(readFileSync(join(root, target)))) continue;
    if (check) issues.push(`${target}: missing or differs from ${source}`);
    else {
      mkdirSync(dirname(join(root, target)), { recursive: true });
      copyFileSync(join(root, source), join(root, target));
    }
  }
  for (const target of ["geo", "streets"].flatMap((domain) => stateDomainFiles(root, domain, "public"))) {
    if (expected.has(target)) continue;
    if (check) issues.push(`${target}: no canonical holding`);
    else unlinkSync(join(root, target));
  }
  return { files: inputs.length, issues };
}

const check = process.argv.includes("--check");
const result = projectStateHoldings(process.cwd(), check);
floored("state serving projection inputs", "canonical state geometry and street holdings", result.files, result.files);
console.log(`State serving projections: ${result.files} canonical geo/street files; ${result.issues.length} mismatches.`);
for (const issue of result.issues) console.error(issue);
if (result.files === 0 || result.issues.length > 0) process.exitCode = 1;
