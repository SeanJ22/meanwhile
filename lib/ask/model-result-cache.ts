import { createHash } from "node:crypto";

/**
 * **ONE MODEL CALL PER DISTINCT EVIDENCE, NOT PER VISITOR.** (2026-09-24.)
 *
 * Every Ask request made two model calls, and a second reader asking the same
 * question a minute later paid for both again — ~9 s and two metered calls for
 * an answer the instance had just produced from byte-identical evidence.
 *
 * The key is the INPUT, not the question alone:
 *
 * - synthesis is keyed by the resolved model and effort plus the whole evidence
 *   pack (records, gaps, denominators, subject, intent, tense, today). When the
 *   underlying civic data changes, a record's text, date or source changes, the
 *   pack changes, and the key changes with it: invalidation is structural, not
 *   a timer somebody has to remember. The TTL only bounds memory.
 * - interpretation is keyed by the resolved model plus the question and the
 *   exact context the model is shown (inventory, today, surface, prior turns).
 *
 * Equivalent questions share an entry when they differ only in case, spacing
 * or trailing punctuation. Only a successful model result is kept; a failure
 * is never replayed. The cache is per server instance: it spares repeated
 * requests on a warm instance and never crosses a deploy.
 */

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 15 * 60_000;

export class BoundedTtlCache<T> {
  private readonly entries = new Map<string, { value: T; at: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES, ttlMs: number = DEFAULT_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string, now: number = Date.now()): T | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (now - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    // Refresh recency: Map iteration order is insertion order.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, at: now });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Case, spacing and trailing punctuation never change what was asked. */
export function normalizeAskQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s?.!]+$/, "");
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function synthesisCacheKey(
  pack: { question: string; intent: unknown; temporal: unknown; subject: unknown; records: unknown; gaps: unknown; denominators: unknown; today: string },
  model: string,
  effort: string,
): string {
  return digest({
    v: 1,
    model,
    effort,
    question: normalizeAskQuestion(pack.question),
    intent: pack.intent,
    temporal: pack.temporal,
    subject: pack.subject,
    records: pack.records,
    gaps: pack.gaps,
    denominators: pack.denominators,
    today: pack.today,
  });
}

export function interpretationCacheKey(question: string, context: unknown, model: string): string {
  return digest({ v: 1, model, question: normalizeAskQuestion(question), context });
}
