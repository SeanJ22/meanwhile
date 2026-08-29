/**
 * **A DEPLOY MAY NOT CROSS ITS OWN MIGRATIONS.**
 * (2026-08-28, the P0 schema-drift incident. Intake tripwire run 33211710028.)
 *
 * `0021_mixed_red_ghost` and `0022_adorable_hemingway` merged and deployed with
 * production's schema still at 20. `ask_interactions` did not exist, every
 * insert naming it failed, the route caught the error and served the page — so
 * a reader saw a working site while Ask interactions were being dropped.
 *
 * **DETECTION WAS NOT THE GAP.** Two instruments caught it: the daily
 * `db:check` in `intake-tripwire.yml` (run 33211710028) and `walk:all`'s
 * `[promptD]` check, as a named regression. Both are downstream of the deploy —
 * one runs the next morning, the other when a session runs the walk by hand.
 * Nothing in the merge or deploy path asked. **The ordering is the defect**, so
 * what is added here is PLACEMENT, a PHASE and a SCOPE, over the comparator the
 * repository already has.
 *
 * The reasoning lives in `lib/db/shipping-invariant.ts` and
 * `lib/db/migration-phases.ts`; this is what runs in the suite.
 *
 * **Fixture-driven and hermetic.** No database, no network. The synthetic
 * fixtures use REAL migration tags so they exercise the real phase
 * declaration — a fixture with invented tags would prove the evaluator agrees
 * with a table this file wrote for it.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { GATES } from "../scripts/gates.mjs";
import { sourceFiles } from "../scripts/duplicate-implementations.mts";
import {
  contractSignalsIn,
  declaredPhase,
  MIGRATION_PHASES,
  phaseFromSql,
  statementsIn,
} from "../lib/db/migration-phases.ts";
import { readJournal, type JournalEntry } from "../lib/db/schema-state.ts";
import {
  evaluateShippingInvariant,
  migrationTagsIn,
  schemaInvolvement,
} from "../lib/db/shipping-invariant.ts";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "lib", "db", "migrations");
const WORKFLOWS = join(ROOT, ".github", "workflows");

/** A journal fixture from real tags. `when` is only ever a join key. */
function journalOf(...tags: string[]): JournalEntry[] {
  return tags.map((tag, idx) => ({ idx, when: 1_780_000_000_000 + idx, tag }));
}
const whenOf = (journal: JournalEntry[], tag: string): number =>
  journal.find((e) => e.tag === tag)!.when;

/* ========================================================================== */
/* 1. THE DELTA                                                               */
/* ========================================================================== */

test("a delta of zero passes", () => {
  const journal = journalOf("0019_next_scarlet_witch", "0021_mixed_red_ghost", "0022_adorable_hemingway");
  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: journal.map((e) => e.when),
    introduced: [],
    moment: "pre-deploy",
  });
  assert.equal(verdict.verdict, "pass", verdict.failures.join("\n"));
  assert.deepEqual(verdict.failures, []);
  assert.deepEqual(verdict.expandNotApplied, []);
  assert.equal(verdict.delta.inSync, true);
});

test("a delta of two FAILS and names both migrations — the incident, exactly", () => {
  /*
   * The shape of run 33211710028: 23 committed, 21 applied, the two Ask
   * migrations missing. Both are expand-phase, so both were owed BEFORE the
   * deploy that carried the code naming `ask_interactions`.
   */
  const journal = journalOf(
    "0019_next_scarlet_witch",
    "0020_dazzling_deathbird",
    "0021_mixed_red_ghost",
    "0022_adorable_hemingway",
  );
  const applied = [whenOf(journal, "0019_next_scarlet_witch"), whenOf(journal, "0020_dazzling_deathbird")];

  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: applied,
    introduced: ["0021_mixed_red_ghost", "0022_adorable_hemingway"],
    moment: "pre-deploy",
  });

  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(
    verdict.expandNotApplied,
    ["0021_mixed_red_ghost", "0022_adorable_hemingway"],
    "the two Ask migrations must be named individually, never counted",
  );
  const said = verdict.failures.join("\n");
  for (const tag of ["0021_mixed_red_ghost", "0022_adorable_hemingway"]) {
    assert.ok(said.includes(tag), `the refusal does not name ${tag}`);
  }
  assert.ok(
    said.includes("db:apply --target=production"),
    "the refusal must state the remedy, not just the refusal",
  );
});

