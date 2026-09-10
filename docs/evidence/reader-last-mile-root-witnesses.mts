import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readReaderEvidence,
  sha256,
  type ReaderSurfaceClassWitness,
} from "../../lib/holdings/reader-census.ts";

interface ReaderWitnessRequirement {
  readonly surface: ReaderSurfaceClassWitness["surface"];
  readonly component: string;
  readonly importReach: boolean;
}

interface ReaderSurfaceWitnessComposition {
  readonly exactHead: string;
  readonly financeWitnesses: readonly ReaderSurfaceClassWitness[];
  readonly rootWitnesses: readonly ReaderSurfaceClassWitness[];
  readonly requirements: readonly ReaderWitnessRequirement[];
  readonly readEvidence: (path: string) => Uint8Array;
}

const witnessKey = (witness: Pick<ReaderSurfaceClassWitness, "surface" | "component">) =>
  `${witness.surface}#${witness.component}`;

/**
 * Join the independently executed leaf witnesses without granting the join any
 * evidentiary authority of its own. Every referenced artifact and screenshot
 * is re-hashed, every witness belongs to the same exact head, and every
 * currently reachable component requirement must appear exactly once.
 */
export function composeReaderSurfaceWitnesses(
  options: ReaderSurfaceWitnessComposition,
): ReaderSurfaceClassWitness[] {
  assert.match(options.exactHead, /^[a-f0-9]{40}$/, "Surface witnesses require an exact Git head");
  assert.ok(options.financeWitnesses.length, "Finance/component witnesses are empty");
  assert.ok(options.rootWitnesses.length, "Root browser witnesses are empty");

  const combined = [...options.financeWitnesses, ...options.rootWitnesses];
  const seen = new Set<string>();
  for (const witness of combined) {
    const key = witnessKey(witness);
    assert.ok(!seen.has(key), `Duplicate Reader surface/component witness: ${key}`);
    seen.add(key);
    assert.equal(witness.exactHead, options.exactHead, `${key}: witness belongs to another head`);
    assert.match(
      witness.evidencePath,
      /^docs\/evidence\/reader-last-mile-[a-z0-9-]+\.json$/,
      `${key}: witness evidence path is outside the immutable Reader namespace`,
    );
    assert.equal(
      sha256(options.readEvidence(witness.evidencePath)),
      witness.evidenceSha256,
      `${key}: witness evidence bytes changed`,
    );
    for (const screenshot of witness.screenshots ?? []) {
      assert.equal(
        sha256(options.readEvidence(screenshot.path)),
        screenshot.sha256,
        `${key}: witness screenshot bytes changed (${screenshot.path})`,
      );
    }
  }

  const required = options.requirements
    .filter((requirement) => requirement.importReach)
    .map(witnessKey);
  assert.ok(required.length, "Reachable Reader surface/component requirements are empty");
  const requiredKeys = new Set(required);
  assert.equal(
    requiredKeys.size,
    required.length,
    "Reachable Reader surface/component requirements are duplicated",
  );
  const missing = [...requiredKeys].filter((key) => !seen.has(key)).sort();
  assert.deepEqual(missing, [], "Reachable Reader component classes lack an in-situ witness");

  return combined.sort((left, right) => {
    const a = witnessKey(left);
    const b = witnessKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function generateReaderRootAndSurfaceWitnesses(root = process.cwd()): {
  readonly rootWitnesses: number;
  readonly surfaceWitnesses: number;
  readonly exactHead: string;
} {
  const exactHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const rootWitnesses: ReaderSurfaceClassWitness[] = [];
  for (const [name, surface, component] of [
    ["ballot", "ballot", "components/ballot/candidate-card.tsx"],
    ["positions", "ballot", "components/officials/positions-section.tsx"],
    ["civic", "civic-routing", "components/ask/ask-box.tsx"],
  ] as const) {
    const evidencePath = `docs/evidence/reader-last-mile-${name}.json`;
    const bytes = readReaderEvidence(root, evidencePath);
    const data = JSON.parse(bytes.toString()) as {
      exactHead: string;
      rows?: { proofs: unknown[] }[];
      unresolved?: unknown[];
      proofs?: unknown[];
      dispositions?: unknown[];
      expectedCount?: number;
      renderedCount?: number;
      layoutProofs?: unknown[];
    };
    assert.equal(data.exactHead, exactHead, `${name}: exact-head browser witness`);
    if (name === "ballot") {
      assert.ok(data.rows?.length && data.rows.every((row) => row.proofs.length));
    }
    if (name === "positions") {
      assert.equal(data.unresolved?.length, 0);
      assert.equal((data.proofs?.length ?? 0) + (data.dispositions?.length ?? 0), data.expectedCount);
    }
    if (name === "civic") {
      assert.equal(data.expectedCount, data.renderedCount);
      assert.ok(data.layoutProofs?.length);
    }
    rootWitnesses.push({
      surface,
      component,
      exactHead,
      evidencePath,
      evidenceSha256: sha256(bytes),
    });
  }

  const financeWitnesses = JSON.parse(readReaderEvidence(
    root,
    "docs/evidence/reader-last-mile-finance-witnesses.json",
  ).toString()) as ReaderSurfaceClassWitness[];
  const requirements = (JSON.parse(readReaderEvidence(
    root,
    "docs/evidence/reader-last-mile-witness-requirements.json",
  ).toString()) as { requirements: ReaderWitnessRequirement[] }).requirements;
  const surfaceWitnesses = composeReaderSurfaceWitnesses({
    exactHead,
    financeWitnesses,
    rootWitnesses,
    requirements,
    readEvidence: (path) => readReaderEvidence(root, path),
  });

  writeFileSync(
    resolve(root, "docs/evidence/reader-last-mile-root-witnesses.json"),
    `${JSON.stringify(rootWitnesses, null, 2)}\n`,
  );
  writeFileSync(
    resolve(root, "docs/evidence/reader-last-mile-surface-witnesses.json"),
    `${JSON.stringify(surfaceWitnesses, null, 2)}\n`,
  );
  return { rootWitnesses: rootWitnesses.length, surfaceWitnesses: surfaceWitnesses.length, exactHead };
}

const main = typeof process.argv[1] === "string" &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (main) {
  console.log(JSON.stringify(generateReaderRootAndSurfaceWitnesses(), null, 2));
}
