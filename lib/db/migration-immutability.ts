/**
 * **AN ESTABLISHED MIGRATION IS IMMUTABLE. CORRECTION IS A NEW MIGRATION.**
 * (2026-08-28, the audit of the shipping gate written the same day.)
 *
 * ## The hole this closes, stated exactly
 *
 * `migrationTagsIn` in `./shipping-invariant.ts` reads a changed-path list and
 * returns the migration tags in it. **It knows a migration file CHANGED. It
 * cannot tell which way.** A brand-new `0023_...sql` and a rewrite of
 * `0021_mixed_red_ghost.sql` reach it as the same string, so the shipping gate
 * treats both as "introduced by this change".
 *
 * That matters because of how "applied" is decided everywhere else in this
 * repository. `compareSchemaState` joins on the journal's `when` — a TIMESTAMP,
 * written into `drizzle.__drizzle_migrations.created_at` by
 * `scripts/apply-migrations.mts`. Nothing in that join looks at the SQL. So a
 * migration whose file is rewritten AFTER it was applied still reports as
 * applied, on every surface: `pnpm db:check` says IN SYNC, `/api/schema` says
 * IN SYNC, the daily tripwire says IN SYNC, and the shipping gate says HOLDS —
 * **while the SQL committed in Git is no longer the SQL production executed.**
 * Every one of those instruments is answering a question about bookkeeping and
 * none of them is answering a question about content.
 *
 * ## WHAT WAS SEARCHED FOR FIRST, AND WHAT WAS FOUND
 *
 * Drizzle's own `meta/_journal.json` is version 7 in this repository and its
 * entries carry `idx`, `version`, `when`, `tag` and `breakpoints` — **no hash,
 * no checksum.** It is an ordering record, not an integrity record, and no
 * amount of reading it will catch a rewritten file.
 *
 * `scripts/apply-migrations.mts` DOES compute `sha256` of each migration's raw
 * bytes and writes it to `drizzle.__drizzle_migrations.hash`, matching what
 * `drizzle-kit` would have written. That column is an independent anchor and it
 * is real — **and nothing in this repository has ever read it back.**
 * `lib/db/applied-migrations.ts` selects `created_at` alone, so the one value
 * that could prove content agreement is written and never compared.
 * `checksumViolations` below is the comparison, ready for the moment that
 * SELECT carries the column; `appliedHashesFrom` is how it is fed, and it
 * returns `null` today rather than pretending.
 *
 * ## SO THE GUARD THAT RUNS ON EVERY CHANGE IS A GIT GUARD
 *
 * It needs no credential, no network and no database, which is the point: it
 * has to refuse a rewrite on a pull request from a fork, on a docs-heavy
 * branch, and in `pnpm gates` on a laptop with no `.env.local`. Four
 * independent questions, and every one of them is asked:
 *
 *   1. **Against the merge base** — was any `NNNN_*.sql` MODIFIED, DELETED or
 *      RENAMED rather than added? A file that exists in the merge base is
 *      established: it is on `main`, so it is on every deploy built from `main`
 *      and, for anything already applied, it is what production ran.
 *   2. **The generated snapshots** — `meta/NNNN_snapshot.json` is the state
 *      Drizzle generates the NEXT migration's diff against. Rewriting an
 *      established one silently changes what every later `db:generate`
 *      produces, so it is held to the same rule.
 *   3. **The journal is APPEND-ONLY** — the merge base's entries must survive
 *      into HEAD at the same index, with the same `when` and the same `tag`.
 *      This is the half that catches a re-timestamp: change a `when` and the
 *      migration becomes unapplied everywhere, because the join key moved.
 *   4. **The journal and the disk correspond exactly** — a journal entry with
 *      no `.sql` file cannot be applied, and a `.sql` file with no journal
 *      entry never will be. Both are silent today.
 *
 * ## THE ONE THING IT MUST NEVER DO IS PASS QUIETLY
 *
 * `changes === null` is UNREADABLE, not "nothing changed" — the same
 * distinction `schemaInvolvement` draws over the same input, for the same
 * reason (RULING 24). A missing merge base is a `cannot-tell`, named, and the
 * gate treats it as a failure rather than a pass. A guard whose subject is out
 * of reach must never print like one that looked.
 *
 * Pure. No filesystem, no git, no network — `scripts/db-shipping-gate.mts`
 * supplies the four inputs and `tests/migration-immutability.test.ts` supplies
 * them from fixtures.
 */

