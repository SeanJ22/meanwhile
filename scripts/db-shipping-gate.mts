/**
 * **THE SHIPPING GATE — asked BEFORE the merge, not the morning after.**
 * (2026-08-28, the P0 schema-drift incident. Intake tripwire run 33211710028.)
 *
 * ## THE DETECTOR WAS NEVER MISSING. ITS PLACEMENT WAS.
 *
 * This repository already asked the question in three places, all of them the
 * same `compareSchemaState`:
 *
 *   - At the time of the incident, `pnpm db:check` ran daily in
 *     `intake-tripwire.yml`. It caught run 33211710028 the morning AFTER the
 *     deploy. PDC V2 later retired that GitHub runtime/operations clock.
 *   - `scripts/walk-all.mts`'s `[promptD]` check, through `/api/schema`. It
 *     also caught it, as a named regression. But RULING 125 points every walk
 *     at a LOCAL production build, so it asks `DATABASE_URL` — the development
 *     branch — and its own detail line says so. It is not a production check,
 *     and it is a standing net a session runs by hand.
 *   - `app/api/schema/route.ts`, which is what that walk reads.
 *
 * **Not one of them sits in the merge or deploy path.** Nothing consults them
 * before a pull request lands, so `0021_mixed_red_ghost` and
 * `0022_adorable_hemingway` merged and deployed with `ask_interactions` absent
 * from production — and because the route catches the insert failure and serves
 * the page anyway, a reader saw a working site while Ask interactions were
 * silently dropped. **A repair that only makes the failure louder afterwards
 * does not address that. The ordering is the defect.**
 *
 * So this asks the same question, with the same comparator and the same reader
 * (`lib/db/applied-migrations.ts`), at the point where the answer can still
 * change what happens: `build-check.yml`'s `gates` job, on every pull request
 * and every push to `main`, and `pnpm gates`, the local door. It differs from
 * `db:check` in three ways that matter, and those differences are the reason it
 * is a separate entry point rather than a flag on that one:
 *
 *   1. **It is scoped.** A change that does not touch the schema contract is
 *      NOT APPLICABLE and never opens a connection. A docs-only pull request
 *      must not be gated on a database round trip.
 *   2. **It knows about EXPAND and CONTRACT.** `db:check` fails on any missing
 *      migration, which is right for a daily sweep and wrong for a merge gate:
 *      expands may be pending for the production build to apply before serving;
 *      a contract migration is SUPPOSED to be missing until its code is live.
 *      See `lib/db/migration-phases.ts`.
 *   3. **It reads the change**, so it can tell a migration this change
 *      introduces from one that was already owed.
 *
 * ## THE GITHUB RUNTIME TRIPWIRE IS RETIRED
 *
 * PDC V2 removed `intake-tripwire.yml`: GitHub Actions is software CI/release
 * infrastructure, not a routine operations clock. Defence in depth now sits
 * on the two software lifecycle boundaries that can prevent or expose this
 * class: this fail-closed pre-merge/push gate and the automatic
 * `post-deploy-integrity.yml` reading after a shipping main push. `pnpm
 * db:check` remains an explicit diagnostic; it is not a scheduled Git writer.
 *
 * ## IT NEVER APPLIES ANYTHING
 *
 * Read-only, through `WTP_PRODUCTION_DATABASE_URL_READONLY`, by name. A gate
 * that could fix what it finds would apply an unreviewed migration from a pull
 * request check. Applying is `pnpm db:apply`, which resolves a different
 * variable and refuses this one.
 *
 * ## AND AN ESTABLISHED MIGRATION IS IMMUTABLE (2026-08-28, the audit)
 *
 * The gate above knows a migration file CHANGED and could not tell which way.
 * `lib/db/migration-immutability.ts` carries that reasoning in full; the short
 * version is that the applied-join is on the journal's `when`, never on the
 * SQL, so a migration whose file is rewritten after it was applied still reads
 * as applied on every surface in this repository while the committed SQL is no
 * longer the SQL production executed. That half runs FIRST here, needs no
 * credential and no network, and fails on its own.
 *
 * ## THE SMOKE PATH — proving the credential without inventing a diff
 *
 * `--smoke` (or `WTP_SCHEMA_GATE_SMOKE=true`) forces the gate to contact
 * production on a commit that changed nothing, and prints the role, the host
 * and the row count it got back. The read-only credential is present in the
 * software CI/release environment; an explicit smoke run proves it can READ
 * production without waiting for the next schema change or faking one. It
 * issues the same single SELECT and nothing else, and it never applies
 * anything.
 *
 * ## THE DEPLOY HALF
 *
 * A pre-merge reading is true about the moment it was taken. It does not stay
 * true: a merge is not a deploy in this repository — `netlify.toml` filters
 * deploys by path, previews and branch deploys never build, and the production
 * main build applies pending expands before building. The schema can move
 * between the gate passing and the code serving.
 *
 * `--moment=post-deploy` (or `WTP_SCHEMA_GATE_MOMENT=post-deploy`) is that
 * second reading, and it is the one that fails on an unapplied CONTRACT
 * migration, which pre-deploy deliberately allows. The software-only
 * `post-deploy-integrity.yml` workflow now runs it automatically after a
 * shipping push to main: Netlify does not emit GitHub deployment-status events
 * for this repository, so the workflow observes the served SHA under a bound
 * and then takes this exact read-only post-deploy measurement. It creates no
 * Git commit and is not a routine data or operations clock.
 *
 * ## Exit codes, matching `db:check`
 *
 *   0  the invariant holds, or the change does not touch the schema contract
 *   1  REFUSED — a migration is on the wrong side of the deploy, or an
 *      established migration was rewritten, deleted or renamed. Named.
 *   2  COULD NOT TELL — no credential, an unreadable migrations table, or an
 *      unreachable merge base. Never a pass. An unreadable answer must not
 *      print like a passing one.
 *
 * Run:
 *   pnpm exec tsx scripts/db-shipping-gate.mts
 *   pnpm exec tsx scripts/db-shipping-gate.mts --moment=post-deploy
 *   pnpm exec tsx scripts/db-shipping-gate.mts --paths=lib/db/migrations/0021_mixed_red_ghost.sql
 *   pnpm exec tsx scripts/db-shipping-gate.mts --base=origin/main
 *   pnpm exec tsx scripts/db-shipping-gate.mts --smoke
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";

import { describeConnection, readAppliedMigrationWhen } from "../lib/db/applied-migrations.ts";
import { readJournal, type JournalEntry } from "../lib/db/schema-state.ts";
import { PHASE_ORDERING } from "../lib/db/migration-phases.ts";
import {
  appliedHashesFrom,
  checksumViolations,
  evaluateMigrationImmutability,
  JOURNAL_PATH,
  MIGRATION_SQL_PATH,
  parseNameStatus,
  parsePorcelain,
  type ChangedEntry,
} from "../lib/db/migration-immutability.ts";
import {
  evaluateShippingInvariant,
  migrationTagsIn,
  schemaInvolvement,
  SCHEMA_CONTRACT_PATHS,
  type ShipMoment,
} from "../lib/db/shipping-invariant.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

/**
 * WHICH SIDE OF THE DEPLOY THIS RUN IS ASKING FROM.
 *
 * The flag is the primary; the environment variable exists so a
 * `workflow_dispatch` input can select it WITHOUT changing the `run:` line in
 * `build-check.yml` — that line is compared against `scripts/gates.mjs` by
 * `tests/gate-parity.test.ts`, and a gate whose CI command drifts from its
 * local command is the RO04 hole.
 *
 * **This is also the half of the deploy-time question that can be asked
 * today.** A pre-deploy reading is true about the moment it was taken; it does
 * not stay true after the deploy, and `post-deploy` is where BOTH phases are
 * owed — the contract half of a two-sided change being the half that is easy to
 * forget. The production runner applies contracts only when the exact commit
 * is serving and loaded; this reading still reports any pending migration.
 */
