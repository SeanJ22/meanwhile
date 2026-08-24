/**
 * NO TOOL PRINTS A CREDENTIAL VALUE — RULING 127 (2026-08-24, Sean's
 * instruction, item 3).
 *
 * ## What actually happened, because the mechanism is the whole lesson
 *
 * `CENSUS_API_KEY` reached a session transcript in plaintext. The transcript
 * mirrors to Drive, where an external audit tool can read it. Sean rotated the
 * key.
 *
 * **Nobody typed the key.** The session ran a `curl` with `-w '%{url_effective}'`,
 * and curl printed the resolved URL back — which for this API carries the key as
 * a query parameter. The credential escaped through a *reporting* field of a
 * tool that was being used correctly. That is the shape this guards: not a
 * careless paste, but an output channel nobody classified as an output channel.
 *
 * **And the rotation did not end it.** Sweeping the transcripts by VALUE found
 * the replacement key in the same file, twice, by the same mechanism — which no
 * amount of care about pasting would have caught, and which a pattern-based
 * scanner would have missed too, because a Census key is forty hex characters
 * and so is every git SHA in the repo.
 *
 * ## THE SWEEP IS BY VALUE, AND THAT IS RULING 110 APPLIED TO SECRETS
 *
 * A scan for credential-SHAPED strings searches for the form a secret takes
 * rather than for the secret. Every credential that does not match the pattern
 * passes; every SHA that does match is a false positive, and a sweep with
 * hundreds of false positives is a sweep nobody runs. Reading the actual values
 * out of `.env.local` and looking for those has neither problem, and it cannot
 * be wrong about what it found.
 *
 * ## WHAT IS DELIBERATELY NOT REDACTED
 *
 * Values shorter than `MIN_SECRET_LENGTH`. A twelve-character floor exists
 * because `WTP_DB_ROLE=local` is a "credential" in the ledger's sense, and
 * redacting the word `local` out of every output would destroy far more than it
 * protected. Short values are configuration, they are named in `docs/sources.md`
 * already, and they are not secrets. The floor is stated rather than implied so
 * that adding a genuinely short secret is a decision somebody has to make.
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * Below this length a value is configuration rather than a secret. See the
 * note above — `WTP_DB_ROLE=local` is the case that sets it.
 */
export const MIN_SECRET_LENGTH = 12;

export interface SecretValue {
  name: string;
  value: string;
}

/** Parse a dotenv file into (name, value) pairs long enough to be secrets. */
export function parseSecrets(text: string): SecretValue[] {
  const out: SecretValue[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value.length < MIN_SECRET_LENGTH) continue;
    out.push({ name: m[1], value });
  }
  return out;
}

export function loadSecrets(envPath: string): SecretValue[] {
  if (!existsSync(envPath)) return [];
  return parseSecrets(readFileSync(envPath, "utf8"));
}

/**
 * Replace every secret value with a named placeholder.
 *
 * Longest-first, because a connection string CONTAINS a password: redacting the
 * short one first would leave the long one partly intact and unrecognisable to
 * the second pass. The placeholder names the variable so a reader can still
 * tell WHICH credential was involved, which is the whole diagnostic value the
 * plaintext was carrying.
 */
export function redactSecrets(text: string, secrets: readonly SecretValue[]): string {
  let out = text;
  for (const { name, value } of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    if (!value) continue;
    out = out.split(value).join(`<REDACTED:${name}>`);
    // URL-encoded, because a key inside a query string may arrive percent-
    // encoded — which is exactly the channel this leaked through.
    const encoded = encodeURIComponent(value);
    if (encoded !== value) out = out.split(encoded).join(`<REDACTED:${name}>`);
  }
  return out;
}

export interface SecretHit {
  file: string;
  secretName: string;
  occurrences: number;
  /** The line numbers, so a scrub is a targeted edit rather than a hunt. */
  lines: number[];
}

/**
 * Find every occurrence of every secret in one file's text.
 *
 * Returns hits rather than a boolean, because "there is a leak somewhere" is
 * not a report anyone can act on — RULING 105's shape, one level down.
 */
export function findSecrets(
  file: string,
  text: string,
  secrets: readonly SecretValue[],
): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split(/\r?\n/);
  for (const { name, value } of secrets) {
    if (!value) continue;
    const encoded = encodeURIComponent(value);
    const at: number[] = [];
    let count = 0;
    for (const [i, line] of lines.entries()) {
      const n =
        line.split(value).length - 1 + (encoded !== value ? line.split(encoded).length - 1 : 0);
      if (n > 0) {
        count += n;
        at.push(i + 1);
      }
    }
    if (count > 0) hits.push({ file, secretName: name, occurrences: count, lines: at });
  }
  return hits;
}

/**
 * Is this variable PUBLISHED TO EVERY READER BY DESIGN?
 *
 * Next inlines `NEXT_PUBLIC_*` into the client bundle. Such a value is in
 * `.env.local` because that is where the build reads it, not because it is a
 * secret — MapTiler's browser key is served to every visitor on every page
 * load, and always was.
 *
 * It matters that this is a rule about the PREFIX and not a hand-list. A list
 * of "keys we decided are fine" grows by one every time someone finds the sweep
 * noisy, and eventually the sweep is quiet about something that matters. The
 * prefix is a fact about how the build treats the value, and Next enforces it.
 *
 * These are still counted and named in the report. Setting something aside
 * silently is the trim this codebase names more often than any other defect.
 */
export function isPublishedByDesign(name: string): boolean {
  return name.startsWith("NEXT_PUBLIC_");
}