test("a number is never the answer: the verdict carries every migration by name", () => {
  const journal = journalOf("0021_mixed_red_ghost", "0022_adorable_hemingway");
  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: [],
    introduced: [],
    moment: "pre-deploy",
  });
  assert.deepEqual(
    verdict.standing.map((s) => `${s.tag}:${s.phase}:${s.applied ? "applied" : "pending"}`),
    ["0021_mixed_red_ghost:expand:pending", "0022_adorable_hemingway:expand:pending"],
  );
});

/* ========================================================================== */
/* 2. SCOPE — a docs-only change is not gated on a database round trip        */
/* ========================================================================== */

test("a docs-only change is NOT gated", () => {
  const involvement = schemaInvolvement([
    "docs/state.md",
    "docs/tracker-working.csv",
    "docs/intake-report.md",
    "README.md",
  ]);
  assert.equal(involvement.involved, false, involvement.reason);
  assert.equal(involvement.cannotTell, false);
  assert.deepEqual(involvement.paths, []);
});

test("a change that moves the schema contract IS gated, from either file", () => {
  for (const path of [
    "lib/db/migrations/0023_something_new.sql",
    "lib/db/migrations/meta/_journal.json",
    "lib/db/schema.ts",
  ]) {
    const involvement = schemaInvolvement(["docs/state.md", path]);
    assert.equal(involvement.involved, true, `${path} must make the gate applicable`);
    assert.deepEqual(involvement.paths, [path]);
  }
});

test("a lib/db file that is NOT the schema contract does not force a round trip", () => {
  // This module and its sibling live under lib/db/ and cannot change what
  // production has applied. Widening the trigger to `lib/db/` would gate every
  // edit to the gate itself on a database call.
  const involvement = schemaInvolvement([
    "lib/db/shipping-invariant.ts",
    "lib/db/migration-phases.ts",
  ]);
  assert.equal(involvement.involved, false, involvement.reason);
});

test("an UNREADABLE changed-path list is gated, never skipped", () => {
  const involvement = schemaInvolvement(null);
  assert.equal(involvement.involved, true);
  assert.equal(involvement.cannotTell, true, "null must not be reported as an empty diff");
  assert.match(involvement.reason, /UNKNOWN/);
});

test("Windows separators and ./ prefixes do not hide a migration", () => {
  /*
   * The separator is BUILT, never written. RULING 14 forbids a backslash
   * repo-path literal anywhere in the tree — it can only ever match on Windows
   * — and a fixture is not an exemption from the rule it is testing.
   */
  const BACKSLASH = String.fromCharCode(92);
  const windowsPath = "lib/db/migrations/0021_mixed_red_ghost.sql".split("/").join(BACKSLASH);
  const involvement = schemaInvolvement([windowsPath]);
  assert.equal(involvement.involved, true, "a backslash path must not read as unrelated");
  assert.deepEqual(migrationTagsIn(["./lib/db/migrations/0021_mixed_red_ghost.sql"]), [
    "0021_mixed_red_ghost",
  ]);
});

test("migrationTagsIn reads tags off the changed files and ignores the journal", () => {
  assert.deepEqual(
    migrationTagsIn([
      "lib/db/migrations/0021_mixed_red_ghost.sql",
      "lib/db/migrations/meta/_journal.json",
      "lib/db/migrations/meta/0021_snapshot.json",
      "docs/state.md",
    ]),
    ["0021_mixed_red_ghost"],
  );
});