const MOMENT: ShipMoment =
  arg("moment") === "post-deploy" || process.env.WTP_SCHEMA_GATE_MOMENT === "post-deploy"
    ? "post-deploy"
    : "pre-deploy";
const VARIABLE = "WTP_PRODUCTION_DATABASE_URL_READONLY";

/**
 * SMOKE — deliberately contact production on a commit that changed nothing.
 *
 * Never inferred from anything. It is a flag a person passes, or an input a
 * person supplies to `workflow_dispatch`; nothing about a normal run can turn
 * it on, because a gate that decided for itself when to open a connection
 * would be a gate nobody can predict.
 */
const SMOKE =
  argv.includes("--smoke") ||
  /^(1|true|yes|on)$/i.test(process.env.WTP_SCHEMA_GATE_SMOKE ?? "");

function say(line = ""): void {
  process.stdout.write(`${line}\n`);
}
function complain(line: string): void {
  process.stderr.write(`${line}\n`);
}

/* -------------------------------------------------------------------------- */
/* WHAT CHANGED                                                               */
/* -------------------------------------------------------------------------- */

function git(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/**
 * The changed paths, or `null` when they genuinely could not be read.
 *
 * **THE METHOD USED IS PRINTED, never inferred from the result** — the same
 * discipline every fail-closed shipping adapter applies to its path guard. Each rung
 * says what it read, so a run that decided NOT APPLICABLE can be checked
 * against the reason it decided that.
 *
 * `null` is not an empty list. An empty list is a real measurement; `null` is
 * the absence of one, and `schemaInvolvement` treats it as involved.
 */
function changedPaths(): string[] | null {
  const explicit = arg("paths");
  if (explicit !== null) {
    say(`  paths: stated on the command line`);
    return explicit.split(",").map((p) => p.trim()).filter(Boolean);
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventPath && eventName) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
        commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
        pull_request?: { base?: { sha?: string } };
      };

      if (eventName === "push" && Array.isArray(event.commits)) {
        const paths = new Set<string>();
        for (const c of event.commits) {
          for (const p of [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]) {
            paths.add(p);
          }
        }
        say(`  paths: the push event's own commit list (${paths.size} path(s))`);
        return [...paths];
      }

      const base = event.pull_request?.base?.sha;
      if (eventName === "pull_request" && base) {
        if (!git(["cat-file", "-e", `${base}^{commit}`]).ok) {
          // A shallow `actions/checkout` will not have the base commit. Fetch
          // it rather than guessing — the same move netlify-ignore.mjs makes.
          spawnSync("git", ["fetch", "--depth=100", "origin", base], { stdio: "ignore" });
        }
        const diff = git(["diff", "--name-only", base, "HEAD"]);
        if (diff.ok) {
          say(`  paths: git diff ${base.slice(0, 7)}..HEAD (the pull request's base)`);
          return diff.out ? diff.out.split("\n") : [];
        }
        complain(`  paths: the base commit ${base.slice(0, 7)} could not be diffed against HEAD`);
        return null;
      }
    } catch (error) {
      complain(`  paths: the event payload could not be read — ${(error as Error).message}`);
      return null;
    }
  }

  /*
   * LOCAL. Two readings, unioned, because a session running `pnpm gates` before
   * committing has its schema change in the WORKING TREE and a reading that
   * only looked at commits would report NOT APPLICABLE about a migration
   * sitting on disk.
   */
  const committed = git(["diff", "--name-only", "origin/main...HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  if (!committed.ok && !dirty.ok) {
    complain("  paths: neither origin/main...HEAD nor the working tree could be read");
    return null;
  }
  const paths = new Set<string>();
  if (committed.ok) for (const p of committed.out.split("\n").filter(Boolean)) paths.add(p);
  if (dirty.ok) {
    for (const line of dirty.out.split("\n").filter(Boolean)) {
      const body = line.slice(3);
      paths.add(body.includes(" -> ") ? body.split(" -> ")[1] : body);
    }
  }
  say(
    `  paths: ${committed.ok ? "origin/main...HEAD" : "(origin/main unreadable)"} union the working tree ` +
      `(${paths.size} path(s))`,
  );
  return [...paths];
}

