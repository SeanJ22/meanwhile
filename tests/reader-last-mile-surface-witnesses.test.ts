import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  composeReaderSurfaceWitnesses,
} from "../docs/evidence/reader-last-mile-root-witnesses.mts";
import type { ReaderSurfaceClassWitness } from "../lib/holdings/reader-census.ts";

const head = "a".repeat(40);
const bytes = new Map<string, Buffer>([
  ["docs/evidence/reader-last-mile-render.json", Buffer.from("render")],
  ["docs/evidence/reader-last-mile-ballot.json", Buffer.from("ballot")],
  ["screenshots/reader-last-mile/map.png", Buffer.from("map-image")],
]);
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const readEvidence = (path: string) => {
  const value = bytes.get(path);
  assert.ok(value, `missing fixture bytes: ${path}`);
  return value;
};
const witness = (
  surface: ReaderSurfaceClassWitness["surface"],
  component: string,
  evidencePath: string,
  screenshots?: ReaderSurfaceClassWitness["screenshots"],
): ReaderSurfaceClassWitness => ({
  surface,
  component,
  exactHead: head,
  evidencePath,
  evidenceSha256: digest(readEvidence(evidencePath)),
  ...(screenshots ? { screenshots } : {}),
});

const finance = witness(
  "map",
  "components/officials/person-identity.tsx",
  "docs/evidence/reader-last-mile-render.json",
  [{
    path: "screenshots/reader-last-mile/map.png",
    sha256: digest(readEvidence("screenshots/reader-last-mile/map.png")),
  }],
);
const root = witness(
  "ballot",
  "components/ballot/candidate-card.tsx",
  "docs/evidence/reader-last-mile-ballot.json",
);
const requirements: Array<{
  surface: ReaderSurfaceClassWitness["surface"];
  component: string;
  importReach: boolean;
}> = [
  { surface: "map", component: finance.component, importReach: true },
  { surface: "ballot", component: root.component, importReach: true },
  { surface: "ask", component: "components/ask/ask-box.tsx", importReach: false },
];

test("surface witness composition is an exact-head, hash-bound deterministic union", () => {
  const actual = composeReaderSurfaceWitnesses({
    exactHead: head,
    financeWitnesses: [finance],
    rootWitnesses: [root],
    requirements,
    readEvidence,
  });
  assert.deepEqual(actual.map(({ surface, component }) => `${surface}#${component}`), [
    "ballot#components/ballot/candidate-card.tsx",
    "map#components/officials/person-identity.tsx",
  ]);
});

test("surface witness composition refuses duplicate, stale, changed, or incomplete proof", () => {
  const input = {
    exactHead: head,
    financeWitnesses: [finance],
    rootWitnesses: [root],
    requirements,
    readEvidence,
  };
  assert.throws(
    () => composeReaderSurfaceWitnesses({ ...input, rootWitnesses: [finance] }),
    /Duplicate Reader surface\/component witness/,
  );
  assert.throws(
    () => composeReaderSurfaceWitnesses({
      ...input,
      financeWitnesses: [{ ...finance, exactHead: "b".repeat(40) }],
    }),
    /witness belongs to another head/,
  );
  assert.throws(
    () => composeReaderSurfaceWitnesses({
      ...input,
      financeWitnesses: [{ ...finance, evidenceSha256: "0".repeat(64) }],
    }),
    /witness evidence bytes changed/,
  );
  assert.throws(
    () => composeReaderSurfaceWitnesses({
      ...input,
      financeWitnesses: [{
        ...finance,
        screenshots: [{ ...finance.screenshots![0]!, sha256: "0".repeat(64) }],
      }],
    }),
    /witness screenshot bytes changed/,
  );
  assert.throws(
    () => composeReaderSurfaceWitnesses({
      ...input,
      requirements: [
        ...requirements,
        { surface: "map", component: "components/map/missing.tsx", importReach: true },
      ],
    }),
    /lack an in-situ witness/,
  );
  assert.throws(
    () => composeReaderSurfaceWitnesses({
      ...input,
      requirements: [...requirements, requirements[0]!],
    }),
    /requirements are duplicated/,
  );
});
