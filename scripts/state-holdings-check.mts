import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkHoldingPaths, type HoldingMovePlan } from "../lib/holdings/classification.ts";
import { INPUT_PATH, validateRuntimeAuthorityCutovers, validateSupersededHoldings, type FrozenInputs } from "../lib/holdings/manifest.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = resolve(option("--root") ?? process.cwd());
const planPath = option("--plan") ?? "data/state-holdings/move-plan.json";
const plan = JSON.parse(readFileSync(resolve(root, planPath), "utf8")) as HoldingMovePlan;
const inputPath = resolve(root, INPUT_PATH);
const frozen = existsSync(inputPath) ? (JSON.parse(readFileSync(inputPath, "utf8")) as FrozenInputs) : null;
const cutovers = frozen ? validateRuntimeAuthorityCutovers(root, plan, frozen) : [];
const superseded = frozen ? validateSupersededHoldings(root, plan, frozen) : [];
const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const files = new Map<string, Buffer>();
for (const path of new Set(listed.split("\0").filter(Boolean))) if (existsSync(resolve(root, path))) files.set(path, readFileSync(resolve(root, path)));
const result = checkHoldingPaths(plan, files, planPath);
floored("canonical holdings present", "the finite classified holding universe", result.expectedHoldings, result.expectedHoldings);
floored("text files checked", "committable repository files", files.size, result.checkedFiles);
console.log(`State holding paths: ${result.expectedHoldings} classified holdings; ${cutovers.length} exact runtime-authority cutover(s); ${superseded.length} superseded holding(s); ${result.checkedFiles} text files checked against ${plan.baseSha}.`);
if (result.issues.length) { console.error(result.issues.join("\n")); process.exitCode = 1; }
else console.log("No residual canonical paths or stale references.");
