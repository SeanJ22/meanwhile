/** Generate the canonical state answer surfaces from committed inputs, with no live reads. */
import { resolve } from "node:path";
import { checkManifests, expectedManifests, loadManifestContext, snapshotManifestInputs, writeManifests } from "../lib/holdings/manifest.ts";

const args = process.argv.slice(2);
const rootAt = args.indexOf("--root");
const root = rootAt < 0 ? process.cwd() : resolve(args[rootAt + 1]);
try {
  if (args.includes("--snapshot")) {
    if (args.includes("--check")) throw new Error("--check cannot snapshot or mutate inputs");
    const baseAt = args.indexOf("--base");
    if (baseAt < 0) throw new Error("--snapshot requires --base <exact SHA>");
    const input = snapshotManifestInputs(root, args[baseAt + 1]);
    console.log(`state-manifest: frozen ${input.discoveredStates.length} states/territories and ${input.files.length} exact input hashes at ${input.baseSha}`);
  } else {
    const context = loadManifestContext(root);
    const expected = expectedManifests(context);
    if (args.includes("--check")) {
      const problems = checkManifests(root, expected);
      if (problems.length) throw new Error(problems.join("\n"));
      console.log(`state-manifest: ${expected.size} of ${expected.size} discovered-state manifests are byte-current against committed inputs; no files touched`);
    } else {
      const changed = writeManifests(root, expected);
      const problems = checkManifests(root, expected);
      if (problems.length) throw new Error(problems.join("\n"));
      console.log(`state-manifest: ${expected.size} discovered-state manifests; ${changed} written; external observed_at stamps preserved`);
    }
  }
} catch (error) {
  console.error(`state-manifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
