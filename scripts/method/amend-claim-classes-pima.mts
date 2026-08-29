/**
 * `method:amend-claim-classes-pima` — apply the Pima claim classification and
 * the two withdrawals to the canonical method store.
 *
 * Run once, by the integration owner. **Idempotent**: a second run attaches
 * nothing, withdraws nothing, and says so. It adds no route, so the method
 * version and the route count are unchanged by design — an amendment discovers
 * no new avenue and must not mechanically reopen conclusions as though it had.
 *
 * The store path may be given as the first argument, so the run can be proved
 * against a throwaway copy before it touches `data/method/knowledge.json`:
 *
 *     pnpm exec tsx scripts/method/amend-claim-classes-pima.mts /tmp/copy.json
 *
 * The routes it classifies and the reasoning for each withdrawal live in
 * `lib/method/pima-claim-classes.ts`, which the tests import too — so what is
 * proved is the amendment that runs, not a paraphrase of it.
 */

import { join } from "node:path";

import { runClaimAmendment } from "../../lib/method/amend.ts";
import { PIMA_CLAIM_CLASSES } from "../../lib/method/pima-claim-classes.ts";
import { today } from "../doc-dates.mjs";

const store = process.argv[2] ?? join(process.cwd(), "data", "method", "knowledge.json");

runClaimAmendment(store, PIMA_CLAIM_CLASSES, today());
