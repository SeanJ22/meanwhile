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
import {
  OWNER_SURFACE_FORMAT_VERSION,
  type OwnerDecisionIntent,
  type OwnerDecisionState,
} from "../lib/control-plane/owner-surface.ts";

const NOW_ISO = new Date().toISOString();

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY_RUN = process.argv.includes("--dry-run");

function log(line: string): void {
  console.log(`owner:canonicalize · ${line}`);
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

  let moved = 0;
  for (const intent of intents) {
    if (intent.state === "CANONICALIZED" || intent.state === "REJECTED_BY_GATES") {
      log(`  ${intent.intentId} already ${intent.state} (${intent.canonicalRef ?? "-"})`);
      continue;
    }
    const ref = claimedRef(intent);
    let state: OwnerDecisionState = "PENDING_CANONICALIZATION";
    let canonicalRef: string | null = null;
    let refusedReason: string | null = null;

    if (ref === null) {
      refusedReason =
        "the chosen option names no governance record, so there is nothing to resolve yet";
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

  log(DRY_RUN ? `--dry-run: ${moved} would move` : `${moved} intent(s) resolved`);
}

await main();