/* -------------------------------------------------------------------------- */
/* WHICH WAY IT CHANGED — the merge base, and how it is reached on CI         */
/* -------------------------------------------------------------------------- */

/**
 * The reading behind the immutability guard.
 *
 * `changedPaths()` above answers "what moved"; this answers "which way", and
 * it needs a BASE TREE rather than a path list. Both are printed with the rung
 * that produced them, so a verdict can be checked against the reason it was
 * reached rather than inferred from the verdict.
 */
interface BaseReading {
  /** The commit-ish everything is compared against, or null when unreachable. */
  readonly base: string | null;
  /** Printed verbatim in the verdict. Names the rung, not just the sha. */
  readonly how: string;
  /** The directed changes, or null when they could not be computed. */
  readonly changes: ChangedEntry[] | null;
  /** The journal AS OF the base, or null when it could not be read. */
  readonly baseJournal: JournalEntry[] | null;
}

/**
 * **THE SHALLOW-CLONE PROBLEM, AND WHY THIS IS NOT BUILT ON `git log`.**
 *
 * `actions/checkout` clones at depth 1. Two consequences, both measured in
 * this repository before now:
 *
 *   - **A per-file `git log` returns the TIP date for every file on CI**, with
 *     no error at all. Anything reasoning about "when was this file last
 *     touched" is therefore reading a constant. Nothing here uses dates.
 *   - `git merge-base` needs shared history and a depth-1 clone has none, so
 *     it fails on CI while working perfectly on a laptop — the worst shape a
 *     guard can have.
 *
 * So the base is TAKEN, never computed, wherever the platform states it:
 *
 *   PULL REQUEST — `pull_request.base.sha` from the event payload. The ref
 *   `actions/checkout` leaves in the tree is `refs/pull/N/merge`, which
 *   ALREADY merges the base, so `diff base HEAD` is exactly the pull request's
 *   own changes; that is the merge-base comparison, without calling
 *   `merge-base`. The commit is fetched by sha when it is absent — the same
 *   move `changedPaths()` already makes — deepening rather than unshallowing,
 *   because this repository's pack is 311 MiB and a full history fetch on
 *   every pull request is a real cost paid for nothing.
 *
 *   PUSH TO MAIN — the push event's own `added`/`modified`/`removed` lists.
 *   GitHub has already computed the direction; no git history is required at
 *   all. `event.before` is used for the base journal when it can be fetched.
 *
 *   LOCAL / DISPATCH — `git merge-base origin/main HEAD`, which is sound here
 *   because a developer clone is complete. A dispatch run on `main` compares
 *   HEAD with itself and reports zero changes, which is TRUE: a dispatch
 *   proposes no change.
 *
 * A base that cannot be reached is `null` and reports COULD NOT TELL. It is
 * never quietly treated as "nothing changed".
 */