import type { JournalEntry } from "./schema-state.ts";

/* -------------------------------------------------------------------------- */
/* WHAT CHANGED, AND WHICH WAY                                                */
/* -------------------------------------------------------------------------- */

/**
 * A change's direction, which is the whole point of this module.
 *
 * `unknown` is deliberately a member rather than an error: git's `--name-status`
 * vocabulary can grow, and a status this reader does not recognise on a
 * migration file is treated as a modification below. Failing closed on an
 * unrecognised letter costs one new migration; failing open loses the guard.
 */
export type ChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "unknown";

export interface ChangedEntry {
  readonly status: ChangeStatus;
  /** The path at HEAD. For a rename this is the DESTINATION. */
  readonly path: string;
  /** The path in the merge base, for a rename or copy. Otherwise null. */
  readonly from: string | null;
  /** The line this was read out of, so a failure can be checked against it. */
  readonly raw: string;
}

const STATUS_LETTERS: Readonly<Record<string, ChangeStatus>> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typechange",
};

const normalisePath = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/**
 * Parse `git diff --name-status`.
 *
 * The format is tab-separated: `M\tpath`, `A\tpath`, `D\tpath`, and for a
 * rename or copy a similarity score joins the letter and a SECOND path
 * follows — `R100\told\tnew`. The score is discarded; what matters is that a
 * rename has two sides and both are reported, because a rename of a migration
 * is a delete and an add wearing one line.
 */
export function parseNameStatus(raw: string): ChangedEntry[] {
  const entries: ChangedEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.trim() === "") continue;
    const parts = trimmed.split("\t");
    const letter = (parts[0] ?? "").trim().charAt(0).toUpperCase();
    const status = STATUS_LETTERS[letter] ?? "unknown";
    if (status === "renamed" || status === "copied") {
      const from = normalisePath(parts[1] ?? "");
      const to = normalisePath(parts[2] ?? parts[1] ?? "");
      entries.push({ status, path: to, from, raw: trimmed });
      continue;
    }
    entries.push({ status, path: normalisePath(parts[1] ?? ""), from: null, raw: trimmed });
  }
  return entries;
}

/**
 * Parse `git status --porcelain` into the same vocabulary.
 *
 * A session running `pnpm gates` before committing has its rewrite in the
 * WORKING TREE, and a guard that only read committed history would pass a
 * change it is looking straight at. The porcelain code is two columns — index
 * then work tree — and the RIGHTMOST non-space letter is the one that
 * describes the file as it now stands on disk. `??` is untracked, which is an
 * addition.
 */
export function parsePorcelain(raw: string): ChangedEntry[] {
  const entries: ChangedEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.trim() === "") continue;
    const code = trimmed.slice(0, 2);
    const body = trimmed.slice(3);
    if (code === "??") {
      entries.push({ status: "added", path: normalisePath(body), from: null, raw: trimmed });
      continue;
    }
    const letter = (code[1] !== " " && code[1] !== undefined ? code[1] : code[0]).toUpperCase();
    const status = STATUS_LETTERS[letter] ?? "unknown";
    if (body.includes(" -> ")) {
      const [from, to] = body.split(" -> ");
      entries.push({
        status: status === "renamed" || status === "copied" ? status : "renamed",
        path: normalisePath(to),
        from: normalisePath(from),
        raw: trimmed,
      });
      continue;
    }
    entries.push({ status, path: normalisePath(body), from: null, raw: trimmed });
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* THE PATHS THE RULE COVERS                                                  */
/* -------------------------------------------------------------------------- */

