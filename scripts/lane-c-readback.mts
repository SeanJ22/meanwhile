/**
 * `pnpm readback:control-plane` — **A SEPARATE PROCESS THAT ONLY READS.**
 * (Session C3, lane C, 2026-09-01.)
 *
 * ## Why a second process exists at all
 *
 * The claim lane C has to support is that the autonomous worker system took the
 * obligations lane C registered, with no operator selecting a route. A claim
 * like that cannot rest on the output of the process that did the work, because
 * that process is the thing under test — its report agrees with it by
 * construction, exactly as a test written beside a fix does. So this opens the
 * durable control plane on its own, after the fact, reads the persisted rows
 * back and prints counts and VERBATIM dispositions.
 *
 * **It writes nothing.** There is no output path in this file, and that is the
 * point: an instrument that could write is an instrument that could write the
 * answer it is being asked to find.
 *
 * ```
 *   node --env-file=.env.local --experimental-strip-types \
 *        scripts/lane-c-readback.mts [obligation-id-prefix]
 * ```
 *
 * Env var names only. `WTP_CONTROL_PLANE_DATABASE_URL` is read BY NAME and no
 * value of it appears in the output.
 */
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const prefix = process.argv[2] ?? "";
const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(
    `lane-c-readback · ${CONTROL_PLANE_URL_VAR} is not set. Reading the file store instead would be ` +
      "evidence about a different store than the claim is about. Refusing.",
  );
  process.exit(1);
}
const repos = await createPgRepositories(url, new Date().toISOString());

const obligations = (await repos.obligations.list()).map((r) => r.value);
const occurrences = (await repos.occurrences.list()).map((r) => r.value);
const debts = (await repos.debts.list()).map((r) => r.value);

console.log(`READ BACK FROM THE DURABLE CONTROL PLANE — ${repos.describe()}`);

/*
 * THE FLOOR IS ON THE INSTRUMENT, NOT ON THE DOMAIN. (RULING 159.)
 *
 * A control plane that answered zero rows because the connection resolved to an
 * empty schema would otherwise print `0 of 0` and read exactly like a scheduler
 * that has nothing to do. The reason string says which of the two it is.
 */
const EMPTY =
  "the control plane returned ZERO obligations. That is a failed read of our own store, never a " +
  "statement that the project owes nothing.";

const mine = obligations.filter((o) => o.id.startsWith(prefix));
console.log(
  `  ${floorLine(
    floored("obligations matching " + JSON.stringify(prefix), "every obligation the control plane holds", obligations.length, mine.length, EMPTY),
  )}`,
);

const byClass = new Map<string, number>();
for (const o of obligations) byClass.set(o.recordClass, (byClass.get(o.recordClass) ?? 0) + 1);
console.log("  by recordClass, over every row the store holds:");
for (const [k, v] of [...byClass].sort()) console.log(`      ${k.padEnd(30)} ${v}`);

const withNextDue = mine.filter((o) => o.nextDueAt != null).length;
console.log(
  `  ${floorLine(
    floored("matching rows carrying a persisted next_due_at", "the matching obligations", mine.length, withNextDue, EMPTY),
  )}`,
);

const ids = new Set(mine.map((o) => o.id));
const occ = occurrences.filter((o) => ids.has(o.obligationId));
const withOccurrence = mine.filter((o) => occ.some((x) => x.obligationId === o.id)).length;
console.log(
  `  ${floorLine(
    floored("matching obligations that opened at least one occurrence", "the matching obligations", mine.length, withOccurrence, EMPTY),
  )}`,
);

/*
 * **THE DISPOSITION LOG IS THE COMMIT POINT, NOT THE OCCURRENCE FIELD.**
 *
 * An occurrence carries a `disposition` only when it CLOSED, and a
 * REQUIRES_NEW_ADAPTER never closes one — it is not in the terminal set, which
 * is the whole reason the obligation stays owed and the debt keeps accruing.
 * A read-back that counted only closed occurrences would therefore report ZERO
 * for a domain whose every route is a missing adapter, and read as "the workers
 * never touched it" when the workers touched all of it and said so.
 *
 * So the committed dispositions are read from the append-only log, joined to
 * these obligations through their occurrences' RouteTask ids.
 */
const routeTaskToObligation = new Map<string, string>();
for (const o of occ) routeTaskToObligation.set(o.routeTaskId, o.obligationId);
const commits = (await repos.dispositions.readAll()).filter((c) =>
  routeTaskToObligation.has(c.routeTaskId),
);

const terminal = occ.filter((o) => o.disposition != null);
console.log(
  `  ${floorLine(
    floored(
      "occurrences carrying a committed disposition",
      "the occurrences opened on matching obligations",
      occ.length,
      terminal.length,
      "no occurrence has been opened on a matching obligation — the clock has not passed, or the registration did not reach the store",
    ),
  )}`,
);

console.log(
  `  ${floorLine(
    floored(
      "occurrences whose RouteTask carries a COMMITTED disposition in the append-only log",
      "the occurrences opened on matching obligations",
      occ.length,
      new Set(commits.map((c) => c.routeTaskId)).size,
      "no occurrence has been opened on a matching obligation — the clock has not passed, or the " +
        "registration did not reach the store",
    ),
  )}`,
);

const dispCount = new Map<string, number>();
for (const c of commits) {
  const d = c.disposition.disposition;
  dispCount.set(d, (dispCount.get(d) ?? 0) + 1);
}
console.log("  dispositions, VERBATIM as the workers committed them:");
for (const [k, v] of [...dispCount].sort()) console.log(`      ${k.padEnd(30)} ${v}`);
console.log(
  "      (a disposition that is not TERMINAL — REQUIRES_NEW_ADAPTER — is committed and does NOT close " +
    "the occurrence: the obligation stays owed, the debt accrues and the next-due stands)",
);

const myDebts = debts.filter((d) => ids.has(d.obligationId));
console.log(`  debt rows on matching obligations                ${myDebts.length}`);
console.log("");
console.log("  three committed dispositions, verbatim, with the note the worker wrote:");
for (const c of commits.slice(0, 3)) {
  console.log(`      ${c.disposition.disposition} on routeTask ${c.routeTaskId.slice(0, 16)} at ${c.committedAt}`);
  console.log(`          permission=${c.disposition.permission} transport=${c.disposition.transport}`);
  console.log(`          ${c.disposition.note.slice(0, 380)}`);
}

const show = Number(process.env.READBACK_SHOW ?? "12");
console.log(`\n  first ${show} matching rows, verbatim:`);
for (const o of mine.slice(0, show)) {
  const os = occ.filter((x) => x.obligationId === o.id);
  const last = os[os.length - 1];
  console.log(
    `      ${o.id}\n          class=${o.recordClass} route=${o.routeId} next_due=${o.nextDueAt ?? "null"} ` +
      `occurrences=${os.length} lastDisposition=${last?.disposition ?? "none"}`,
  );
}
