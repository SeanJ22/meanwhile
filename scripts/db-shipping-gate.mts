/**
 * **THE SHIPPING GATE — asked BEFORE the merge, not the morning after.**
 * (2026-08-28, the P0 schema-drift incident. Intake tripwire run 33211710028.)
 *
 * ## THE DETECTOR WAS NEVER MISSING. ITS PLACEMENT WAS.
 *
 * This repository already asked the question in three places, all of them the
 * same `compareSchemaState`:
 *
 *   - `pnpm db:check`, daily, in `intake-tripwire.yml`. It is what caught the
 *     incident — run 33211710028, the morning AFTER the deploy.
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
 *      a contract migration is SUPPOSED to be missing until its code is live.
 *      See `lib/db/migration-phases.ts`.
 *   3. **It reads the change**, so it can tell a migration this change
 *      introduces from one that was already owed.
 *
 * ## THE TRIPWIRE STAYS
 *
 * This does not replace the daily gate and must never be allowed to. This one
 * only sees changes that arrive through a pull request or a push; drift that
 * arises any other way — a rollback, a second branch writing to the same
 * database, a hand-applied statement — is invisible to it and visible to the
 * daily sweep. Defence in depth, and `tests/migration-shipping-invariant.test.ts`
 * asserts the tripwire still runs `db:check` as its own independent step.
 *
 * ## IT NEVER APPLIES ANYTHING
 *
 * Read-only, through `WTP_PRODUCTION_DATABASE_URL_READONLY`, by name. A gate
 * that could fix what it finds would apply an unreviewed migration from a pull
 * request check. Applying is `pnpm db:apply`, which resolves a different
 * variable and refuses this one.
 *
 * ## Exit codes, matching `db:check`
 *
 *   0  the invariant holds, or the change does not touch the schema contract
 *   1  REFUSED — a migration is on the wrong side of the deploy, named
 *   2  COULD NOT TELL — no credential, or the migrations table was unreadable.
 *      Never a pass. An unreadable answer must not print like a passing one.
 *
 * Run:
 *   pnpm exec tsx scripts/db-shipping-gate.mts
 *   pnpm exec tsx scripts/db-shipping-gate.mts --moment=post-deploy
 *   pnpm exec tsx scripts/db-shipping-gate.mts --paths=lib/db/migrations/0021_mixed_red_ghost.sql
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";

import { describeConnection, readAppliedMigrationWhen } from "../lib/db/applied-migrations.ts";
import { readJournal } from "../lib/db/schema-state.ts";
import { PHASE_ORDERING } from "../lib/db/migration-phases.ts";
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

const MOMENT: ShipMoment = arg("moment") === "post-deploy" ? "post-deploy" : "pre-deploy";
const VARIABLE = "WTP_PRODUCTION_DATABASE_URL_READONLY";

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
 * discipline `scripts/push-main.mjs` applies to its own path guard. Each rung
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
/* THE GATE                                                                   */
/* -------------------------------------------------------------------------- */

say(`db:gate  moment=${MOMENT}`);

const changed = changedPaths();
const involvement = schemaInvolvement(changed);

if (!involvement.involved) {
  say(`\nNOT APPLICABLE — ${involvement.reason}.`);
  say("  The schema contract is lib/db/migrations/ and lib/db/schema.ts:");
  for (const { prefix, why } of SCHEMA_CONTRACT_PATHS) say(`    ${prefix}  ${why}`);
  say("  No database was contacted. A docs-only change is not gated on a round trip.");
  process.exit(0);
}

say(`\nAPPLICABLE — ${involvement.reason}.`);
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
