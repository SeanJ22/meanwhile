/** Saved key values are matched directly, including their URL-encoded forms. */
import { productionKeysStore } from "../core/keys-store.ts";
export interface SecretValue { name: string; value: string }
export async function loadSecrets(store: { list(): Promise<readonly { name: string }[]>; read(name: string): Promise<string | undefined> } = productionKeysStore()): Promise<SecretValue[]> {
  const values = await Promise.all((await store.list()).map(async ({ name }) => ({ name, value: await store.read(name) })));
  return values.filter((row): row is SecretValue => Boolean(row.value));
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