/* ========================================================================== */
/* 3. EXPAND AND CONTRACT — both orderings, and the unsafe one fails          */
/* ========================================================================== */

test("an EXPAND migration MAY precede its code", () => {
  /*
   * 0021 creates a table. Applying it before the deploy that names the table is
   * the correct ordering, and the gate must say so rather than complaining that
   * production is ahead of the last deploy.
   */
  const journal = journalOf("0020_dazzling_deathbird", "0021_mixed_red_ghost");
  assert.equal(declaredPhase("0021_mixed_red_ghost")?.phase, "expand");

  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: journal.map((e) => e.when), // both applied, 0021 ahead of its deploy
    introduced: ["0021_mixed_red_ghost"],
    moment: "pre-deploy",
  });
  assert.equal(verdict.verdict, "pass", verdict.failures.join("\n"));
  assert.deepEqual(verdict.contractAppliedEarly, []);
});

test("a CONTRACT migration may NOT precede its code", () => {
  /*
   * 0018 drops `feedback.reply_to`. Applying it before the deploy that stops
   * writing that column breaks the build serving readers right now. This is the
   * ordering a migrate-always-first gate would have forced.
   */
  const journal = journalOf("0017_lively_mulholland_black", "0018_plain_silver_samurai");
  assert.equal(declaredPhase("0018_plain_silver_samurai")?.phase, "contract");

  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: journal.map((e) => e.when), // 0018 applied ahead of its deploy
    introduced: ["0018_plain_silver_samurai"],
    moment: "pre-deploy",
  });
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.contractAppliedEarly, ["0018_plain_silver_samurai"]);
  assert.ok(
    verdict.failures.join("\n").includes("0018_plain_silver_samurai"),
    "the refusal must name the contract migration",
  );
});

test("a CONTRACT migration still pending at its own deploy is the CORRECT ordering", () => {
  const journal = journalOf("0017_lively_mulholland_black", "0018_plain_silver_samurai");
  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: [whenOf(journal, "0017_lively_mulholland_black")],
    introduced: ["0018_plain_silver_samurai"],
    moment: "pre-deploy",
  });
  assert.equal(verdict.verdict, "pass", verdict.failures.join("\n"));
  assert.deepEqual(verdict.contractAppliedEarly, []);
  assert.deepEqual(
    verdict.contractOwed,
    [],
    "a contract introduced by THIS change is not owed from an earlier deploy",
  );
});

test("the 0013/0014 pair is expressible — this is why migrate-always-first is refused", () => {
  /*
   * 0013 puts the default back so the live build's writes land; 0014 takes it
   * away once the code that fills the column is serving. A gate that required
   * every committed migration to be applied before every deploy would refuse
   * the exact split this repository made on purpose, and `pnpm db:apply
   * --upto=` exists because of it.
   */
  assert.equal(declaredPhase("0013_tier_distribution_bridge")?.phase, "expand");
  assert.equal(declaredPhase("0014_tier_distribution_no_default")?.phase, "contract");

  const journal = journalOf("0013_tier_distribution_bridge", "0014_tier_distribution_no_default");
  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: [whenOf(journal, "0013_tier_distribution_bridge")],
    introduced: ["0013_tier_distribution_bridge", "0014_tier_distribution_no_default"],
    moment: "pre-deploy",
  });
  assert.equal(verdict.verdict, "pass", verdict.failures.join("\n"));
});

test("a contract owed from an EARLIER deploy is reported, not silently dropped", () => {
  const journal = journalOf("0018_plain_silver_samurai", "0021_mixed_red_ghost");
  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: [whenOf(journal, "0021_mixed_red_ghost")],
    introduced: [],
    moment: "pre-deploy",
  });
  assert.equal(verdict.verdict, "pass", "an owed contract does not block an unrelated deploy");
  assert.deepEqual(verdict.contractOwed, ["0018_plain_silver_samurai"]);
  assert.ok(
    verdict.summary.includes("0018_plain_silver_samurai"),
    "an owed contract must appear in the summary — the daily tripwire is what fails on it",
  );
});

