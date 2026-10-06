/**
 * WHAT THE DRIVE MIRROR HOLDS — the canonical set, in one place.
 *
 * ## Why this file exists
 *
 * Two consecutive session reports named different file sets as "the mirror".
 * g6 named seven, hotfix-0817 named ten, and only four overlapped. Neither was
 * lying: the copied list lived in `scripts/handoff.mjs` as `MIRRORED` and the
 * two GENERATED files (`git-state.txt`, `context.md`) lived nowhere at all —
 * they were written by two separate functions and counted by whoever happened
 * to be writing the report. A set that is only ever assembled in prose gets
 * assembled differently every time.
 *
 * As of 2026-08-17 the Drive folder's actual contents define the canonical
 * set, and it is the ten below. This module is that rule written into the
 * code, so the document mirror, the code mirror's duplicate refusal, and the
 * standing report all read the same array and cannot disagree again.
 *
 * `civic-app-brief.md` is deliberately absent. It was on an earlier standing
 * list, it is not in the folder, and it has not been for some time — dropped by
 * the same rule.
 *
 * ## Copied versus generated
 *
 * Eight of the ten are COPIES of a repo file: the repo is authoritative and the
 * mirror is downstream of it, so a drift check is meaningful and `handoff` runs
 * one. Two are GENERATED into the mirror with no repo counterpart, so there is
 * nothing to compare them against and a drift check could only report noise.
 * The distinction is `repoPath === null`, not a comment, because the report
 * needs to state it per file.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The ten.
 *
 * `mirrorName` is the filename in the Drive folder; `repoPath` is the repo file
 * it is copied from, or `null` when the file is generated into the mirror.
 */
