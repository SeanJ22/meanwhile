/**
 * The canonical governance ledger — append-only, one JSON record per line.
 *
 * ## Why JSONL and not a directory of Markdown
 *
 * The ledger's job is to be READ BY A COMPILER and never hand-edited. Markdown
 * is the format a person edits, and every hand-maintained governance artifact
 * in this repository's history became a second authority the moment somebody
 * could edit it. One line per record also makes the append-only property
 * checkable by `git diff`: a change that rewrites an existing line is visible
 * as a modification rather than hiding inside a reflowed paragraph.
 *
 * The human-readable views — `docs/rulings.md`, `docs/governance/history.md`,
 * `docs/governance/current-decisions.md` — are GENERATED from this file and
 * regenerated on every governance change. They are output, never input.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type DecisionId,
  type GovernanceRecord,
  type Status,
  CURRENT_STATUSES,
  canonicalId,
  parseLegacyAlias,
} from "./schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const LEDGER_PATH = join(ROOT, "docs", "governance", "ledger.jsonl");

export function readLedger(path: string = LEDGER_PATH): GovernanceRecord[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: GovernanceRecord[] = [];
  let lineNo = 0;
  for (const raw of text.split("\n")) {
    lineNo += 1;
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as GovernanceRecord);
    } catch (err) {
      throw new Error(`ledger.jsonl line ${lineNo} is not valid JSON: ${String(err)}`);
    }
  }
  return out;
}

/**
 * Write the ledger. Keys are emitted in a FIXED ORDER so a rewrite produces a
 * byte-identical line for an unchanged record — otherwise every regeneration
 * would look like an edit and the append-only property would be unreadable in
 * a diff.
 */
const KEY_ORDER = [
  "id",
  "aliases",
  "kind",
  "status",
  "provenance",
  "domain",
  "title",
  "adopted",
  "relations",
  "operativePolicy",
  "claims",
  "uncertain",
  "routingNotes",
  "sourceRef",
  "body",
  "variants",
] as const;

export function serializeRecord(r: GovernanceRecord): string {
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) ordered[k] = (r as unknown as Record<string, unknown>)[k];
  // Anything the schema grows later still ships rather than being silently
  // dropped by a fixed key list — a serializer that loses a field is the
  // silent-trim shape this repository names most often.
  for (const k of Object.keys(r)) {
    if (!(k in ordered)) ordered[k] = (r as unknown as Record<string, unknown>)[k];
  }
  return JSON.stringify(ordered);
}

export function writeLedger(records: GovernanceRecord[], path: string = LEDGER_PATH): void {
  writeFileSync(path, records.map(serializeRecord).join("\n") + "\n", "utf8");
}

/**
 * The resolver. Every legacy string a session or a code comment might cite has
 * to land on the same record, or the migration has broken every `RULING 26`
 * reference in the tree.
 */
export class LedgerIndex {
  private readonly byId = new Map<string, GovernanceRecord>();
  private readonly byAlias = new Map<string, GovernanceRecord>();
  readonly records: GovernanceRecord[];

  // A plain field assignment rather than a TypeScript parameter property:
  // `node --test --experimental-strip-types` runs the suite, and strip-only
  // mode cannot compile a parameter property. The suite is the thing every
  // other protection in this repository runs through, so the constraint wins.
  constructor(records: GovernanceRecord[]) {
    this.records = records;
    for (const r of records) {
      this.byId.set(r.id, r);
      for (const a of r.aliases) this.byAlias.set(a.toUpperCase(), r);
    }
  }

  resolve(ref: string): GovernanceRecord | null {
    const trimmed = ref.trim();
    const direct = this.byId.get(trimmed);
    if (direct) return direct;
    const alias = this.byAlias.get(trimmed.toUpperCase());
    if (alias) return alias;
    const legacy = parseLegacyAlias(trimmed);
    if (legacy) return this.byId.get(legacy) ?? null;
    const bare = /^(\d+)$/.exec(trimmed);
    if (bare) return this.byId.get(canonicalId(Number(bare[1]))) ?? null;
    return null;
  }

  get(id: DecisionId): GovernanceRecord | null {
    return this.byId.get(id) ?? null;
  }

  has(id: DecisionId): boolean {
    return this.byId.has(id);
  }

  /** Records whose status places them in compiled CURRENT authority. */
  current(): GovernanceRecord[] {
    return this.records.filter((r) => CURRENT_STATUSES.includes(r.status));
  }

  byStatus(s: Status): GovernanceRecord[] {
    return this.records.filter((r) => r.status === s);
  }

  /** Highest numeric id in use. The next adoption takes this plus one. */
  highestNumber(): number {
    let max = 0;
    for (const r of this.records) {
      const m = /^R-(\d+)$/.exec(r.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }
}

export function loadIndex(path: string = LEDGER_PATH): LedgerIndex {
  return new LedgerIndex(readLedger(path));
}