function ensureCommit(sha: string): boolean {
  if (git(["cat-file", "-e", `${sha}^{commit}`]).ok) return true;
  for (const depth of [100, 1000]) {
    spawnSync("git", ["fetch", `--depth=${depth}`, "origin", sha], {
      stdio: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (git(["cat-file", "-e", `${sha}^{commit}`]).ok) return true;
  }
  return false;
}

function journalAt(base: string): JournalEntry[] | null {
  const shown = git(["show", `${base}:${JOURNAL_PATH}`]);
  if (!shown.ok) return null;
  try {
    return (JSON.parse(shown.out) as { entries: JournalEntry[] }).entries;
  } catch {
    return null;
  }
}

function baseReading(): BaseReading {
  const stated = arg("base");
  if (stated !== null) {
    const ok = ensureCommit(stated) || git(["rev-parse", "--verify", stated]).ok;
    if (!ok) {
      complain(`  base: --base=${stated} does not resolve in this checkout`);
      return { base: null, how: `--base=${stated} (UNRESOLVABLE)`, changes: null, baseJournal: null };
    }
    const diff = git(["diff", "--name-status", stated, "HEAD"]);
    return {
      base: stated,
      how: `--base=${stated}, stated on the command line`,
      changes: diff.ok ? parseNameStatus(diff.out) : null,
      baseJournal: journalAt(stated),
    };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventPath && eventName) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
        before?: string;
        commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
        pull_request?: { base?: { sha?: string } };
      };

      if (eventName === "pull_request") {
        const base = event.pull_request?.base?.sha;
        if (base && ensureCommit(base)) {
          const diff = git(["diff", "--name-status", base, "HEAD"]);
          return {
            base,
            how: `the pull request's base ${base.slice(0, 7)} (git diff --name-status ${base.slice(0, 7)} HEAD, against refs/pull/N/merge)`,
            changes: diff.ok ? parseNameStatus(diff.out) : null,
            baseJournal: journalAt(base),
          };
        }
        complain(
          `  base: the pull request's base commit ${(base ?? "(absent from the event)").slice(0, 7)} ` +
            "could not be reached even after deepening",
        );
        return {
          base: null,
          how: "the pull request's base (UNREACHABLE)",
          changes: null,
          baseJournal: null,
        };
      }

      if (eventName === "push" && Array.isArray(event.commits)) {
        /*
         * GITHUB ALREADY DID THE CLASSIFICATION. Every commit in the push
         * carries `added`, `modified` and `removed` — direction included — so
         * this rung needs no history whatsoever, which is exactly what a depth-1
         * clone has. A rename arrives as a removal plus an addition, and the
         * removal alone is enough to refuse it.
         */
        const changes: ChangedEntry[] = [];
        const seen = new Set<string>();
        for (const c of event.commits) {
          for (const [status, list] of [
            ["modified", c.modified ?? []],
            ["deleted", c.removed ?? []],
            ["added", c.added ?? []],
          ] as const) {
            for (const path of list) {
              const key = `${status} ${path}`;
              if (seen.has(key)) continue;
              seen.add(key);
              changes.push({ status, path, from: null, raw: `${status}\t${path}` });
            }
          }
        }
        const before = event.before;
        const baseJournal = before && ensureCommit(before) ? journalAt(before) : null;
        return {
          base: before ?? null,
          how:
            `the push event's own added/modified/removed lists across ${event.commits.length} ` +
            `commit(s)${before ? `, journal read at ${before.slice(0, 7)}` : ""}`,
          changes,
          baseJournal,
        };
      }
    } catch (error) {
      complain(`  base: the event payload could not be read — ${(error as Error).message}`);
      return { base: null, how: "the event payload (UNREADABLE)", changes: null, baseJournal: null };
    }
  }

  /*
   * LOCAL, and a dispatch run falls here too. The clone is complete, so
   * `merge-base` is sound. The WORKING TREE is unioned in for the same reason
   * `changedPaths()` does it: a session running `pnpm gates` before committing
   * has its rewrite on disk, and a guard that only read committed history would
   * pass a change it is looking straight at.
   */
  const mergeBase = git(["merge-base", "origin/main", "HEAD"]);
  const base = mergeBase.ok && mergeBase.out ? mergeBase.out : git(["rev-parse", "HEAD"]).out;
  if (!base) {
    complain("  base: neither origin/main nor HEAD resolves in this checkout");
    return { base: null, how: "the local merge base (UNRESOLVABLE)", changes: null, baseJournal: null };
  }
  const committed = git(["diff", "--name-status", base, "HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  if (!committed.ok && !dirty.ok) {
    return {
      base,
      how: `${base.slice(0, 7)} (NEITHER the diff NOR the working tree could be read)`,
      changes: null,
      baseJournal: journalAt(base),
    };
  }
  const changes = [
    ...(committed.ok ? parseNameStatus(committed.out) : []),
    ...(dirty.ok ? parsePorcelain(dirty.out) : []),
  ];
  return {
    base,
    how:
      `${mergeBase.ok ? "git merge-base origin/main HEAD" : "HEAD (origin/main unresolvable)"} ` +
      `= ${base.slice(0, 7)}, union the working tree`,
    changes,
    baseJournal: journalAt(base),
  };
}

