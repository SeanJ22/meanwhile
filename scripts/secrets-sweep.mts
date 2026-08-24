#!/usr/bin/env tsx
/**
 * `pnpm secrets:sweep` — RULING 127.
 *
 * Reads the actual values out of `.env.local` and looks for THOSE, across the
 * repository, the Drive mirror, and (with `--transcripts`) the session
 * transcripts. A pattern scan for credential-shaped strings would find every
 * git SHA in the repo and miss any credential that is not forty hex characters;
 * the reasoning is in `lib/ops/secret-redaction.ts`.
 *
 * ```
 * pnpm secrets:sweep                 repo + Drive mirror
 * pnpm secrets:sweep --transcripts   also the Claude session transcripts
 * ```
 *
 * **Exit 0 only when nothing was found AND something was actually searched.**
 * A sweep that read no files reports CANNOT RUN and exits non-zero, because a
 * sweep reporting nothing found without having looked is the failure this repo
 * names most often.
 *
 * `.env.local` itself is excluded, obviously — it is where the values live. So
 * is `.env.example` if it holds placeholders. Nothing else is exempt.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

import {
  findSecrets,
  isPublishedByDesign,
  loadSecrets,
  redactSecrets,
  type SecretHit,
} from "../lib/ops/secret-redaction.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
const TRANSCRIPTS = "C:/Users/seanj/.claude/projects/C--Users-seanj-dev-we-the-people";

const withTranscripts = process.argv.includes("--transcripts");

const secrets = loadSecrets(join(ROOT, ".env.local"));
if (secrets.length === 0) {
  console.error("secrets:sweep · CANNOT RUN — no secrets read from .env.local, so nothing could be searched for.");
  process.exit(2);
}

/** Never searched: the files whose job is to hold the values. */
const EXEMPT = new Set([".env.local", ".env", ".env.example"]);

