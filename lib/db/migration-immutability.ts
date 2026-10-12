/**
 * An established migration is immutable; a correction is a new migration.
 * "Applied" is decided by the journal's `when` timestamp, never the SQL, so a
 * rewritten applied file still reports in sync everywhere. This git-only guard
 * asks four questions against the merge base:
 *   1. Was any NNNN_*.sql modified, deleted or renamed rather than added?
 *   2. Was any established meta/NNNN_snapshot.json rewritten?
 *   3. Is the journal append-only (same index, `when` and `tag`)?
 *   4. Do the journal and the .sql files on disk correspond exactly?
 * `changes === null` means unreadable, never a pass. Pure; no I/O.
 */

import type { JournalEntry } from "./schema-state.ts";


/** An unrecognised git status on a migration file is treated as a modification (fail closed). */
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

/** Parses `git diff --name-status`; a rename (`R100\told\tnew`) reports both sides. */
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
 * Parses `git status --porcelain` so an uncommitted rewrite is also caught. The
 * rightmost non-space status letter describes the file on disk; `??` is an addition.
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


/** `lib/db/migrations/NNNN_tag.sql` — the executable half. */
export const MIGRATION_SQL_PATH = /^lib\/db\/migrations\/([0-9]{4}_[A-Za-z0-9_]+)\.sql$/;
/** `lib/db/migrations/meta/NNNN_snapshot.json` — what the next diff is generated against. */
export const MIGRATION_SNAPSHOT_PATH = /^lib\/db\/migrations\/meta\/([0-9]{4})_snapshot\.json$/;
/** The journal itself. Appending to it is the ONLY sanctioned edit. */
export const JOURNAL_PATH = "lib/db/migrations/meta/_journal.json";


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

/** The whole verdict from the four inputs. No I/O. */
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


/** One row of `drizzle.__drizzle_migrations`, as the applier writes it. */
export interface AppliedHash {
  /** `created_at`, which is the journal's own `when`. */
  readonly when: number;
  /** sha256 of the migration file's RAW BYTES at the moment it was applied. */
  readonly hash: string;
}

/** The hashes a database reports, or null (reported as a named gap) when the read does not carry them. */
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
 * A migration not yet applied has no recorded hash and is not a violation here.
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
