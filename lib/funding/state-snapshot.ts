import { isRenderable } from "./state-money-reader.ts";
/**
 * READING THE STATE-MONEY CORPUS — the reader-facing half of RULING 126.
 *
 * The committed snapshot is loaded once and answered by target key, exactly as
 * `lib/funding/snapshot.ts` does for the FEC corpus. **It is deliberately the
 * same shape**: one loader, one lookup, one render path (RULING 103), and the
 * firewall asserted in one place rather than in two.
 *
 * Snapshots live in `data/states/<st>/funding/`, a committed reader-content
 * path. It is never in Postgres — that is wall 1 of the firewall, and
 * `tests/campaign-finance-firewall.test.ts` fails if it moves.
 */

import { readFileSync } from "node:fs";
import * as fs from "node:fs";
import { join } from "node:path";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import identityBridge from "./official-candidacies.json" with { type: "json" };

import {
  type StateMoneyRecord,
  type StateMoneySnapshot,
} from "./state-money.ts";

/**
 * Discover normalized state snapshots independently of reader coverage. Each
 * agency's file remains isolated, so an unreadable state's corpus cannot empty
 * the other states' rows.
 */
function snapshotFiles(root: string): { state: string; file: string }[] {
  const knownStates = new Set(Object.values(FIPS_TO_STATE).map((state) => state.postal.toLowerCase()));
  // Node 24 is the deployed runtime; the repo's Node 20 typings predate this
  // stable API. A bounded glob avoids tracing every unrelated state holding.
  const { globSync } = fs as typeof fs & {
    globSync(pattern: string, options: { cwd: string }): string[];
  };
  const paths = [...new Set([
    ...globSync("data/states/*/funding/state-money-??-????.json", { cwd: root }).map(p => p.replaceAll("\\", "/")),
    // The committed bridge inventories required snapshots independently of a
    // deploy's directory listing. A missing bundled file stays a failed read.
    ...identityBridge.sources.map(s => s.path).filter(p => /^data\/states\/[a-z]{2}\/funding\/state-money-[a-z]{2}-\d{4}\.json$/.test(p)),
  ])];
  const files: { state: string; file: string }[] = [];
  for (const path of paths) {
    const match = /^data\/states\/([a-z]{2})\/funding\/(state-money-([a-z]{2})-\d{4}\.json)$/.exec(path.replaceAll("\\", "/"));
    if (match && knownStates.has(match[1]) && match[1] === match[3]) files.push({ state: match[1], file: match[2] });
  }
  return files.sort((a, b) => a.state.localeCompare(b.state) || a.file.localeCompare(b.file));
}

let cache: StateMoneyRecord[] | null = null;
let loadedFrom: string[] = [];
let failedReads: { state: string; file: string }[] = [];

function load(): StateMoneyRecord[] {
  if (cache) return cache;
  const records: StateMoneyRecord[] = [];
  const from: string[] = [];
  const failures: { state: string; file: string }[] = [];
  for (const { state, file } of snapshotFiles(process.cwd())) {
    // Read through `process.cwd()`, so `next.config.ts` must name the path in
    // `outputFileTracingIncludes` or the file is simply absent from the deploy
    // and every card silently loses its money. That failure renders as honest
    // missing data, which is why it is called out here rather than assumed.
    const path = join(process.cwd(), "data", "states", state, "funding", file);
    try {
      const snapshot = JSON.parse(readFileSync(path, "utf8")) as StateMoneySnapshot;
      if (snapshot.formatVersion !== 1 || !Array.isArray(snapshot.records)) throw new Error("Invalid normalized state-money snapshot");
      records.push(...snapshot.records);
      from.push(file);
    } catch {
      // A file that cannot be parsed is a FAILURE of that file, and it may not
      // empty the others. The affected state's selector reports a failed read.
      failures.push({ state, file });
    }
  }
  cache = records;
  loadedFrom = from;
  failedReads = failures;
  return records;
}

/** Which snapshot files were actually read. Stated, never assumed. */
export function stateMoneySources(): string[] {
  load();
  return [...loadedFrom];
}

/**
 * The renderable state-money records for one candidate.
 *
 * A `LEAD` is filtered here, by `isRenderable`, so no calling surface can
 * decide otherwise — the same once-and-only-once shape RULING 118 uses for the
 * govern verb. Several records for one person is CORRECT and they all render:
 * a candidate may file a primary committee and a general one, and showing one
 * while hiding the other would understate their campaign.
 */
export function stateMoneyForTarget(targetKey: string): StateMoneyRecord[] {
  const records = load();
  const state = /^ballot-([a-z]{2})-/.exec(targetKey)?.[1];
  if (state && failedReads.some(f => f.state === state)) throw new Error(`Canonical state-money holding unavailable for ${state}`);
  return records.filter((r) => r.targetKeys.includes(targetKey) && isRenderable(r));
}

/** Has this product asked a state agency about this candidate at all? */
export function stateMoneyWasAsked(targetKey: string): boolean {
  return stateMoneyForTarget(targetKey).length > 0;
}

/**
 * The three-way split across everything loaded, recomputed from the records the
 * surfaces actually render.
 *
 * **Stated N equals rendered rows.** A second query is free to disagree with
 * what is on screen; this counts the same array.
 */
export function stateMoneySplit(): {
  candidaciesWithFilings: number;
  candidaciesWithRegisteredNoActivity: number;
  candidaciesWithSourcedAbsence: number;
  renderableRecords: number;
  leadsWithheld: number;
  routesUnread: number;
} {
  const all = load();
  const filed = new Set<string>();
  const registered = new Set<string>();
  const absent = new Set<string>();
  for (const r of all) {
    if (r.filingState === "FILED") for (const k of r.targetKeys) filed.add(k);
    else if (r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED")
      for (const k of r.targetKeys) registered.add(k);
    else if (r.filingState === "NO_REPORTS_ON_FILE") for (const k of r.targetKeys) absent.add(k);
  }
  for (const k of filed) {
    registered.delete(k);
    absent.delete(k);
  }
  for (const k of registered) absent.delete(k);
  return {
    candidaciesWithFilings: filed.size,
    candidaciesWithRegisteredNoActivity: registered.size,
    candidaciesWithSourcedAbsence: absent.size,
    renderableRecords: all.filter(isRenderable).length,
    leadsWithheld: all.filter((r) => r.filingState === "LEAD").length,
    /*
     * A route this product could not read. Counted so the number is STATED
     * rather than hidden inside a residual — but never rendered: it is a fact
     * about us, and it is not an answer to anything a reader asked.
     */
    routesUnread: all.filter((r) => r.filingState === "ROUTE_UNREAD").length,
  };
}

/** Test seam. Never called by a render path. */
export function resetStateMoneyCache(): void {
  cache = null;
  loadedFrom = [];
  failedReads = [];
}