test("post-deploy, BOTH phases are owed and an unapplied contract fails", () => {
  const journal = journalOf("0017_lively_mulholland_black", "0018_plain_silver_samurai");
  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: [whenOf(journal, "0017_lively_mulholland_black")],
    introduced: ["0018_plain_silver_samurai"],
    moment: "post-deploy",
  });
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.notAppliedAfterDeploy, ["0018_plain_silver_samurai"]);
});

/* ========================================================================== */
/* 4. THE DECLARATION — and why an undeclared migration has no default        */
/* ========================================================================== */

test("a committed migration with no phase declaration FAILS and is given no phase", () => {
  const journal = journalOf("0021_mixed_red_ghost", "0099_undeclared_newcomer");
  const verdict = evaluateShippingInvariant({
    journal,
    appliedWhen: journal.map((e) => e.when),
    introduced: ["0099_undeclared_newcomer"],
    moment: "pre-deploy",
  });
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.undeclared, ["0099_undeclared_newcomer"]);
  assert.equal(
    verdict.standing.find((s) => s.tag === "0099_undeclared_newcomer")?.phase,
    null,
    "an undeclared migration must not be defaulted to expand — that is the ordering error itself",
  );
  assert.deepEqual(
    verdict.expandNotApplied,
    [],
    "an undeclared migration must not be counted in a phase bucket",
  );
});

test("every committed migration declares a phase", () => {
  const journal = readJournal();
  assert.ok(journal.length >= 20, `the journal reader found only ${journal.length} entries`);
  const undeclared = journal.filter((e) => declaredPhase(e.tag) === null).map((e) => e.tag);
  assert.deepEqual(
    undeclared,
    [],
    "these committed migrations have no entry in MIGRATION_PHASES (lib/db/migration-phases.ts):\n  " +
      `${undeclared.join("\n  ")}\n\n` +
      "This is the mechanism that stops the 2026-08-28 incident recurring: a schema-changing pull\n" +
      "request cannot merge without stating which side of its deploy the migration belongs on.",
  );
});

test("the declaration states a reason, and names no migration that does not exist", () => {
  const onDisk = new Set(
    readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, "")),
  );
  assert.ok(onDisk.size >= 20, `only ${onDisk.size} migration file(s) found`);
  for (const [tag, declaration] of Object.entries(MIGRATION_PHASES)) {
    assert.ok(onDisk.has(tag), `MIGRATION_PHASES names ${tag} and no such migration exists`);
    assert.ok(
      declaration.why.length > 40,
      `${tag} is declared ${declaration.phase} with no reason. Why it is on that side is the finding.`,
    );
  }
});

/* ========================================================================== */
/* 5. THE PHASE IS DERIVED FROM THE SQL, not asserted beside it (RULING 147)  */
/* ========================================================================== */

test("every declaration agrees with the migration's own SQL", () => {
  const disagreements: string[] = [];
  let read = 0;
  for (const [tag, declaration] of Object.entries(MIGRATION_PHASES)) {
    const sql = readFileSync(join(MIGRATIONS, `${tag}.sql`), "utf8");
    read += 1;
    const derived = phaseFromSql(sql);
    if (derived.phase !== declaration.phase) {
      disagreements.push(
        `${tag}: declared ${declaration.phase}, its SQL says ${derived.phase}` +
          (derived.signals.length > 0
            ? ` — ${derived.signals.map((s) => `${s.rule}: ${s.statement}`).join(" · ")}`
            : " — no narrowing statement found"),
      );
    }
  }
  assert.ok(read >= 20, `only ${read} migration file(s) were actually read`);
  assert.deepEqual(
    disagreements,
    [],
    "the phase declaration disagrees with the SQL it describes:\n  " +
      `${disagreements.join("\n  ")}\n\n` +
      "The SQL is the anchor. Fix the declaration, or teach CONTRACT_RULES the shape it missed.",
  );
});