/** `lib/db/migrations/NNNN_tag.sql` — the executable half. */
export const MIGRATION_SQL_PATH = /^lib\/db\/migrations\/([0-9]{4}_[A-Za-z0-9_]+)\.sql$/;
/** `lib/db/migrations/meta/NNNN_snapshot.json` — what the next diff is generated against. */
export const MIGRATION_SNAPSHOT_PATH = /^lib\/db\/migrations\/meta\/([0-9]{4})_snapshot\.json$/;
/** The journal itself. Appending to it is the ONLY sanctioned edit. */
export const JOURNAL_PATH = "lib/db/migrations/meta/_journal.json";

/* -------------------------------------------------------------------------- */
/* THE VERDICT                                                                */
/* -------------------------------------------------------------------------- */

export type ImmutabilityRule =
  | "migration-modified"
  | "migration-deleted"
  | "migration-renamed"
  | "snapshot-modified"
  | "snapshot-deleted"
  | "snapshot-renamed"
  | "journal-entry-rewritten"
  | "journal-entry-dropped"
  | "journal-entry-without-file"
  | "file-without-journal-entry"
  | "applied-sql-rewritten";

export interface ImmutabilityViolation {
  /** Stable id, so a failure message can be grepped for. */
  readonly rule: ImmutabilityRule;
  /** The offending path, or the journal when the offence is an entry. */
  readonly path: string;
  /** The migration tag, when the offence has one. */
  readonly tag: string | null;
  /** What happened, naming the file. One sentence. */
  readonly what: string;
  /** What to do instead. Never a shrug, and never "revert your work". */
  readonly remedy: string;
}

export interface MigrationImmutabilityInput {
  /**
   * The changes between the merge base and HEAD. `null` means they could not
   * be computed — NOT that nothing changed, and never a pass.
   */
  readonly changes: readonly ChangedEntry[] | null;
  /** What was compared against, printed verbatim so a verdict can be checked. */
  readonly baseDescription: string;
  /** The journal AS OF THE MERGE BASE. `null` when it could not be read. */
  readonly baseJournal: readonly JournalEntry[] | null;
  /** The journal at HEAD. */
  readonly headJournal: readonly JournalEntry[];
  /** Every `NNNN_tag` with a `.sql` file on disk at HEAD. */
  readonly sqlTagsOnDisk: readonly string[];
}

export interface MigrationImmutabilityVerdict {
  readonly verdict: "pass" | "fail" | "cannot-tell";
  readonly violations: readonly ImmutabilityViolation[];
  /** The questions that WERE asked, by name. */
  readonly checked: readonly string[];
  /** The questions that could not be asked, by name, each with why. */
  readonly cannotTell: readonly string[];
  /** One sentence per violation, ready to print. */
  readonly failures: readonly string[];
  readonly summary: string;
}

/** The remedy, stated once, because it is the same for every offence here. */
export const CORRECTION_IS_A_NEW_MIGRATION =
  "An established migration is IMMUTABLE. Restore the file exactly as the merge base has it " +
  "and express the correction as a NEW migration (pnpm db:generate), declared in " +
  "MIGRATION_PHASES in lib/db/migration-phases.ts. A rewritten file still reports as APPLIED " +
  "everywhere, because the applied-join is on the journal's `when` and never on the SQL — so " +
  "the repository would carry SQL production has never executed and nothing would say so.";

/**
 * The whole verdict, from the four inputs. No I/O.
 *
 * The ORDER of the checks is the order of their blast radius: a rewritten
 * `.sql` first, because that is the file production ran; then the generated
 * snapshot, then the journal's own history, then the correspondence between
 * the journal and the disk.
 */