export const MIRRORED_DOCS = [
  /*
   * **JOINED 2026-08-24, all four.** These are mirror
   * documents this repo PRODUCES, not files the author put in the folder — so
   * they belong in the canonical set rather than in `DECLARED_EXTRAS`, which
   * exists for things nothing here should touch.
   *
   * The questionnaire instrument and its invitation are here so they can be
   * read anywhere before anything sends, and nothing has been sent.
   * The transparency draft is here for the same reason. The portrait sheet is
   * how he now approves photographs: he glances at it and replies with numbers.
   *
   * `portraits-pending.png` carries a STABLE name on purpose. A dated filename
   * would grow a file a day and make him work out which one is live; the date
   * is printed inside the image, where a reader of the image will see it.
   */
  { mirrorName: "candidate-questionnaire.md", repoPath: "docs/candidate-questionnaire.md" },
  {
    mirrorName: "candidate-questionnaire-invitation.md",
    repoPath: "docs/candidate-questionnaire-invitation.md",
  },
  { mirrorName: "transparency-draft.md", repoPath: "docs/transparency-draft.md" },
  { mirrorName: "portraits-pending.png", repoPath: "docs/photo-review/portraits-pending.png" },

  /*
   * **JOINED 2026-08-25 with `pnpm matrix` (RULING 149).** The coverage matrix
   * is one row per candidate and one column per fact, and it is a SPREADSHEET
   * question — which is a thing to open in a spreadsheet, not in a terminal.
   *
   * It is INTERNAL and never rendered to a reader, and the mirror is not a
   * reader surface: it is the author's own folder. That distinction is the
   * whole of why this is allowed here and forbidden in `app/`.
   *
   * A STABLE name for the same reason `portraits-pending.png` has one: a dated
   * filename would grow a file per session and make him work out which one is
   * live. The measurement date is a column inside it.
   */
  { mirrorName: "coverage-matrix.csv", repoPath: "docs/coverage-matrix.csv" },

  { mirrorName: "CLAUDE.md", repoPath: "CLAUDE.md" },
  /*
   * **JOINED 2026-08-26 (the descent session, Item 1).** `docs/rulings.md` is
   * the append-only record of every decision that is not law, and every brief
   * for days has ordered sessions to READ it and hardcode from it. It was the
   * one such file unreadable from outside the repo: `CLAUDE.md`, `state.md`,
   * `source-ladder.md`, `context.md`, both tracker views and the gap ledger all
   * mirror, and this did not.
   *
   * That is RULING 108's failure pointed at a different file — anything that
   * must be read at session start lives where it can be read. And it is the
   * sentence written at the head of nearly every entry inside it: a ruling the
   * author cannot read is a ruling that does not bind him. He reads the folder.
   */
  { mirrorName: "rulings.md", repoPath: "docs/rulings.md" },
  { mirrorName: "abuse-policy.md", repoPath: "docs/abuse-policy.md" },
  { mirrorName: "vendor-review.md", repoPath: "docs/vendor-review.md" },
  // Joined 2026-08-13: a standing document that constrains what gets built,
  // the same argument that put vendor-review.md here.
  { mirrorName: "source-ladder.md", repoPath: "docs/source-ladder.md" },
  // Joined 2026-08-14: the author's production-defect scratchpad — written
  // from outside the repo, so it must be readable from outside the repo.
  { mirrorName: "defects.md", repoPath: "docs/defects.md" },
  { mirrorName: "state.md", repoPath: "docs/state.md" },
  { mirrorName: "tracker.csv", repoPath: "docs/tracker.csv" },
  { mirrorName: "types.ts", repoPath: "lib/sources/types.ts" },
  {
    mirrorName: "git-state.txt",
    repoPath: null,
    generatedBy: "writeGitState() in scripts/handoff.mjs (R09)",
  },
  {
    mirrorName: "context.md",
    repoPath: null,
    generatedBy: "writeContext() in scripts/context-file.mjs (R15)",
  },
  // Joined 2026-08-17, taking the canonical set
  // from ten to TWELVE. The deferred census (R31): the one complete list of
  // what is still open, so the reviewer reads the register rather than a
  // reconstruction of it. Both are ordinary committed repo files here — the
  // census is generated by `pnpm deferred`, which is deliberately a one-time
  // command and NOT wired into handoff, so what the mirror copies is whatever
  // the last run committed. They are listed here rather than left as loose
  // files in the folder because an undeclared file now fails the set check.
  { mirrorName: "deferred.md", repoPath: "docs/deferred.md" },
  { mirrorName: "deferred.csv", repoPath: "docs/deferred.csv" },
  // Joined 2026-08-17: the census split into Build and Non-code decisions,
  // because non-code work was confusing mixed in with build work.
  // `binary: true` is load-bearing — the mirror's "does this copy match any
  // committed version" check reads text and trims whitespace, which on a zip
  // compares two corrupted strings and would refuse every ordinary update.
  { mirrorName: "deferred.xlsx", repoPath: "docs/deferred.xlsx", binary: true },
  // Joined 2026-08-17, taking the set to FOURTEEN — R33 closed. The session map
  // is the author's 117 dispositions folded into a work order, and it was
  // reported as committed by a session that never committed it: the reviewer
  // was reading a file that did not exist in the repo. The author placed it in
  // `docs/` himself; mirroring it is what stops the same gap recurring, because
  // an absent mirror file now fails the set check out loud.
  { mirrorName: "session-map.md", repoPath: "docs/session-map.md" },
  // Joined 2026-08-18 (g16), taking the set to FIFTEEN. The independent
  // codebase audit the nine AUD tracker rows were dispositioned from. Those
  // rows were written from the session brief because the document itself was
  // in neither the repo nor the mirror when g15 looked; the author placed it
  // in docs/ during g16, and it is mirrored so the reviewer can read the
  // evidence behind the rows rather than the summary of it.
  { mirrorName: "audit-2026-08-18.md", repoPath: "docs/audit-2026-08-18.md" },
  // Joined 2026-08-20 (Prompt E items 6, 9, 10 and 11), taking the set to
  // NINETEEN. The tracker stopped being one CSV and became a workbook the
  // author edits plus three generated views, and the whole point of that work
  // is that he can open any of them and know where the project stands — which
  // is exactly what the mirror is for. `tracker.csv` stays: it is the frozen
  // pre-rebuild snapshot and it is the history.
  //
  // `binary: true` on the workbook for the same reason `deferred.xlsx` carries
  // it — the drift check reads text and trims whitespace, which on a zip
  // compares two corrupted strings and would refuse every ordinary update.
  { mirrorName: "tracker.xlsx", repoPath: "docs/tracker.xlsx", binary: true },
  { mirrorName: "tracker.md", repoPath: "docs/tracker.md" },
  { mirrorName: "log.md", repoPath: "docs/log.md" },
  /*
   * **JOINED 2026-08-30 (Session A, Work Item 7).**
   * The generated repo inventory: `pnpm repo-map` renders the tree, the
   * routes, the schema, the gates, the method store and the scheduled jobs
   * from the repository itself, so the reviewer reads a derived census from
   * the folder rather than a reconstruction from reports. It is a generated
   * artifact WITH a repo counterpart, so it is drift-checkable like
   * `coverage-matrix.csv` — which is the point of putting it in the canonical
   * set rather than declaring it an extra.
   *
   * **Not committed since 2026-10-01 (Sean):** every merge conflicted on it.
   * `handoff` writes it with `pnpm repo-map` before the copy, and
   * `uncommitted` tells the copy there is no git history to check it against.
   */
  { mirrorName: "repo-inventory.md", repoPath: "docs/repo-inventory.md", uncommitted: true },
];