test("the classifier reads STATEMENTS, never the comment above them", () => {
  /*
   * 0011's header QUOTES the generated statement it was hand-corrected away
   * from — `ADD COLUMN "coverage_tier" text NOT NULL;` — and 0013's says "DROP
   * DEFAULT" in prose. A classifier reading raw text derives a phase from an
   * explanation of what the file deliberately does not do.
   */
  const planted = [
    "-- Drizzle wrote:",
    '--     ALTER TABLE "x" ADD COLUMN "c" text NOT NULL;',
    "-- which we corrected, and we never DROP DEFAULT here.",
    `ALTER TABLE "x" ADD COLUMN "c" text DEFAULT 'UNKNOWN' NOT NULL;`,
  ].join("\n");
  assert.deepEqual(statementsIn(planted), [
    `ALTER TABLE "x" ADD COLUMN "c" text DEFAULT 'UNKNOWN' NOT NULL;`,
  ]);
  assert.equal(phaseFromSql(planted).phase, "expand");

  // And the real file it was derived from.
  const real = readFileSync(join(MIGRATIONS, "0011_organic_cerise.sql"), "utf8");
  assert.match(real, /Drizzle wrote:/, "0011 no longer carries the comment this plant is modelled on");
  assert.equal(phaseFromSql(real).phase, "contract", "0011 drops two defaults — it is a contract");
});

test("THE PLANT: each narrowing shape is caught, and an additive one is not", () => {
  const contracts: Record<string, string> = {
    "drop-column": 'ALTER TABLE "feedback" DROP COLUMN "reply_to";',
    "drop-table": 'DROP TABLE "reactions";',
    "drop-default": 'ALTER TABLE "reactions" ALTER COLUMN "coverage_tier" DROP DEFAULT;',
    "set-not-null": 'ALTER TABLE "reactions" ALTER COLUMN "free_text" SET NOT NULL;',
    "add-constraint": 'ALTER TABLE "meetings" ADD CONSTRAINT "pairing" CHECK (true);',
    "drop-constraint": 'ALTER TABLE "meetings" DROP CONSTRAINT "pairing";',
    "drop-index": 'DROP INDEX "reactions_target_idx";',
    rename: 'ALTER TABLE "reactions" RENAME COLUMN "free_text" TO "verbatim";',
    "add-not-null-column-without-default":
      'ALTER TABLE "speak_your_mind" ADD COLUMN "coverage_tier" text NOT NULL;',
  };
  for (const [rule, statement] of Object.entries(contracts)) {
    const signals = contractSignalsIn(statement);
    assert.ok(
      signals.some((s) => s.rule === rule),
      `${rule} was not recognised in: ${statement}`,
    );
    assert.equal(phaseFromSql(statement).phase, "contract", `${rule} must make the file a contract`);
  }

  const additive = [
    'CREATE TABLE "x" ("id" uuid PRIMARY KEY NOT NULL, "n" text NOT NULL);',
    'ALTER TABLE "x" ADD COLUMN "n" text;',
    `ALTER TABLE "x" ADD COLUMN "n" text DEFAULT 'UNKNOWN' NOT NULL;`,
    'ALTER TABLE "x" ALTER COLUMN "n" DROP NOT NULL;',
    `ALTER TABLE "x" ALTER COLUMN "n" SET DEFAULT 'UNKNOWN';`,
    'CREATE INDEX "x_n_idx" ON "x" USING btree ("n");',
  ];
  for (const statement of additive) {
    assert.deepEqual(
      contractSignalsIn(statement).map((s) => s.rule),
      [],
      `an additive statement was classified as narrowing: ${statement}`,
    );
  }
});

/* ========================================================================== */
/* 6. WHERE IT RUNS — and the tripwire that stays beside it                   */
/* ========================================================================== */