export function evaluateMigrationImmutability(
  input: MigrationImmutabilityInput,
): MigrationImmutabilityVerdict {
  const violations: ImmutabilityViolation[] = [];
  const checked: string[] = [];
  const cannotTell: string[] = [];

  /* ---- 1 & 2. the merge-base diff ------------------------------------- */

  if (input.changes === null) {
    cannotTell.push(
      `the merge-base diff could not be computed (${input.baseDescription}), so whether an ` +
        "established migration was rewritten, deleted or renamed is UNKNOWN — this is not a pass",
    );
  } else {
    checked.push(
      `${input.changes.length} change(s) against ${input.baseDescription}, for modification, ` +
        "deletion and rename of an established migration",
    );
    for (const change of input.changes) {
      const sqlTag = MIGRATION_SQL_PATH.exec(change.path)?.[1] ?? null;
      const fromSqlTag = change.from ? (MIGRATION_SQL_PATH.exec(change.from)?.[1] ?? null) : null;
      const snapshotIdx = MIGRATION_SNAPSHOT_PATH.exec(change.path)?.[1] ?? null;
      const fromSnapshotIdx = change.from
        ? (MIGRATION_SNAPSHOT_PATH.exec(change.from)?.[1] ?? null)
        : null;

      if (sqlTag !== null || fromSqlTag !== null) {
        const tag = fromSqlTag ?? sqlTag;
        if (change.status === "renamed" || change.status === "copied") {
          violations.push({
            rule: "migration-renamed",
            path: change.from ?? change.path,
            tag,
            what:
              `${change.from} was RENAMED to ${change.path}. A rename is a delete and an add ` +
              "wearing one line: the tag production applied no longer has a file, and a file " +
              "nothing has applied appears under a new name.",
            remedy: CORRECTION_IS_A_NEW_MIGRATION,
          });
        } else if (change.status === "deleted") {
          violations.push({
            rule: "migration-deleted",
            path: change.path,
            tag,
            what:
              `${change.path} was DELETED. It exists in the merge base, so it is on main, on ` +
              "every deploy built from main, and — if it was ever applied — it is SQL production " +
              "has already executed. Deleting the file does not unapply it.",
            remedy: CORRECTION_IS_A_NEW_MIGRATION,
          });
        } else if (change.status !== "added") {
          violations.push({
            rule: "migration-modified",
            path: change.path,
            tag,
            what:
              `${change.path} was ${change.status === "unknown" ? `changed (git said ${JSON.stringify(change.raw)})` : change.status.toUpperCase()}. ` +
              "It exists in the merge base, so the SQL committed here is no longer the SQL that " +
              "was reviewed, shipped and — if it was applied — executed against production.",
            remedy: CORRECTION_IS_A_NEW_MIGRATION,
          });
        }
        continue;
      }

      if (snapshotIdx !== null || fromSnapshotIdx !== null) {
        const idx = fromSnapshotIdx ?? snapshotIdx;
        if (change.status === "renamed" || change.status === "copied") {
          violations.push({
            rule: "snapshot-renamed",
            path: change.from ?? change.path,
            tag: idx,
            what: `${change.from} was RENAMED to ${change.path}. Drizzle resolves a snapshot by index; a renamed one is a missing one.`,
            remedy: CORRECTION_IS_A_NEW_MIGRATION,
          });
        } else if (change.status === "deleted") {
          violations.push({
            rule: "snapshot-deleted",
            path: change.path,
            tag: idx,
            what:
              `${change.path} was DELETED. It is the state every LATER db:generate diffs ` +
              "against, so removing it changes what future migrations contain.",
            remedy: CORRECTION_IS_A_NEW_MIGRATION,
          });
        } else if (change.status !== "added") {
          violations.push({
            rule: "snapshot-modified",
            path: change.path,
            tag: idx,
            what:
              `${change.path} was ${change.status.toUpperCase()}. It is the state every LATER ` +
              "db:generate diffs against; rewriting it silently changes what future migrations " +
              "contain, with no error anywhere.",
            remedy: CORRECTION_IS_A_NEW_MIGRATION,
          });
        }
      }
    }
  }

  /* ---- 3. the journal is append-only ---------------------------------- */

  if (input.baseJournal === null) {
    cannotTell.push(
      `the journal at ${input.baseDescription} could not be read, so whether an established ` +
        "journal entry was re-timestamped or dropped is UNKNOWN — this is not a pass",
    );
  } else {
    checked.push(
      `${input.baseJournal.length} established journal entr(ies) against HEAD's ` +
        `${input.headJournal.length}, for append-only`,
    );
    for (const base of input.baseJournal) {
      const here = input.headJournal.find((e) => e.idx === base.idx);
      if (!here) {
        violations.push({
          rule: "journal-entry-dropped",
          path: JOURNAL_PATH,
          tag: base.tag,
          what:
            `journal entry ${base.idx} (${base.tag}, when=${base.when}) is in the merge base and ` +
            "is GONE at HEAD. The journal is the applied-join's own record; dropping an entry " +
            "makes an applied migration unapplied everywhere at once.",
          remedy: CORRECTION_IS_A_NEW_MIGRATION,
        });
        continue;
      }
      if (here.tag !== base.tag || Number(here.when) !== Number(base.when)) {
        violations.push({
          rule: "journal-entry-rewritten",
          path: JOURNAL_PATH,
          tag: base.tag,
          what:
            `journal entry ${base.idx} was ${base.tag}/when=${base.when} in the merge base and is ` +
            `${here.tag}/when=${here.when} at HEAD. THE JOIN KEY IS \`when\`: move it and a ` +
            "migration production has applied reads as missing, on every surface, with no error.",
          remedy: CORRECTION_IS_A_NEW_MIGRATION,
        });
      }
    }
  }

  /* ---- 4. the journal and the disk correspond exactly ------------------ */

  checked.push(
    `${input.headJournal.length} journal entr(ies) against ${input.sqlTagsOnDisk.length} .sql ` +
      "file(s) on disk, in both directions",
  );
  const onDisk = new Set(input.sqlTagsOnDisk);
  const inJournal = new Set(input.headJournal.map((e) => e.tag));
  for (const entry of input.headJournal) {
    if (!onDisk.has(entry.tag)) {
      violations.push({
        rule: "journal-entry-without-file",
        path: `lib/db/migrations/${entry.tag}.sql`,
        tag: entry.tag,
        what:
          `the journal holds ${entry.tag} and there is no lib/db/migrations/${entry.tag}.sql. ` +
          "pnpm db:apply reads the journal and then reads the file; this one cannot be applied " +
          "at all, and nothing else in the repository would have said so.",
        remedy: CORRECTION_IS_A_NEW_MIGRATION,
      });
    }
  }
  for (const tag of input.sqlTagsOnDisk) {
    if (!inJournal.has(tag)) {
      violations.push({
        rule: "file-without-journal-entry",
        path: `lib/db/migrations/${tag}.sql`,
        tag,
        what:
          `lib/db/migrations/${tag}.sql exists and the journal does not name it. Nothing applies ` +
          "it, nothing checks it, and every count of 'committed migrations' in this repository " +
          "reads the journal — so it is invisible rather than pending.",
        remedy:
          "Either generate it properly with pnpm db:generate so it enters the journal, or remove " +
          "the stray file. A .sql under lib/db/migrations/ that no journal entry names is not a " +
          "migration; it is a file nothing will ever run.",
      });
    }
  }

  const failures = violations.map(
    (v) => `[${v.rule}] ${v.what}\n      ${v.remedy}`,
  );

  const verdict: MigrationImmutabilityVerdict["verdict"] =
    violations.length > 0 ? "fail" : cannotTell.length > 0 ? "cannot-tell" : "pass";

  const summary =
    verdict === "fail"
      ? `migration immutability REFUSED: ${violations.length} violation(s) — ` +
        `${[...new Set(violations.map((v) => v.rule))].join(", ")}`
      : verdict === "cannot-tell"
        ? `migration immutability COULD NOT TELL: ${cannotTell.length} question(s) could not be ` +
          "asked. Nothing is concluded, and an unasked question is not a passing one."
        : `migration immutability HOLDS: ${checked.length} question(s) asked against ` +
          `${input.baseDescription}, ${input.headJournal.length} established migration(s) intact`;

  return { verdict, violations, checked, cannotTell, failures, summary };
}

