import { projectStateHoldings } from "../lib/holdings/files.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const check = process.argv.includes("--check");
const result = projectStateHoldings(process.cwd(), check);
floored("state serving projection inputs", "canonical state geometry and street holdings", result.files, result.files);
console.log(`State serving projections: ${result.files} canonical geo/street files; ${result.issues.length} mismatches.`);
for (const issue of result.issues) console.error(issue);
if (result.files === 0 || result.issues.length > 0) process.exitCode = 1;
