/**
 * The schema shipping gate, asked before the merge: `build-check.yml`'s gates
 * job and `pnpm gates` run it. It uses the same comparator and reader as
 * `pnpm db:check` (`lib/db/applied-migrations.ts`) but differs in three ways:
 *
 *   1. It is scoped: a change that does not touch the schema contract is NOT
 *      APPLICABLE and never opens a connection.
 *   2. It knows EXPAND and CONTRACT (`lib/db/migration-phases.ts`): expands may
 *      be pending for the production build to apply; a contract migration is
 *      supposed to be missing until its code is live.
 *   3. It reads the change, so it can tell a migration this change introduces
 *      from one already owed.
 *
 * It never applies anything: it reads through
 * `WTP_PRODUCTION_DATABASE_URL_READONLY` only. Applying is `pnpm db:apply`.
 *
 * Established migrations are immutable: the applied-join is on the journal's
 * `when`, never the SQL, so a rewritten applied migration would still read as
 * applied. That check (`lib/db/migration-immutability.ts`) runs first and needs
 * no credential or network.
 *
 * `--smoke` (or `WTP_SCHEMA_GATE_SMOKE=true`) contacts production on a commit
 * that changed nothing, proving the read-only credential.
 *
 * `--moment=post-deploy` (or `WTP_SCHEMA_GATE_MOMENT=post-deploy`) is the
 * reading after a deploy; it is the one that fails on an unapplied CONTRACT
 * migration, which pre-deploy allows. `post-deploy-integrity.yml` runs it.
 *
 * Exit codes, matching `db:check`:
 *   0  the invariant holds, or the change does not touch the schema contract
 *   1  REFUSED — a migration is on the wrong side of the deploy, or an
 *      established migration was rewritten, deleted or renamed. Named.
 *   2  COULD NOT TELL — no credential, an unreadable migrations table, or an
 *      unreachable merge base. Never a pass.
 *
 * Run:
 *   pnpm exec tsx scripts/db-shipping-gate.mts
 *   pnpm exec tsx scripts/db-shipping-gate.mts --moment=post-deploy
 *   pnpm exec tsx scripts/db-shipping-gate.mts --paths=lib/db/migrations/<tag>.sql
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
 * Which side of the deploy this run asks from. The environment variable lets a
 * `workflow_dispatch` input select it without changing the `run:` line in
 * `build-check.yml`.
 */
const MOMENT: ShipMoment =
  arg("moment") === "post-deploy" || process.env.WTP_SCHEMA_GATE_MOMENT === "post-deploy"
    ? "post-deploy"
    : "pre-deploy";
const VARIABLE = "WTP_PRODUCTION_DATABASE_URL_READONLY";

/** Only ever set explicitly by a person (flag or dispatch input); never inferred. */
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
 * The changed paths, or `null` when they could not be read. The method used is
 * printed. `null` is not an empty list: `schemaInvolvement` treats it as involved.
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
          // A shallow `actions/checkout` will not have the base commit.
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

  // Local: committed changes unioned with the working tree, so an uncommitted
  // migration is seen.
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

/** The base tree behind the immutability guard: which way each path changed. */
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
 * `actions/checkout` clones at depth 1, where `git merge-base` fails and a
 * per-file `git log` returns the tip date. So the base is taken from the
 * platform wherever it is stated:
 *
 *   PULL REQUEST — `pull_request.base.sha`. The checked-out ref already merges
 *   the base, so `diff base HEAD` is the pull request's own changes. A missing
 *   commit is fetched by sha, deepening rather than unshallowing.
 *   PUSH TO MAIN — the push event's own `added`/`modified`/`removed` lists;
 *   `event.before` supplies the base journal when it can be fetched.
 *   LOCAL / DISPATCH — `git merge-base origin/main HEAD` on a complete clone.
 *
 * An unreachable base is `null` and reports COULD NOT TELL, never "nothing changed".
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
        // A rename arrives as a removal plus an addition; the removal alone refuses it.
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

  // Local and dispatch: the clone is complete, so `merge-base` is sound; the
  // working tree is unioned in, as in `changedPaths()`.

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

// Runs before the credential and before the NOT APPLICABLE exit, so no change
// to the scope test can turn it off.
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
  // An unreachable base leaves direction unknown, but a readable changed-path
  // list with no migration path means no migration changed in any direction.
  // An unreadable list (`changed === null`) is involved and keeps the refusal.
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
  // Smoke overrides the exit, never the finding: nothing is reported as introduced.
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
  complain("  An unset credential is not a passing schema check.");
  complain(
    "  In CI this is a repository secret. Add WTP_PRODUCTION_DATABASE_URL_READONLY under " +
      "Settings > Secrets and variables > Actions; the value is the read-only production string " +
      "already recorded in docs/credential-ledger.md. The READONLY role is deliberate: this gate " +
      "must not be able to apply what it finds.",
  );
  process.exit(2);
}

say(`  reading ${VARIABLE}  ${describeConnection(connection)}`);

const read = await readAppliedMigrationWhen(connection);
if (!read.ok) {
  complain(`\ndb:gate: COULD NOT TELL — drizzle.__drizzle_migrations was unreadable: ${read.why}`);
  complain("  This is not 'zero applied'. Nothing is concluded about production's schema.");
  process.exit(2);
}

if (SMOKE) {
  // Role, host and database name only; the row count is the proof the role can read.
  const u = new URL(connection);
  say("\nCREDENTIAL PROOF (smoke)");
  say(`  variable     ${VARIABLE}`);
  say(`  ${describeConnection(connection)}`);
  say(`  db           ${u.pathname.slice(1).split("?")[0]}`);
  // Built, not written next to `FROM`: tests/migration-shipping-invariant.test.ts
  // holds the list of files that query this table closed.
  const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";
  say(`  statement    SELECT created_at from ${MIGRATIONS_TABLE}   (one, and only this one)`);
  say(`  result       ${read.appliedWhen.length} row(s) returned — the role CAN READ production`);
  say("  NOTHING WAS APPLIED. This gate resolves the READONLY variable by name; applying resolves");
  say("  WTP_PRODUCTION_DATABASE_URL_WRITE through lib/db/write-handle.ts, which refuses this one.");
}

/*
 * The checksum cross-check compares committed SQL against the sha256 that
 * `scripts/apply-migrations.mts` records on every apply. It catches a rewrite
 * that predates the merge-base guard; that guard catches a rewrite of a
 * migration production never applied. When unavailable it says so.
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