const GATE_COMMAND = "pnpm exec tsx scripts/db-shipping-gate.mts";

test("the shipping gate runs in the PR gate job on every pull request and every push to main", () => {
  const text = readFileSync(join(WORKFLOWS, "build-check.yml"), "utf8");
  assert.ok(
    text.includes(`corepack ${GATE_COMMAND}`),
    `build-check.yml does not run \`${GATE_COMMAND}\` — the invariant is then asserted nowhere ` +
      "before a merge, which is the whole defect",
  );
  // In the `gates` job, whose name is the required status check — not in the
  // build matrix, which produces two contexts and would double the round trip.
  const gatesJob = text.slice(text.indexOf("  gates:"));
  assert.ok(
    gatesJob.includes(`corepack ${GATE_COMMAND}`),
    "the gate must live in the `gates` job, which is the required context branch protection names",
  );
  assert.match(text, /^\s*push:\s*$/m);
  assert.match(text, /^\s*pull_request:\s*$/m);
});

test("the shipping gate is in the LOCAL gate set too — the RO04 hole stays closed", () => {
  const local = GATES.map((g) => g.command);
  assert.ok(
    local.includes(GATE_COMMAND),
    `\`${GATE_COMMAND}\` runs in CI and not in \`pnpm gates\`. That is the RO04 shape: a session ` +
      `reports every gate it ran as green while a required check fails. Found: ${local.join(", ")}`,
  );
});

test("ONE DETECTOR — the gate reuses the comparator, it does not reimplement it", () => {
  /*
   * The correction that produced this guard: detection was never missing. The
   * delta this repository ships is `compareSchemaState`, and `db:check`,
   * `/api/schema` (which walk:all's `[promptD]` check reads) and this gate all
   * import THAT. A second comparator is how two surfaces start disagreeing
   * about the same database.
   *
   * The SELECT is consolidated the same way. `app/api/schema/route.ts` still
   * carries its own — it is a Next route, out of this change's reach — so the
   * closed list has three members and grows only deliberately.
   */
  /*
   * SWEPT OVER THE TREE, not over a hand-kept list (RULING 147), and matched on
   * the QUERY rather than on the identifier: both scripts still NAME the table
   * in their error messages, and a guard that read its own prose as the defect
   * would refuse the consolidation it exists to protect.
   */
  const QUERIES_IT =
    /\b(?:FROM|INTO|UPDATE|CREATE TABLE(?: IF NOT EXISTS)?)\s+drizzle\.__drizzle_migrations\b/i;
  const files = sourceFiles();
  assert.ok(files.length > 600, `only ${files.length} source file(s) enumerated — the sweep saw nothing`);

  const queriers = files
    .filter((f) => QUERIES_IT.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();

  assert.deepEqual(
    queriers,
    [
      // Answers from inside a running deploy — what walk:all's [promptD] reads.
      "app/api/schema/route.ts",
      // The ONE reader `db:check` and the shipping gate share.
      "lib/db/applied-migrations.ts",
      // The applier, the only thing allowed to WRITE this table.
      "scripts/apply-migrations.mts",
      // Proves a local write reached the local branch; reads the journal count.
      "scripts/verify-local-write.mts",
    ].sort(),
    `these files query drizzle.__drizzle_migrations: ${queriers.join(", ")}.\n` +
      "`db:check` and the shipping gate must NOT be among them — they share\n" +
      "lib/db/applied-migrations.ts so that a failure means the same thing to both.\n" +
      "A new querier is a decision: add it here with the reason it needs its own.",
  );

  const gate = readFileSync(join(ROOT, "lib", "db", "shipping-invariant.ts"), "utf8");
  assert.match(
    gate,
    /import\s*\{[^}]*compareSchemaState[^}]*\}\s*from\s*"\.\/schema-state\.ts"/,
    "the invariant must compute its delta with the repository's one comparator",
  );
});