/**
 * The ones with a repo counterpart, as `handoff` wants them — the rest are
 * generated at handoff time. Deliberately not stated as a count: the last one
 * said "eight" while the answer was twelve, because the set grew and the
 * sentence did not. The count that is asserted lives in the test.
 */
export const COPIED_DOCS = MIRRORED_DOCS.filter((d) => d.repoPath !== null);

/**
 * Subdirectories the mirror is expected to hold.
 *
 * `transcripts/` is the session export. `code/` is the code mirror (R30) — the
 * reviewer's read path into source, added 2026-08-17. Both are directories, so
 * neither is a document and neither belongs in the ten.
 */
export const EXPECTED_DIRS = ["transcripts", "code", "owner-intake"];

/**
 * **OWNER INTAKE — the folder the author writes into.** (A.1 WI8, 2026-08-30.)
 *
 * `defects.md` was his production-defect scratchpad and it joined the mirror on
 * 2026-08-14 for exactly the right reason: he writes from outside the repo, so
 * it had to be readable from outside the repo. It has since grown far too large
 * to work in and has become a MACHINE surface — a long committed record that
 * sessions append to and read. Asking him to keep writing into it is asking him
 * to edit a file whose primary reader is a script.
 *
 * So intake moves to a folder with exactly two inputs, and `defects.md` stays
 * in the set as a machine-maintained RECORD rather than a place he writes:
 *
 * ```
 *   owner-intake/defect-inbox/       screenshots. Unnamed. Annotated.
 *   owner-intake/Owner-Defects.xlsx  non-visual defects: wrong fact, wrong behavior
 * ```
 *
 * It is registered as an EXPECTED_DIR rather than as a mirrored document
 * because it is a directory, and directories have never been documents here —
 * the same reasoning that put `transcripts/` and `code/` in this list.
 */
export const OWNER_INTAKE_DIR = "owner-intake";

/** What the owner-intake folder is expected to hold. */
export const OWNER_INTAKE_INBOX = "defect-inbox";
export const OWNER_INTAKE_PROCESSED = "processed";
export const OWNER_INTAKE_WORKBOOK = "Owner-Defects.xlsx";

/**
 * Subdirectories that are the AUTHOR'S, not the mirror's.
 *
 * The same reasoning as DECLARED_EXTRAS one level up, for folders. He put
 * "Screenshots from Feedback" in the mirror on 2026-08-18 - 29 screenshots
 * taken during his own testing pass, matching docs/Feedback 8.18 1421 pm.docx
 * - and handoff failed on it, correctly, because nothing had declared it.
 * Declaring it here reports it and stops failing on it; an undeclared
 * directory still fails, and nothing is ever deleted either way.
 */
export const DECLARED_EXTRA_DIRS = ["Screenshots from Feedback"];

/**
 * Files in the folder that are the author's, not the mirror's.
 *
 * The rule says a difference between the folder and the ten is a loud
 * failure and never a silent reconciliation. Both halves are kept. But the
 * folder is the author's Drive folder, and on the day the check was written it
 * held three large CSV exports that nothing in this repo put there and nothing
 * in this repo should remove. Failing every handoff over them would make the
 * check permanently red, and a permanently red check is one everybody learns
 * to scroll past — the same end state as the skip flag the deploy gate refuses
 * to have.
 *
 * So: an extra file that is DECLARED here is reported and not failed, and the
 * declaration is in code where it can be read and argued with. An extra file
 * that is NOT declared still fails, which is the case the rule was about.
 * Nothing is ever deleted either way.
 *
 * If the author wants these gone from the folder, delete them in Drive and
 * delete these three lines; the check will go on being satisfied.
 */
