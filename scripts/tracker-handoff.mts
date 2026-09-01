#!/usr/bin/env tsx
/**
 * `pnpm tracker:handoff` — write the tracker handoff artifact through the REAL
 * producer. (RULING 228.)
 *
 * The artifact used to be hand-authored, which is why nothing could run the
 * producer into the consumer and why the two halves diverged unnoticed. It is
 * generated now, from `lib/tracker/obligation-handoff.ts`, against the shared
 * contract both sides import.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { HANDOFF_PATH, validateHandoff } from "../lib/contracts/tracker-handoff.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { buildTrackerHandoff } from "../lib/tracker/obligation-handoff.ts";
import { today } from "./doc-dates.mjs";

const out = join(process.cwd(), ...HANDOFF_PATH);
const artifact = buildTrackerHandoff(today());

/* The producer validates its OWN output against the contract before writing.
   A producer that only resembles the type is not a party to a contract. */
const problems = validateHandoff(artifact);
if (problems.length > 0) {
  console.error("tracker:handoff — REFUSED, the producer's own output fails the contract:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

/*
 * RULING 159: floored against the population it was taken over.
 *
 * A producer with NO converted rows and a producer whose rows all lack routes
 * both print zero here, and they are different facts — one is a triage that
 * converted nothing, the other a conversion waiting on adapters. `floored`
 * throws on an unexplained empty population rather than letting the two share
 * a number.
 */
const schedulable = artifact.rows.filter((r) => r.routes.length > 0).length;
const carried = floored(
  "tracker:handoff - rows carrying a route",
  "the converted set",
  artifact.rows.length,
  schedulable,
  artifact.rows.length === 0
    ? "the triage converted no rows, which is a statement about the triage and not about the tracker"
    : undefined,
);
console.log(`tracker:handoff — wrote ${HANDOFF_PATH.join("/")}`);
console.log(`  ${floorLine(carried)}`);
console.log(`  ${artifact.rows.length - schedulable} deferred, each naming what it needs first`);
