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

function git(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trimEnd() };
}

function changedPaths(reading: BaseReading): string[] | null {
  if (reading.changes === null && ["push", "pull_request"].includes(process.env.GITHUB_EVENT_NAME ?? "")) return null;
  const explicit = arg("paths");
  if (explicit !== null) {
    say("  paths: stated on the command line");
    return explicit.split(",").map(path => path.trim()).filter(Boolean);
  }
  if (reading.changes === null) return null;
  const paths = [...new Set(reading.changes.flatMap(change => change.from ? [change.from, change.path] : [change.path]))];
  say(`  paths: ${reading.how} (${paths.length} path(s))`);
  return paths;
}

interface BaseReading {
  readonly how: string;
  readonly changes: ChangedEntry[] | null;
  readonly baseJournal: JournalEntry[] | null;
}

function netChanges(base: string, workingTree: boolean): ChangedEntry[] | null {
  const diff = git(["diff", "--name-status", "--find-renames", base, ...(workingTree ? [] : ["HEAD"]), "--"]);
  if (!diff.ok) return null;
  const changes = parseNameStatus(diff.out);
  if (!workingTree) return changes;
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!untracked.ok) return null;
  return [...changes, ...untracked.out.split("\0").filter(Boolean).map(path => ({
    status: "added" as const, path, from: null, raw: `A\t${path}`,
  }))];
}

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
    if (!ensureCommit(stated)) {
      complain(`  base: --base=${stated} does not resolve in this checkout`);
      return { how: `--base=${stated} (UNRESOLVABLE)`, changes: null, baseJournal: null };
    }
    return { how: `--base=${stated}, compared directly to the working tree`,
      changes: netChanges(stated, true), baseJournal: journalAt(stated) };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH, eventName = process.env.GITHUB_EVENT_NAME;
  if (eventPath && (eventName === "push" || eventName === "pull_request")) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
        before?: string;
        pull_request?: { base?: { sha?: string } };
      };
      const base = eventName === "push" ? event.before : event.pull_request?.base?.sha;
      const how = eventName === "push" ? "the push event's before commit" : "the pull request's base";
      if (base && ensureCommit(base)) {
        return { how: `${how} ${base.slice(0, 7)}, compared directly to HEAD`,
          changes: netChanges(base, false), baseJournal: journalAt(base) };
      }
      complain(`  base: ${how} ${(base ?? "(absent from the event)").slice(0, 7)} could not be reached even after deepening`);
      return { how: `${how} (UNREACHABLE)`, changes: null, baseJournal: null };
    } catch (error) {
      complain(`  base: the event payload could not be read — ${(error as Error).message}`);
      return { how: "the event payload (UNREADABLE)", changes: null, baseJournal: null };
    }
  }
  if (eventName === "push" || eventName === "pull_request") {
    return { how: "the event payload (MISSING)", changes: null, baseJournal: null };
  }

  const mergeBase = git(["merge-base", "origin/main", "HEAD"]);
  if (!mergeBase.ok || !mergeBase.out) {
    complain("  base: origin/main and HEAD have no reachable merge base");
    return { how: "the local merge base (UNRESOLVABLE)", changes: null, baseJournal: null };
  }
  const base = mergeBase.out;
  return { how: `git merge-base origin/main HEAD = ${base.slice(0, 7)}, compared directly to the working tree`,
    changes: netChanges(base, true), baseJournal: journalAt(base) };
}

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

say(`db:gate  moment=${MOMENT}${SMOKE ? "  SMOKE (production contact forced)" : ""}`);

const reading = baseReading();
const changed = changedPaths(reading);
const involvement = schemaInvolvement(changed);

// Runs before the credential and before the NOT APPLICABLE exit, so no change
// to the scope test can turn it off.
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
  // An explicit non-schema path list can establish non-involvement independently of an unreadable base.
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
