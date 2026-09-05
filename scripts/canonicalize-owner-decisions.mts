/**
 * **THE OTHER HALF OF THE DECISION BUTTON.**
 * (Session C final, ITEM H, 2026-09-01. `pnpm owner:canonicalize`.)
 *
 * A decision card in the control centre appends an INTENT. This is the
 * authorized local step that turns an intent into a canonical fact — and,
 * critically, the step that RECORDS on the intent what it became, so the page
 * can stop saying `PENDING_CANONICALIZATION` and say what actually landed.
 *
 * ## Why the browser could not have done this
 *
 * CLAUDE.md: a governance change is ATOMIC. The canonical event, the operative
 * policy, the regenerated views, the regenerated context and a passing
 * `pnpm governance:check` land together, or the change has not happened. A web
 * request can do exactly one of those and would leave a generated artifact
 * hand-edited (RULING 92) with its generator's output no longer matching it
 * (RULING 102). So the browser records WHAT WAS DECIDED and this runs where the
 * repository, the compiler and the gates are.
 *
 * ## What this script does and does not do
 *
 * It does **not** write law. It RESOLVES an intent against the canonical ledger
 * — `docs/governance/ledger.jsonl`, read through `loadIndex` so alias
 * resolution is the ledger's own (`RULING 231`, `R231`, `R-0231` and `R-231`
 * all resolve) — and moves the intent to:
 *
 * ```
 *   CANONICALIZED             the named record EXISTS in the ledger and is
 *                             current; canonicalRef is set to its canonical id
 *   PENDING_CANONICALIZATION  it does not exist yet — the governance change has
 *                             not been made, and the card keeps saying so
 *   REJECTED_BY_GATES         the record exists and is NOT current (superseded,
 *                             retired), so pointing an owner decision at it
 *                             would be citing law that no longer holds
 * ```
 *
 * **A missing record is never an error here.** The whole point of the
 * `PENDING_CANONICALIZATION` state is that the intent survives, visible, until
 * somebody makes the change. An intent that vanished because its ruling had not
 * been adopted yet would be a decision the owner made and the machine forgot.
 *
 * ## Why the resolution is against the LEDGER and not a string the owner typed
 *
 * `canonicalRef` has to be checkable. If this stored whatever reference the
 * card carried, the page would display a ruling number that might name nothing
 * — and this repository has already been bitten by exactly that: 15 of 23
 * `checkId`s cited in one sweep resolved to nothing at all. A reference that
 * was not resolved against the store it names is not a reference.
 */

import { isAbsolute } from "node:path";

import { loadIndex } from "../lib/governance/ledger.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { DECISION_LOG_KEY } from "../lib/control-plane/admin-data.ts";
import { isResolutionRecord, resolvedIntentId } from "../lib/control-plane/decision-log.ts";
import {
  OWNER_SURFACE_FORMAT_VERSION,
  type OwnerDecisionIntent,
  type OwnerDecisionState,
} from "../lib/control-plane/owner-surface.ts";
import { RESOLVED_CSV, ROOT, readStore } from "./tracker-core.mjs";

const NOW_ISO = new Date().toISOString();

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY_RUN = process.argv.includes("--dry-run");

function log(line: string): void {
  console.log(`owner:canonicalize · ${line}`);
}

/**
 * **THE TRACKER IS A CANONICAL RECORD TOO.** (ADM-4, the 9.4.26 admin feedback.)
 *
 * A decision on a Needs Sean row does not become a ruling; it becomes a row in
 * `docs/tracker-resolved.csv` whose `Closed by` carries the intent id — that is
 * what `pnpm tracker:move` writes when it applies the decision (RULING 271).
 * Until this branch existed such a decision stayed `PENDING_CANONICALIZATION`
 * forever, because the only record this script knew how to resolve against
 * was the governance ledger, and the card kept telling the owner a decision
 * he had watched land had not.
 *
 * The resolution is against the STORE, not against anything the intent says
 * about itself: the row must exist, be resolved, and name this intent in the
 * column the move script writes. `--resolved=<path>` points the check at a
 * different CSV for proofs (`tests/owner-decisions-outflow.test.ts`); the
 * reference then names that path, because a reference names the store it was
 * checked against.
 */
const RESOLVED_STORE = arg("resolved") ?? RESOLVED_CSV;

function trackerCloses(): Map<string, string> {
  const rows = readStore(RESOLVED_STORE, isAbsolute(RESOLVED_STORE) ? "" : ROOT);
  const refs = new Map<string, string>();
  for (const row of rows) {
    const closedBy = row["Closed by"] ?? "";
    const hit = /\(dashboard ([^)]+)\)/.exec(closedBy);
    if (!hit) continue;
    refs.set(
      hit[1].trim(),
      `${RESOLVED_STORE}#${(row.ID ?? "").trim()} (resolved ${(row["Resolved on"] ?? "").trim() || "on an unrecorded date"})`,
    );
  }
  return refs;
}

async function repositories(): Promise<ControlPlaneRepositories> {
  const override = arg("file-store");
  if (override) return createFileRepositories(override);
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    throw new Error(
      `${CONTROL_PLANE_URL_VAR} is not set. Resolving intents against a different store would ` +
        "be evidence about a different store than the claim is about. Refusing.",
    );
  }
  return createPgRepositories(url, NOW_ISO);
}