/* -------------------------------------------------------------------------- */
/* THE OTHER ANCHOR — the sha256 production itself recorded                   */
/* -------------------------------------------------------------------------- */

/** One row of `drizzle.__drizzle_migrations`, as the applier writes it. */
export interface AppliedHash {
  /** `created_at`, which is the journal's own `when`. */
  readonly when: number;
  /** sha256 of the migration file's RAW BYTES at the moment it was applied. */
  readonly hash: string;
}

/**
 * The hashes a database reports, or `null` when the reader does not carry them.
 *
 * **THIS RETURNS `null` TODAY, AND THAT IS A MEASUREMENT, NOT A STUB.**
 * `scripts/apply-migrations.mts` writes `hash` = sha256 of the file's raw bytes
 * into `drizzle.__drizzle_migrations`, exactly as `drizzle-kit` would. That
 * column is an independent record of WHAT PRODUCTION ACTUALLY EXECUTED, and
 * `lib/db/applied-migrations.ts` selects `created_at` alone — so it is written
 * on every apply and read by nothing.
 *
 * Adding `hash` to that one SELECT and returning it alongside `appliedWhen`
 * makes `checksumViolations` live against production. Until then this reports
 * the absence by name and the gate prints it as a NAMED GAP rather than
 * printing nothing, because a check that is not running must never be silent.
 */