function repoFiles(): string[] {
  /*
   * `filesThatWouldBeCommitted`, never a bare `git ls-files`.
   *
   * A gate that asks git for TRACKED files cannot see an UNSTAGED change — and
   * a credential pasted into a file and not yet committed is exactly the moment
   * this sweep needs to fire. `tests/gate-inputs.test.ts` refuses the bare form
   * by name, and it caught this file on the day it was written.
   *
   * It also uses `-z`, so a filename containing a newline cannot split one
   * entry into two: a sweep that can be walked past by naming a file oddly is
   * not a sweep.
   */
  return filesThatWouldBeCommitted({ cwd: ROOT });
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

function readText(path: string): string | null {
  try {
    if (statSync(path).size > 200 * 1024 * 1024) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const hits: SecretHit[] = [];
let filesRead = 0;
let filesSkipped = 0;

function sweep(label: string, files: string[], base: string) {
  let read = 0;
  for (const rel of files) {
    const abs = base ? join(base, rel) : rel;
    const name = abs.split(sep).pop() ?? "";
    if (EXEMPT.has(name)) continue;
    const text = readText(abs);
    if (text === null) {
      filesSkipped += 1;
      continue;
    }
    read += 1;
    hits.push(...findSecrets(abs, text, secrets));
  }
  filesRead += read;
  console.log(`  ${label.padEnd(24)} ${read} file(s) read`);
}

console.log(`secrets:sweep · ${secrets.length} secret value(s) from .env.local, searched BY VALUE\n`);

sweep("repository", repoFiles(), ROOT);

if (existsSync(MIRROR)) {
  sweep("Drive mirror", walk(MIRROR), "");
} else {
  console.log(`  ${"Drive mirror".padEnd(24)} NOT PRESENT at ${MIRROR} — not searched, and this is stated rather than counted as clean`);
}

if (withTranscripts) {
  if (existsSync(TRANSCRIPTS)) sweep("session transcripts", walk(TRANSCRIPTS), "");
  else console.log(`  ${"session transcripts".padEnd(24)} NOT PRESENT at ${TRANSCRIPTS}`);
} else {
  console.log(`  ${"session transcripts".padEnd(24)} not searched (pass --transcripts)`);
}

console.log(`\n  files read     ${filesRead}`);
console.log(`  files skipped  ${filesSkipped} (unreadable or over the size cap)`);

if (filesRead === 0) {
  console.error("\nsecrets:sweep · CANNOT RUN — zero files were read. This is not a clean result.");
  process.exit(2);
}

/*
 * THE SPLIT IS THE REPORT — RULING 105.
 *
 * A `NEXT_PUBLIC_*` value is compiled into the client bundle and served to
 * every reader by design. It is in `.env.local` because that is where the build
 * reads it, not because it is a secret, and reporting it as a leak would put
 * dozens of entries in front of whoever reads this — which is how a person
 * learns to skim the report and miss the one line that matters.
 *
 * They are still COUNTED and still NAMED, because setting something aside with
 * no number is the silent trim this repo names more often than any other defect.
 */
const secretHits = hits.filter((h) => !isPublishedByDesign(h.secretName));
const publicHits = hits.filter((h) => isPublishedByDesign(h.secretName));

console.log(
  `\nsecrets:sweep · ${secretHits.length} SECRET occurrence(s) · ` +
    `${publicHits.length} occurrence(s) of NEXT_PUBLIC_* values, which ship to every reader by design and are not leaks`,
);

if (publicHits.length > 0) {
  const names = [...new Set(publicHits.map((h) => h.secretName))].sort();
  console.log(`  set aside, by name: ${names.join(", ")}`);
}

if (secretHits.length === 0) {
  console.log(`\nsecrets:sweep · 0 secret occurrence(s) across ${filesRead} file(s) read.`);
  process.exit(0);
}

console.log("");
for (const h of secretHits) {
  console.log(`  LEAK  ${h.secretName} — ${h.occurrences} occurrence(s) in ${h.file}`);
  console.log(`        line(s): ${h.lines.slice(0, 20).join(", ")}${h.lines.length > 20 ? " …" : ""}`);
}

/*
 * THE SCRUB, AND WHY IT IS NOT THE FIX.
 *
 * `--scrub` rewrites each offending file with the values replaced by
 * `<REDACTED:NAME>`. It removes the credential from the surface that LEAVES THE
 * MACHINE, which is the Drive mirror (RULING 108 established that the mirror is
 * a place things land; this is the same surface pointed outward).
 *
 * It is deliberately NOT applied to the local `.jsonl` session transcripts under
 * `~/.claude/projects`. Those are the runtime's own files and editing them risks
 * corrupting session state to remove a secret that has already escaped — which
 * would be paying a real cost for no security. They are REPORTED instead.
 *
 * And a scrub never closes a leak. A value that has been written to a synced
 * folder must be assumed read. **Rotation is the fix; this is cleanup.**
 */
if (process.argv.includes("--scrub")) {
  console.log("\n  --scrub · rewriting the offending files with values replaced\n");
  const byFile = new Map<string, SecretHit[]>();
  for (const h of secretHits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file)!.push(h);
  }
  let scrubbed = 0;
  let refused = 0;
  for (const [file, fileHits] of byFile) {
    if (file.startsWith(ROOT)) {
      // A secret inside the repo is a different and worse problem — it would be
      // in git history, where a rewrite is not a file edit. Refuse and name it.
      console.log(`  REFUSED  ${file}`);
      console.log(`           this is INSIDE THE REPOSITORY, so the value is in git history too.`);
      console.log(`           Rewriting the file would leave the history untouched and read as fixed.`);
      refused += 1;
      continue;
    }
    const before = readText(file);
    if (before === null) {
      console.log(`  REFUSED  ${file} — could not be read`);
      refused += 1;
      continue;
    }
    const after = redactSecrets(before, secrets.filter((s) => !isPublishedByDesign(s.name)));
    if (after === before) {
      console.log(`  NO-OP    ${file} — nothing replaced, which contradicts the sweep; not written`);
      refused += 1;
      continue;
    }
    writeFileSync(file, after, "utf8");
    const remaining = findSecrets(file, readText(file) ?? "", secrets).filter(
      (h) => !isPublishedByDesign(h.secretName),
    );
    console.log(
      `  SCRUBBED ${file} — ${fileHits.reduce((n, h) => n + h.occurrences, 0)} value(s) replaced, ${remaining.length} remaining on re-read`,
    );
    if (remaining.length === 0) scrubbed += 1;
    else refused += 1;
  }
  console.log(`\n  scrubbed ${scrubbed} file(s), refused ${refused} of ${byFile.size}`);
}

console.log(
  "\n  A credential that has appeared in any of these must be treated as COMPROMISED and ROTATED.\n" +
    "  Scrubbing the file is necessary and is not sufficient — RULING 127.",
);
process.exit(1);