/** Every `NNNN_tag` with a committed `.sql` file, read off the disk at HEAD. */
function sqlTagsOnDisk(): string[] {
  return readdirSync(join(process.cwd(), "lib", "db", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => `lib/db/migrations/${f}`)
    .map((p) => MIGRATION_SQL_PATH.exec(p)?.[1])
    .filter((t): t is string => typeof t === "string")
    .sort();
}

/** sha256 of a migration's RAW BYTES — the same digest `db:apply` records. */
function sha256OfMigration(tag: string): string | null {
  try {
    return createHash("sha256")
      .update(readFileSync(join(process.cwd(), "lib", "db", "migrations", `${tag}.sql`)))
      .digest("hex");
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* THE GATE                                                                   */
/* -------------------------------------------------------------------------- */

say(`db:gate  moment=${MOMENT}${SMOKE ? "  SMOKE (production contact forced)" : ""}`);

const changed = changedPaths();
const involvement = schemaInvolvement(changed);

/* -------------------------------------------------------------------------- */
/* IMMUTABILITY — FIRST, and with no credential                               */
/* -------------------------------------------------------------------------- */

/*
 * THIS RUNS BEFORE THE CREDENTIAL AND BEFORE THE NOT-APPLICABLE EXIT.
 *
 * Deliberately ahead of the exit: a rewrite of
 * `lib/db/migrations/0021_mixed_red_ghost.sql` is itself a change under the
 * schema contract, so scoping could never skip it — but a future widening of
 * that scope test must not be able to turn this guard off as a side effect.
 * It needs no database, so it costs a fork pull request and a laptop with no
 * `.env.local` exactly nothing.
 */
const reading = baseReading();
say(`  base:  ${reading.how}`);

const immutability = evaluateMigrationImmutability({
  changes: reading.changes,
  baseDescription: reading.how,
  baseJournal: reading.baseJournal,
  headJournal: readJournal(),
  sqlTagsOnDisk: sqlTagsOnDisk(),
});

for (const asked of immutability.checked) say(`  checked: ${asked}`);
for (const gap of immutability.cannotTell) complain(`  COULD NOT ASK: ${gap}`);

if (immutability.verdict === "fail") {
  complain(`\nREFUSED — ${immutability.summary}`);
  for (const failure of immutability.failures) complain(`\n  ${failure}`);
  complain(
    "\n  There is no skip flag. A migration that exists in the merge base has shipped; the " +
      "applied-join is on the journal's `when` and never on the SQL, so a rewrite reports as " +
      "APPLIED and IN SYNC on every surface this repository has.",
  );
  process.exit(1);
}
if (immutability.verdict === "cannot-tell") {
  /*
   * THE ONE NARROWING, AND IT IS A DIFFERENT MEASUREMENT — NOT A CONCESSION.
   *
   * An unreachable merge base means the DIRECTION of a migration change is
   * unknown, and direction is the whole question here. But `changedPaths()` is
   * a SECOND, independently-taken reading, and when it succeeded and holds no
   * path under `lib/db/migrations/` at all, there is no migration change whose
   * direction could matter — a deletion appears in every rung of that reading
   * (`git diff --name-only` lists removed paths, the push event has `removed`,
   * `git status --porcelain` has ` D`), so "no migration path" is a real
   * finding rather than an assumption.
   *
   * `changed === null` does NOT reach here: `schemaInvolvement(null)` returns
   * involved, so an unreadable path list keeps the refusal.
   */
  if (!involvement.involved) {
    say(`\n  ${immutability.summary}`);
    say(
      "  NOT REFUSED, and the reason is a SECOND reading rather than a lowered bar: the " +
        `changed-path list WAS readable and holds no path under lib/db/migrations/ ` +
        `(${involvement.reason}), so no migration changed in any direction.`,
    );
  } else {
    complain(`\ndb:gate: COULD NOT TELL — ${immutability.summary}`);
    complain(
      "  This is not a pass, and this change DOES touch the schema contract. Give the run a " +
        "reachable base: --base=<ref> locally, or a checkout with enough history for the pull " +
        "request's base commit to be fetched by sha.",
    );
    process.exit(2);
  }
} else {
  say(`  ${immutability.summary}`);
}

if (!involvement.involved && SMOKE) {
  /*
   * SMOKE, and the ONE thing it may not do is manufacture a change.
   *
   * The temptation, when a credential needs proving on a quiet commit, is to
   * pass a fake `--paths=` naming a migration — which makes the gate lie about
   * what this change did, in a log somebody will read later. So the scope test
   * runs honestly, prints its honest NOT APPLICABLE, and the smoke flag
   * OVERRIDES the exit rather than the finding. `introduced` stays empty below
   * for exactly the same reason: nothing is being introduced.
   */
  say(`\nNOT APPLICABLE — ${involvement.reason}.`);
  say("  SMOKE: contacting production anyway, on purpose, to prove the credential can READ it.");
  say("  Nothing about this change was altered to reach the database.");
}

if (!involvement.involved && !SMOKE) {
  say(`\nNOT APPLICABLE — ${involvement.reason}.`);
  say("  The schema contract is lib/db/migrations/ and lib/db/schema.ts:");
  for (const { prefix, why } of SCHEMA_CONTRACT_PATHS) say(`    ${prefix}  ${why}`);
  say("  No database was contacted. A docs-only change is not gated on a round trip.");
  process.exit(0);
}

if (involvement.involved) say(`\nAPPLICABLE — ${involvement.reason}.`);
for (const p of involvement.paths) say(`    ${p}`);
if (involvement.cannotTell) {
  say("  (This is the fail-safe reading: an unreadable diff asks production rather than assuming.)");
}

const introduced = changed ? migrationTagsIn(changed) : [];
if (introduced.length > 0) {
  say(`  migrations introduced by this change: ${introduced.join(", ")}`);
} else {
  say("  this change introduces no migration file of its own");
}

const connection = process.env[VARIABLE];
if (!connection) {
  complain(`\ndb:gate: COULD NOT TELL — ${VARIABLE} is not set in this environment.`);
  complain("  An unset credential is not a passing schema check (RULING 24).");
  complain(
    "  In CI this is a repository secret. Add WTP_PRODUCTION_DATABASE_URL_READONLY under " +
      "Settings > Secrets and variables > Actions; the value is the read-only production string " +
      "already recorded in docs/credential-ledger.md. The READONLY role is deliberate: this gate " +
      "must not be able to apply what it finds.",
  );
  process.exit(2);
}

say(`  reading ${VARIABLE}  ${describeConnection(connection)}`);

/*
 * THE SAME READER `pnpm db:check` USES — `lib/db/applied-migrations.ts`, one
 * SELECT, one idea of what a failure means. The detector is not duplicated
 * either: the delta below is `compareSchemaState`, the identical function
 * behind `db:check`, `app/api/schema/route.ts` and walk:all's `[promptD]`
 * check. What this file adds is the two things a merge gate needs and a daily
 * sweep must not have — a PHASE, so a contract migration is allowed to be
 * pending, and a SCOPE, so a docs-only change costs nothing.
 */
const read = await readAppliedMigrationWhen(connection);
if (!read.ok) {
  complain(`\ndb:gate: COULD NOT TELL — drizzle.__drizzle_migrations was unreadable: ${read.why}`);
  complain("  This is not 'zero applied'. Nothing is concluded about production's schema.");
  process.exit(2);
}

if (SMOKE) {
  /*
   * THE CREDENTIAL PROOF, and what it is careful NOT to print.
   *
   * Role, host and database name — the same three fields `pnpm verify:readonly`
   * prints, and for the same reason: they say WHICH database answered without
   * carrying the password, the query string or anything the secrets sweep would
   * have to treat as a leak. `describeConnection` builds the role/host half
   * from a parsed URL, so a connection string cannot be echoed by accident.
   *
   * The row count is the proof itself: rows came back, therefore the role can
   * SELECT from `drizzle.__drizzle_migrations` on the database it named. No row
   * CONTENT is printed beyond the count — the migration standing table below is
   * derived from the committed journal, which is public.
   */
  const u = new URL(connection);
  say("\nCREDENTIAL PROOF (smoke)");
  say(`  variable     ${VARIABLE}`);
  say(`  ${describeConnection(connection)}`);
  say(`  db           ${u.pathname.slice(1).split("?")[0]}`);
  /*
   * THE TABLE NAME IS BUILT, NOT WRITTEN NEXT TO `FROM`.
   *
   * `tests/migration-shipping-invariant.test.ts` sweeps the tree for files that
   * QUERY `drizzle.__drizzle_migrations` and holds that list closed, so that
   * `db:check` and this gate keep sharing `lib/db/applied-migrations.ts` rather
   * than growing second opinions about one database. This file does not query
   * it — `readAppliedMigrationWhen` does — and a printed line that happened to
   * read like a query would make the guard refuse the consolidation it exists
   * to protect.
   */
  const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";
  say(`  statement    SELECT created_at from ${MIGRATIONS_TABLE}   (one, and only this one)`);
  say(`  result       ${read.appliedWhen.length} row(s) returned — the role CAN READ production`);
  say("  NOTHING WAS APPLIED. This gate resolves the READONLY variable by name; applying resolves");
  say("  WTP_PRODUCTION_DATABASE_URL_WRITE through lib/db/write-handle.ts, which refuses this one.");
}

/*
 * THE OTHER ANCHOR — LIVE SINCE 2026-08-28, AND THE REASON IT IS NOT REDUNDANT.
 *
 * `scripts/apply-migrations.mts` writes sha256 of each migration's raw bytes
 * into `drizzle.__drizzle_migrations.hash` on every apply, which is the only
 * record anywhere of what production ACTUALLY EXECUTED.
 * `lib/db/applied-migrations.ts` now selects it and returns `appliedHashes`,
 * so `checksumViolations` compares committed SQL against executed SQL rather
 * than git against git.
 *
 * **THE TWO GUARDS FAIL IN OPPOSITE DIRECTIONS, WHICH IS WHY THERE ARE TWO.**
 * The merge-base guard above sees every rewrite from now on and is structurally
 * blind to one that landed BEFORE it existed. This one sees a disagreement
 * whenever it happened and is blind to a rewrite of a migration production
 * never applied. Neither covers the other's hole.
 *
 * It is printed either way, and the NOT-AVAILABLE branch is kept rather than
 * deleted: this reads a credential, and a session that cannot reach production
 * must be told the cross-check did not run. A check that is not running must
 * never be silent, because silence is indistinguishable from a pass
 * (RULING 24).
 */
const appliedHashes = appliedHashesFrom(read);
if (appliedHashes === null) {
  say(
    "\n  content checksum cross-check: NOT AVAILABLE — this read carries no `appliedHashes`.",
  );
  say(
    "    The hash IS recorded: scripts/apply-migrations.mts writes sha256 of the file's raw bytes " +
      "on every apply, and lib/db/applied-migrations.ts selects it.",
  );
  say(
    "    A read reaching here without it is a reader that was changed, or one from before this " +
      "was wired. The git guard above still ran; this second, independent check did not.",
  );
} else {
  const rewritten = checksumViolations(readJournal(), appliedHashes, sha256OfMigration);
  if (rewritten.length > 0) {
    complain(
      `\nREFUSED — ${rewritten.length} applied migration(s) do not match the SQL committed here.`,
    );
    for (const v of rewritten) complain(`\n  [${v.rule}] ${v.what}\n      ${v.remedy}`);
    process.exit(1);
  }
  say(
    `  content checksum cross-check: ${appliedHashes.length} applied migration(s) hash to exactly ` +
      "the SQL committed here",
  );
}

const verdict = evaluateShippingInvariant({
  journal: readJournal(),
  appliedWhen: read.appliedWhen,
  introduced,
  moment: MOMENT,
});

say(
  `  committed: ${verdict.delta.codeCount} migration(s), head ${verdict.delta.codeHead} · ` +
    `applied on production: ${verdict.delta.appliedCount}`,
);
say();
say("  tag                              phase     applied  introduced");
for (const s of verdict.standing) {
  say(
    `  ${s.tag.padEnd(32)} ${(s.phase ?? "UNDECLARED").padEnd(9)} ${(s.applied ? "yes" : "NO ").padEnd(8)} ${s.introduced ? "yes" : "no"}`,
  );
}

if (verdict.verdict === "pass") {
  say(`\nHOLDS — ${verdict.summary}`);
  say(`  expand ordering:   ${PHASE_ORDERING.expand.sentence}`);
  say(`  contract ordering: ${PHASE_ORDERING.contract.sentence}`);
  process.exit(0);
}

complain(`\nREFUSED — ${verdict.summary}`);
for (const failure of verdict.failures) complain(`\n  ${failure}`);
complain(
  "\n  This gate exists because the daily tripwire found the same class the morning AFTER " +
    "0021 and 0022 deployed. It is not a flake and there is no skip flag.",
);
process.exit(1);