export function appliedHashesFrom(read: unknown): AppliedHash[] | null {
  const rows = (read as { appliedHashes?: unknown })?.appliedHashes;
  if (!Array.isArray(rows)) return null;
  const out: AppliedHash[] = [];
  for (const row of rows) {
    const when = Number((row as { when?: unknown })?.when);
    const hash = (row as { hash?: unknown })?.hash;
    if (Number.isFinite(when) && typeof hash === "string" && hash.length > 0) {
      out.push({ when, hash });
    }
  }
  return out;
}

/**
 * Committed SQL whose sha256 disagrees with what the database recorded applying.
 *
 * The comparison is one-sided on purpose. A committed migration the database
 * has NOT applied has no recorded hash and is not a violation here — that is
 * the shipping invariant's question, and answering it twice in two vocabularies
 * is how two surfaces start disagreeing about one database. What this asks is
 * narrower and is asked nowhere else: **for the migrations production says it
 * ran, is the file in this checkout still the file it ran?**
 *
 * `sha256Of` is injected so this module stays pure; the gate passes a reader
 * over `lib/db/migrations/`. A tag whose file cannot be read returns `null` and
 * is reported as a violation of the correspondence rule above, not silently
 * skipped here.
 */
export function checksumViolations(
  journal: readonly JournalEntry[],
  appliedHashes: readonly AppliedHash[],
  sha256Of: (tag: string) => string | null,
): ImmutabilityViolation[] {
  const byWhen = new Map(appliedHashes.map((a) => [Number(a.when), a.hash]));
  const violations: ImmutabilityViolation[] = [];
  for (const entry of journal) {
    const recorded = byWhen.get(Number(entry.when));
    if (recorded === undefined) continue;
    const here = sha256Of(entry.tag);
    if (here === null) continue;
    if (here !== recorded) {
      violations.push({
        rule: "applied-sql-rewritten",
        path: `lib/db/migrations/${entry.tag}.sql`,
        tag: entry.tag,
        what:
          `${entry.tag} is recorded as APPLIED with sha256 ${recorded.slice(0, 16)}… and the ` +
          `committed file hashes to ${here.slice(0, 16)}…. The SQL in this checkout is NOT the ` +
          "SQL that ran. Every timestamp-joined check in this repository — db:check, /api/schema, " +
          "the daily tripwire, the shipping gate — reads this migration as applied and in sync.",
        remedy: CORRECTION_IS_A_NEW_MIGRATION,
      });
    }
  }
  return violations;
}