export const DECLARED_EXTRAS = [
  /*
   * **THE PILOT DIGEST (Session C, PART G2, 2026-08-31).** Ours, unlike
   * everything else on this list, and declared here for a different reason.
   *
   * `scripts/pilot-runner.mts` writes these on every cycle so the owner can
   * read what the machine did without opening the repository. They are
   * standing documents with STABLE names — `pilot-digest.md` is overwritten
   * each cycle and `pilot-digest-log.md` is appended — so they are not the
   * dated-artifact drift the set check was built to catch.
   *
   * They are NOT in the canonical set because that set is drift-checked against
   * a repo counterpart, and these have none: they are written straight to the
   * mirror by a long-running process, and they change every cycle by design. A
   * counterpart in the repository would be stale within the hour and would make
   * the drift check permanently red — which is the failure mode this whole
   * block exists to avoid.
   *
   * So they are reported rather than failed. If the runner is uninstalled and
   * these stop being written, delete these two lines with it.
   */
  "pilot-digest.md",
  "pilot-digest-log.md",
  /*
   * The nightly window (RULING 242, 2026-09-02) delivers its digest the same
   * way: `nightly-window-digest.md` overwritten per window, `nightly-window-log.md`
   * appended. Written by scripts/nightly-window.mts; read by the owner; never
   * copied from the repository.
   */
  "nightly-window-digest.md",
  "nightly-window-log.md",
  // Written by the author 2026-08-15/16, 182 MB between them. Not mirror
  // documents, not produced by handoff, and not this script's to remove.
  "primary-rhetoric.csv",
  "primary-rhetoric-sample.csv",
  "primary-rhetoric-members.csv",
  /*
   * Placed by the author while verifying control fact F4 on 2026-08-30 — the
   * Pima adopted-reports PDF he found through the OnBase index search, and
   * named in that row's own Notes. His file, his evidence, and not this
   * script's to remove. Declared so the set check reports it instead of
   * failing on it.
   */
  "CL - Adopted_Reports_and_Plans - 8 25 2026 - MEMORANDUM OF UNDERSTANDING ESTABLISHING THE ARIZONA-TAIWAN TALENT AND INNOVATION HUB AT THE ROY PLACE BUILDING IN PIMA COUNTY-TUCSON, ARIZONA - 8 25 2026.pdf",
];

/** Every repo path the document mirror already carries. */
export const MIRRORED_DOC_REPO_PATHS = new Set(
  COPIED_DOCS.map((d) => d.repoPath),
);

/** Every filename the document mirror already occupies at the folder's top level. */
export const MIRRORED_DOC_NAMES = new Set(MIRRORED_DOCS.map((d) => d.mirrorName));

/**
 * Compare the folder's ACTUAL contents against the canonical ten.
 *
 * A difference here is a loud failure, not a silent reconciliation: name
 * what is extra and what is missing. So this
 * returns both lists and never repairs either one. Reconciling silently is how
 * the folder and the list drifted far enough apart to produce two contradictory
 * reports in the first place; a mirror that quietly deletes what it did not
 * expect would also be a mirror that can destroy the author's own files.
 *
 * Returns `null` when the drive is not reachable — which is not the same as
 * "the folder is empty", and the caller must not render it as such.
 */
export function checkMirrorContents(mirrorPath) {
  if (!existsSync(mirrorPath)) return null;

  const entries = readdirSync(mirrorPath);
  const files = [];
  const dirs = [];
  for (const name of entries) {
    if (statSync(join(mirrorPath, name)).isDirectory()) dirs.push(name);
    else files.push(name);
  }

  const missing = MIRRORED_DOCS.map((d) => d.mirrorName).filter(
    (name) => !files.includes(name),
  );
  const unexpected = files.filter((name) => !MIRRORED_DOC_NAMES.has(name));
  const extra = unexpected.filter((name) => !DECLARED_EXTRAS.includes(name));
  const declaredExtras = unexpected.filter((name) => DECLARED_EXTRAS.includes(name));
  const extraDirs = dirs.filter(
    (name) => !EXPECTED_DIRS.includes(name) && !DECLARED_EXTRA_DIRS.includes(name),
  );
  const declaredExtraDirs = dirs.filter((name) => DECLARED_EXTRA_DIRS.includes(name));
  const missingDirs = EXPECTED_DIRS.filter((name) => !dirs.includes(name));

  return { missing, extra, declaredExtras, extraDirs, declaredExtraDirs, missingDirs, files, dirs };
}
