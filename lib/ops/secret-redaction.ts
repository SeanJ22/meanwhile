/** No tool prints a credential value: secrets from the env file are redacted from any text before it is shown. */

import { existsSync, readFileSync } from "node:fs";

/** Below this length a value is configuration rather than a secret. */
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

/** Replace every secret value with a placeholder naming its variable, longest first, since a connection string contains a password. */
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

/** Every occurrence of every secret in one file's text, as hits rather than a boolean. */
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

/** Whether this variable is published to every reader by design: a rule about the `NEXT_PUBLIC_` prefix, not a hand-list. */
export function isPublishedByDesign(name: string): boolean {
  return name.startsWith("NEXT_PUBLIC_");
}
