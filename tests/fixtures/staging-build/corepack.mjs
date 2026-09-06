/** Package-manager seam: run the real gate; record where Next would start. */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
appendFileSync(process.env.SISO_TRACE, JSON.stringify(args) + "\n");
if (args.length === 1 && args[0] === "enable") process.exit(0);
if (args[0] !== "pnpm" || args[1] !== "run" || args.length !== 3) process.exit(90);

const scripts = JSON.parse(readFileSync(join(process.env.SISO_ROOT, "package.json"), "utf8")).scripts;
if (args[2] === "build") {
  if (scripts.build !== "next build") process.exit(91);
  appendFileSync(process.env.SISO_BUILD_MARKER, "next build\n");
  process.exit(0);
}
if (args[2] !== "staging:isolation") process.exit(92);
const match = /^tsx (scripts\/[a-z0-9/._-]+\.mts)$/.exec(scripts[args[2]] ?? "");
if (!match) process.exit(93);
// The package's real TypeScript entry point runs in its own process. Native
// stripping avoids package-manager/tsx host setup in this deterministic seam.
const result = spawnSync(process.execPath, [
  "--experimental-strip-types",
  join(process.env.SISO_ROOT, match[1]),
], { env: process.env, cwd: process.env.SISO_ROOT, stdio: "inherit" });
process.exit(result.status ?? 94);
