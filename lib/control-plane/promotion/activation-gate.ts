/**
 * THE ACTIVATION GATE — what the nightly window may promote. (RULING 242.)
 *
 *   promotionEnabled   false, and stays false until READER, TRUTH and
 *                      FRESHNESS are GREEN and INDEPENDENTLY_REPRODUCED
 *   openRecordClasses  EMPTY. Opening a class is a later owner decision;
 *                      the low-risk candidates are named here so the
 *                      decision has a list to choose from, never a blank
 *
 * The contract states are READ from the newest freshness-shadow run record
 * (its `health.readings`), never assumed. A record that cannot be read
 * leaves every contract UNREAD, which is not GREEN.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { proofClassOf, type RunProvenance } from "../../ops/run-provenance.ts";
import type { ActivationGateReading } from "./types.ts";

export const ACTIVATION_GATE = {
  promotionEnabled: false,
  openRecordClasses: [] as readonly string[],
} as const;

/** Candidates for the FIRST classes to open, for a later decision. Not open. */
export const LOW_RISK_CANDIDATE_CLASSES: readonly string[] = [
  "meeting-times",
  "agendas",
  "published-minutes",
  "routine-filings",
];

/** Classes that stay closed until the owner approves each one by name. */
export const OWNER_APPROVED_CLASSES: readonly string[] = [
  "candidate-positions",
  "campaign-finance",
  "candidate-enrichment",
  "ballot",
  "votes",
];

export const RUN_RECORDS_DIR = ["data", "health", "freshness-shadow-runs"] as const;

interface HealthReading {
  readonly contract: string;
  readonly state: string;
}

interface RunRecordHealth {
  readonly health?: { readonly readings?: readonly HealthReading[] };
  readonly provenance?: RunProvenance | null;
}

/** The newest run record's path, or null when the directory holds none. */
export function latestRunRecordPath(root: string): string | null {
  const dir = join(root, ...RUN_RECORDS_DIR);
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(n)).sort();
  const last = names.at(-1);
  return last === undefined ? null : join(dir, last);
}

/** Read the gate. Unreadable contracts are UNREAD, and UNREAD is not GREEN. */
export function readActivationGate(root: string): ActivationGateReading {
  const path = latestRunRecordPath(root);
  const contracts: Record<"READER" | "TRUTH" | "FRESHNESS", string> = {
    READER: "UNREAD",
    TRUTH: "UNREAD",
    FRESHNESS: "UNREAD",
  };
  let independentlyReproduced = false;
  let readFrom: string | null = null;
  let problem: string | null = null;
  if (path === null) {
    problem = "no freshness-shadow run record exists to read the contracts from";
  } else {
    try {
      const record = JSON.parse(readFileSync(path, "utf8")) as RunRecordHealth;
      readFrom = path;
      for (const r of record.health?.readings ?? []) {
        if (r.contract === "READER" || r.contract === "TRUTH" || r.contract === "FRESHNESS") {
          contracts[r.contract] = r.state;
        }
      }
      independentlyReproduced = proofClassOf(record.provenance ?? null) === "INDEPENDENTLY_REPRODUCED";
    } catch (error) {
      problem = `the newest run record at ${path} could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const allGreen = contracts.READER === "GREEN" && contracts.TRUTH === "GREEN" && contracts.FRESHNESS === "GREEN";
  const reason =
    problem !== null
      ? `SHADOW — ${problem}; an unread contract is not GREEN`
      : `SHADOW — READER ${contracts.READER}, TRUTH ${contracts.TRUTH}, FRESHNESS ${contracts.FRESHNESS}; ` +
        `${allGreen ? "all GREEN" : "not all GREEN"}; ${independentlyReproduced ? "INDEPENDENTLY_REPRODUCED" : "not INDEPENDENTLY_REPRODUCED"}; ` +
        `promotion ${ACTIVATION_GATE.promotionEnabled ? "ON" : "OFF"}; ${ACTIVATION_GATE.openRecordClasses.length} record class(es) open`;
  return {
    promotionEnabled: ACTIVATION_GATE.promotionEnabled,
    mode: "SHADOW",
    openRecordClasses: ACTIVATION_GATE.openRecordClasses,
    contracts,
    independentlyReproduced,
    readFrom,
    reason,
  };
}