test("THE TRIPWIRE STAYS, and it is still an independent daily check", () => {
  /*
   * The pre-merge gate only ever sees changes arriving through a pull request
   * or a push. Drift from anywhere else — a rollback, a second branch writing
   * the same database, a hand-applied statement — is invisible to it and
   * visible to the daily sweep. Removing the tripwire because a better gate
   * exists upstream would trade defence in depth for a single point of failure.
   */
  const text = readFileSync(join(WORKFLOWS, "intake-tripwire.yml"), "utf8");
  assert.match(text, /run:\s*corepack pnpm db:check/, "the daily schema gate is gone");
  assert.match(text, /^\s*- cron:/m, "the tripwire is no longer scheduled");
  assert.match(
    text,
    /steps\.schema\.outcome/,
    "nothing reads the schema gate's outcome, so its failure would be swallowed",
  );
});

test("NOTHING applies a migration automatically, and no gate may heal what it finds", () => {
  /*
   * THE LIFECYCLE FINDING, PINNED. `git log -S` over `.github/` and
   * `netlify.toml` across this repository's whole history returns no commit
   * that ever ran `db:apply`, `drizzle-kit migrate` or `apply-migrations` in
   * CI or in the deploy: applying has only ever been a person at a terminal.
   *
   * The repair is a GATE, not an auto-apply. `intake-tripwire.yml` states why
   * in its own words — a gate that could fix what it finds would apply an
   * unreviewed migration at 4am against production — and a pull-request check
   * that could do it would be worse, because the SQL would be unreviewed by
   * definition. So this asserts the absence deliberately: adding auto-apply is
   * allowed, and it has to move this guard in the same diff.
   */
  const offenders: string[] = [];
  const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));
  assert.ok(files.length >= 5, `only ${files.length} workflow file(s) found — the sweep saw nothing`);
  for (const file of files) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    for (const line of text.split("\n")) {
      if (!/^\s*(run:|-)\s/.test(line)) continue;
      if (/\bdb:apply\b|drizzle-kit\s+migrate|apply-migrations/.test(line)) {
        offenders.push(`${file}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a workflow now applies migrations automatically:\n  " +
      `${offenders.join("\n  ")}\n\n` +
      "That may be the right answer one day, and it is a decision — take this guard out in the " +
      "same diff, and say who reviews the SQL before it reaches production.",
  );
});

/* ========================================================================== */
/* 7. THE SMOKE PATH — a credential proof that invents no schema change       */
/* ========================================================================== */

/*
 * WTP_PRODUCTION_DATABASE_URL_READONLY IS NOT YET A REPOSITORY SECRET.
 *
 * The gate above is SCOPED, which is right and which means the credential is
 * only ever exercised when a schema change happens along — so a wrong, expired
 * or absent secret would be discovered by the very pull request that most needs
 * the gate working. `workflow_dispatch` gains an input that forces the gate to
 * contact production on a commit that changed nothing.
 *
 * These assert the WIRING, because the secret cannot be asserted from here and
 * inventing one would be the fabrication this repository forbids by name.
 */

test("the smoke input exists, is opt-in, and is off unless a person dispatches it", () => {
  const text = readFileSync(join(WORKFLOWS, "build-check.yml"), "utf8");
  const dispatchAt = text.indexOf("workflow_dispatch:");
  assert.ok(dispatchAt > 0, "build-check.yml is no longer dispatchable, so nothing can prove the credential");

  assert.match(text, /schema_smoke:/, "the smoke input is gone");
  assert.match(text, /WTP_SCHEMA_GATE_SMOKE: \$\{\{ inputs\.schema_smoke \}\}/);
  assert.match(
    text.slice(dispatchAt),
    /schema_smoke:[\s\S]{0,400}?default: false/,
    "the smoke input must default to OFF — a gate that opens a connection by default is not scoped",
  );
});

test("the smoke path did not change the gate's COMMAND — gate parity is not spent on it", () => {
  /*
   * RO04: a gate whose CI command drifts from its local command is a gate a
   * session reports green while a required check fails. The smoke path is
   * carried on `env:`, so `run:` is byte-identical to the entry in
   * scripts/gates.mjs and `tests/gate-parity.test.ts` keeps holding.
   */
  const text = readFileSync(join(WORKFLOWS, "build-check.yml"), "utf8");
  assert.ok(
    text.includes(`run: corepack ${GATE_COMMAND}\n`),
    "the schema gate's run: line moved — gate parity is anchored on it",
  );
  assert.ok(GATES.map((g) => g.command).includes(GATE_COMMAND));
});

test("the second reading is dispatchable — pre-deploy is not the only moment", () => {
  /*
   * A pre-merge answer is true about the moment it was taken. `post-deploy` is
   * where BOTH phases are owed, and it is the one that fails on a CONTRACT
   * migration that pre-deploy deliberately allows. Nothing runs it
   * automatically yet; the gap is stated in the gate's own header rather than
   * papered over, and this asserts the half that DOES exist.
   */
  const text = readFileSync(join(WORKFLOWS, "build-check.yml"), "utf8");
  assert.match(text, /schema_moment:/);
  assert.match(text, /WTP_SCHEMA_GATE_MOMENT: \$\{\{ inputs\.schema_moment \}\}/);

  const gate = readFileSync(join(ROOT, "scripts", "db-shipping-gate.mts"), "utf8");
  assert.match(
    gate,
    /process\.env\.WTP_SCHEMA_GATE_MOMENT === "post-deploy"/,
    "the environment variable the workflow sets is not read by the gate",
  );
  assert.match(
    gate,
    /deployment_status/,
    "the gate must name the route that would run the post-deploy reading automatically, so the " +
      "remaining gap is a stated decision rather than a silence",
  );
});

test("SMOKE MAY NOT MANUFACTURE A DIFF — the flag overrides the exit, never the finding", () => {
  const gate = readFileSync(join(ROOT, "scripts", "db-shipping-gate.mts"), "utf8");
  /*
   * The tempting shortcut is a fake `--paths=` naming a migration, which also
   * reaches the database and puts a false statement about what the change
   * touched into a log somebody reads later. The scope test runs honestly and
   * prints its honest NOT APPLICABLE; only the exit is overridden.
   */
  assert.match(gate, /if \(!involvement\.involved && SMOKE\)/);
  assert.match(gate, /NOT APPLICABLE[\s\S]{0,400}SMOKE: contacting production anyway/);
  assert.ok(
    !/SMOKE\s*\?\s*\[[^\]]*lib\/db\/migrations/.test(gate),
    "smoke mode must not synthesise a migration path to force applicability",
  );
  assert.match(
    gate,
    /const SMOKE =[\s\S]{0,300}argv\.includes\("--smoke"\)/,
    "smoke must be stated by a person, never inferred by the gate",
  );
});

test("the smoke proof prints the role and host and NOT the connection string", () => {
  const gate = readFileSync(join(ROOT, "scripts", "db-shipping-gate.mts"), "utf8");
  const proof = gate.slice(gate.indexOf("CREDENTIAL PROOF"), gate.indexOf("THE OTHER ANCHOR"));
  assert.ok(proof.length > 200, "the credential proof block is gone");
  assert.match(proof, /describeConnection\(connection\)/, "role and host come from the parsed URL");
  assert.ok(
    !/\$\{connection\}/.test(proof),
    "the connection string itself must never reach stdout — the secrets sweep would be right to flag it",
  );
  // The ACCESSOR, not the word — a comment explaining what is withheld must not
  // read as the thing being withheld (the guards-read-your-comment shape).
  assert.ok(
    !/\.password\b/.test(proof),
    "the proof may not reach for the credential's password field",
  );
  assert.match(proof, /NOTHING WAS APPLIED/);
});
