import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

/** Proof exporters can write JSON only inside their report directory. */
export function writeAutonomousFleetProof(root: string, destination: string, proof: unknown): void {
  const directory = resolve(root, "data/health/autonomous-agent-fleet");
  const output = resolve(destination);
  if (dirname(output) !== directory || extname(output) !== ".json") throw new Error("AUTONOMOUS_PROOF_OUTPUT_SCOPE_REFUSED");
  mkdirSync(directory, { recursive: true });
  writeFileSync(output, JSON.stringify(proof, null, 2) + "\n", "utf8");
}