/**
 * The reference a decision claims to have become.
 *
 * Carried on the option itself, in the form `-> R-0231` or `-> RULING 231`, so
 * the card's own text is the thing that says which record answers it. An option
 * with no such marker is a decision that does not become a ruling at all —
 * a tracker resolution, say — and stays pending until something records it.
 */
function claimedRef(intent: OwnerDecisionIntent): string | null {
  const source = `${intent.chosenOption} ${intent.consequenceShown}`;
  const hit = source.match(/->\s*((?:RULING\s+\d+)|(?:R-?\d+))/i);
  return hit ? hit[1].trim() : null;
}

async function main(): Promise<void> {
  const index = loadIndex();
  const repos = await repositories();
  log(repos.describe());
  log(`ledger: ${index.records.length} record(s), highest adopted number ${index.highestNumber()}`);

  const intents = await repos.ownerDecisions.read(DECISION_LOG_KEY);
  // RULING 159: an empty log is a MEASURED emptiness only because the read
  // succeeded. "0 intents" from a store we could not open would print the same
  // and mean something completely different.
  log(
    floorLine(
      floored(
        "decision intents",
        "the owner-decision log",
        Math.max(intents.length, 1),
        intents.length,
        intents.length === 0 ? "the log is reachable and holds no intent yet" : undefined,
      ),
    ),
  );

  const tracker = trackerCloses();
  log(`tracker: ${RESOLVED_STORE} names ${tracker.size} dashboard close(s) in its Closed by column`);

  /*
   * A decision that has already been resolved is SKIPPED, by looking for its
   * `#resolved` twin in the log. Until 2026-09-04 this loop looked only at the
   * original's own `state` — which never changes, because the log is
   * append-only — so every run re-derived the same resolution and tried to
   * append the same twin again, forever. The store's idempotent append
   * swallowed the byte-identical ones and would have THROWN on the first that
   * differed, which is a script that fails on the day the resolution changes.
   */
  const ids = new Set(intents.map((i) => i.intentId));
  let moved = 0;
  let skipped = 0;
  for (const intent of intents) {
    if (isResolutionRecord(intent)) {
      skipped += 1;
      continue;
    }
    if (ids.has(resolvedIntentId(intent.intentId))) {
      log(`  ${intent.intentId} already resolved (its #resolved record is in the log)`);
      skipped += 1;
      continue;
    }
    if (intent.state === "CANONICALIZED" || intent.state === "REJECTED_BY_GATES") {
      log(`  ${intent.intentId} already ${intent.state} (${intent.canonicalRef ?? "-"})`);
      continue;
    }
    let state: OwnerDecisionState = "PENDING_CANONICALIZATION";
    let canonicalRef: string | null = null;
    let refusedReason: string | null = null;

    const trackerRef = tracker.get(intent.intentId) ?? null;
    const ref = trackerRef === null ? claimedRef(intent) : null;
    if (trackerRef !== null) {
      // The tracker applied it: the row is resolved and names this intent.
      state = "CANONICALIZED";
      canonicalRef = trackerRef;
    } else if (ref === null) {
      refusedReason =
        "the chosen option names no governance record and no resolved tracker row names " +
        "this intent yet, so there is nothing to resolve against";
    } else {
      const record = index.resolve(ref);
      if (!record) {
        refusedReason =
          `${ref} does not exist in the canonical ledger yet. The governance change has not ` +
          "been made — the decision stands and is waiting for it.";
      } else if (!index.current().some((r) => r.id === record.id)) {
        state = "REJECTED_BY_GATES";
        refusedReason =
          `${ref} resolves to ${record.id}, whose status is ${record.status}. An owner decision ` +
          "may not be recorded against law that is no longer current.";
      } else {
        state = "CANONICALIZED";
        canonicalRef = record.id;
      }
    }

    log(
      `  ${intent.intentId} ${intent.subjectId} -> ${state}` +
        `${canonicalRef ? ` as ${canonicalRef}` : ""}${refusedReason ? ` (${refusedReason})` : ""}`,
    );

    if (state === "PENDING_CANONICALIZATION" && intent.state === "PENDING_CANONICALIZATION") {
      // Nothing changed; do not rewrite the log for a no-op.
      continue;
    }
    if (DRY_RUN) continue;

    /*
     * The log is APPEND-ONLY and a rewrite is refused by the repository, which
     * is correct: what the owner decided at that instant is not editable. The
     * RESOLUTION is a new record carrying the same intent id plus a suffix, so
     * the original decision and what became of it both survive, in order.
     */
    const resolved: OwnerDecisionIntent = {
      ...intent,
      formatVersion: OWNER_SURFACE_FORMAT_VERSION,
      intentId: `${intent.intentId}#resolved`,
      state,
      canonicalRef,
      refusedReason,
    };
    await repos.ownerDecisions.append(DECISION_LOG_KEY, resolved.intentId, resolved, NOW_ISO);
    moved += 1;
  }

  log(
    `${DRY_RUN ? `--dry-run: ${moved} would move` : `${moved} intent(s) resolved`}; ` +
      `${skipped} of ${intents.length} log row(s) were resolution records or already-resolved originals`,
  );
}

await main();
