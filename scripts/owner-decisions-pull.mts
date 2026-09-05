/**
 * **PULL THE OWNER'S DASHBOARD DECISIONS INTO THE REPOSITORY.**
 * (ADM-4, the 9.4.26 admin feedback. Lane C. `pnpm owner:decisions:pull`.)
 *
 * The owner decides on the control centre and the button appends a durable
 * `OwnerDecisionIntent` to the control plane. The tracker lives in git. This
 * is the step between the two: it reads the decision log, folds it to one
 * row per decision (`lib/control-plane/decision-log.ts`), and writes the
 * result to **`docs/tracker-owner-decisions.json`**, which `pnpm tracker:move`
 * then reads to close the Needs Sean rows he decided and open the work each
 * decision implies (RULING 271).
 *
 * ## This script is the ONLY writer of docs/tracker-owner-decisions.json
 *
 * The file is a committed EXPORT of a store. Nothing else writes it — not a
 * session by hand, not the move script, not a test — because a decision that
 * appears in the export and not in the control plane is a decision nobody
 * made, and the export is the thing the tracker acts on. The file says the
 * same in its own `note` field.
 *
 * ## Never dropping an intent
 *
 * The export is MERGED by intent id, never replaced. A decision that was in
 * the file and is not in this pull — a store that lost a partition, a pull
 * against a different store by mistake — stays in the file. Losing a
 * decision he made silently would be exactly the "I have to go hunt down
 * whatever random spreadsheet" failure this lane exists to end, in reverse.
 * A pulled row for an id already in the file replaces that row, because the
 * pull carries the later state (`CANONICALIZED`, say).
 *
 * ## Refusals
 *
 * No control plane configured, or unreachable: the script exits non-zero and
 * writes nothing. An empty export written from a store that could not be
 * asked would read as "he has decided nothing", which is a claim about him
 * made from a fact about our configuration. `--file-store=<dir>` points it at
 * a file-backed control plane (for proofs and tests); `--out=<path>` writes
 * somewhere other than the committed export (for tests only — the committed
 * file is the one the tracker reads).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openControlPlane, readDecisions } from "../lib/control-plane/admin-data.ts";
import { collapseDecisionLog } from "../lib/control-plane/decision-log.ts";
import type { OwnerDecisionIntent } from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { OWNER_DECISIONS_JSON } from "./tracker-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The shape of the committed export. `formatVersion` moves when this does. */
export interface OwnerDecisionsExport {
  readonly formatVersion: 1;
  readonly note: string;
  readonly pulledAt: string;
  readonly pulledFromSha: string | null;
  readonly intents: readonly OwnerDecisionIntent[];
}

export const EXPORT_NOTE =
  "The owner's dashboard decisions, exported from the control plane. WRITTEN ONLY by " +
  "scripts/owner-decisions-pull.mts (pnpm owner:decisions:pull); never hand-edited, never " +
  "written by anything else. pnpm tracker:move reads it to close the Needs Sean rows Sean " +
  "decided and to open the work each decision implies (RULING 271). Merged by intent id on " +
  "every pull: an intent is never dropped from this file.";

/*
 * Flags are read once into a map, and a flag given without a value is the
 * empty string rather than undefined so `--out=` and `--out` behave alike.
 */
const FLAGS = new Map<string, string>(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const eq = a.indexOf("=");
      return eq < 0 ? [a.slice(2), ""] : [a.slice(2, eq), a.slice(eq + 1)];
    }),
);

function say(line: string): void {
  console.log(`owner:decisions:pull · ${line}`);
}

function resolveOut(path: string): string {
  return isAbsolute(path) ? path : join(ROOT, path);
}

async function open(): Promise<ControlPlaneRepositories> {
  const store = FLAGS.get("file-store");
  if (store) {
    const repos = await createFileRepositories(resolveOut(store));
    say(repos.describe());
    return repos;
  }
  const opened = await openControlPlane();
  if (!opened.ok) {
    say(`REFUSED — ${opened.detail}`);
    say("Nothing was written: an export from a store we could not ask would read as a fact about him.");
    process.exit(1);
  }
  say(opened.repos.describe());
  return opened.repos;
}

function readExisting(path: string): OwnerDecisionsExport | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OwnerDecisionsExport>;
  if (!Array.isArray(parsed.intents)) {
    throw new Error(`${path} exists and carries no intents array — refusing to overwrite a file this script did not write`);
  }
  return parsed as OwnerDecisionsExport;
}

/** Merge by intent id: pulled rows replace their twins, nothing already held is dropped. */
export function mergeIntents(
  held: readonly OwnerDecisionIntent[],
  pulled: readonly OwnerDecisionIntent[],
): readonly OwnerDecisionIntent[] {
  const byId = new Map<string, OwnerDecisionIntent>(held.map((i) => [i.intentId, i]));
  for (const intent of pulled) byId.set(intent.intentId, intent);
  return [...byId.values()].sort((a, b) => {
    if (a.decidedAt !== b.decidedAt) return a.decidedAt < b.decidedAt ? 1 : -1;
    return a.intentId < b.intentId ? 1 : -1;
  });
}

async function main(): Promise<void> {
  const outPath = resolveOut(FLAGS.get("out") || OWNER_DECISIONS_JSON);
  const repos = await open();

  const read = await readDecisions(repos);
  if (read.kind !== "HELD") {
    say(`REFUSED — ${read.detail}`);
    process.exit(1);
  }
  const pulled = collapseDecisionLog(read.value);
  const existing = readExisting(outPath);
  const held = existing?.intents ?? [];
  const merged = mergeIntents(held, pulled);

  const record: OwnerDecisionsExport = {
    formatVersion: 1,
    note: EXPORT_NOTE,
    pulledAt: new Date().toISOString(),
    pulledFromSha: headSha(ROOT),
    intents: merged,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  /*
   * RULING 159: the counts print with their denominator, and an empty log is a
   * MEASURED emptiness only because the read succeeded — which it did, or we
   * would have refused above. "pulled 0" from a store we could not open would
   * print the same digits and mean the opposite.
   */
  say(`pulled ${pulled.length} intent(s); file holds ${merged.length}`);
  say(
    floorLine(
      floored(
        "intents pulled from the control plane, of the intents the export holds",
        outPath,
        merged.length,
        pulled.length,
        merged.length === 0 ? "the decision log is reachable and holds no intent yet" : undefined,
      ),
    ),
  );
  say(`raw log rows ${read.value.length}, collapsed to ${pulled.length} decision(s)`);
  say(`written  ${outPath}${record.pulledFromSha ? ` at ${record.pulledFromSha.slice(0, 12)}` : " (no git HEAD resolvable; pulledFromSha is null)"}`);
}

await main();
