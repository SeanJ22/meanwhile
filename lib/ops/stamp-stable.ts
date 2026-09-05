/**
 * **RL-1 — A NO-OP REFRESH IS STAMP-STABLE.** (NH326/NH327, the author's
 * decision of 2026-09-05, in his words: "A repeated observation with
 * unchanged normalized civic facts must not rewrite canonical reader-source
 * bytes; record the new observation in operational refresh history. Preserve
 * exact-byte Reader Last-Mile proof; factual changes must still invalidate
 * it.")
 *
 * ## The defect this answers
 *
 * The daily refresh of 2026-09-05 12:59Z rewrote 762 `collectedAt`/`verifiedAt`
 * lines in the two NJ Morris ballot holdings and changed no record; the same
 * afternoon's run re-stamped the LegiScan, FEC, meetings and dotgov snapshots.
 * The Reader Last-Mile closure receipt binds every canonical holding by exact
 * byte, so each restamp read as a changed holding, the census validator refused
 * the whole batch, and every source went into debt. A check that found nothing
 * new had cost the reader a day of freshness and the tree a red gate.
 *
 * ## The rule, as code
 *
 * A writer that re-observes a source compares the FACTS it is about to write
 * with the facts already on disk — every field except the observation stamps
 * the writer names — and, when they are identical, leaves the file's bytes
 * untouched. The observation is not lost: it is recorded as an operational
 * fact (`RefreshObservation`) that the refresh runner folds into
 * `docs/refresh-run.json`, the run's history, instead of into the artifact.
 *
 * A factual change writes the file exactly as before, stamps included, and so
 * still invalidates the exact-byte proof. Nothing here weakens that proof: the
 * comparison decides only whether a write happens, never what the proof binds.
 *
 * ## What is a stamp
 *
 * Each writer names its own stamp keys. There is deliberately no global list:
 * `collectedAt` on a ballot row is an observation stamp, while a meeting's
 * `startsAt` is a fact, and only the writer knows which of its keys record
 * "when we looked" rather than "what we saw". A key named here is ignored at
 * every depth of the document. `ignoreTopLevel` additionally drops a
 * top-level accounting block (a meetings snapshot's per-run source report)
 * that describes the run rather than the civic record.
 *
 * @freshness-reads-here — `observedAt` is stamped by the writer that has just
 * re-read its source and is deciding whether the read changed a fact. The
 * stamp goes to the run record, never into the reader-bound artifact; the
 * artifact's own freshness stamps are the writer's and are left as they were
 * when nothing moved (RULING 107: a stamp records a read, and this is the read).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The environment variable the refresh runner sets so every writer it spawns reports here. */
export const OBSERVATIONS_ENV = "WTP_REFRESH_OBSERVATIONS";

export type FactsVerdict = "NEW_FILE" | "FACTS_UNCHANGED" | "FACTS_CHANGED";

/** One re-observation of a reader-bound artifact: what the writer saw, when, and what it did. */
export interface RefreshObservation {
  /** Repo-relative path of the artifact, forward slashes. */
  path: string;
  observedAt: string;
  verdict: FactsVerdict;
  /** True when the file's bytes moved (a new file or changed facts). */
  written: boolean;
  /** The keys the writer declared as observation stamps, ignored in the comparison. */
  stampKeys: string[];
  /** Top-level accounting blocks ignored in the comparison, if any. */
  ignoredTopLevel: string[];
  /** SHA-256 of the canonical facts serialization, stamps removed. */
  factsSha256: string;
}

export interface StampStableOptions {
  /** Keys that record when the source was looked at, not what it said. Ignored at every depth. */
  readonly stampKeys: readonly string[];
  /** Top-level keys describing the run's own accounting rather than the record. */
  readonly ignoreTopLevel?: readonly string[];
}

/** Deep copy of `value` with every stamp key removed at every depth. */
export function factsOf(value: unknown, options: StampStableOptions, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => factsOf(item, options, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (options.stampKeys.includes(key)) continue;
      if (depth === 0 && options.ignoreTopLevel?.includes(key)) continue;
      out[key] = factsOf(inner, options, depth + 1);
    }
    return out;
  }
  return value;
}

/** JSON with object keys sorted at every depth, so key order is never a "fact". */
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stableSerialize(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function factsSha256(value: unknown, options: StampStableOptions): string {
  return createHash("sha256").update(stableSerialize(factsOf(value, options))).digest("hex");
}

/**
 * Compare the facts about to be written with the facts on disk. `existingText`
 * is the current file's text, or null when there is none. Unparseable existing
 * bytes count as changed: a writer never keeps a file it cannot read.
 */
export function compareFacts(existingText: string | null, next: unknown, options: StampStableOptions): { verdict: FactsVerdict; factsSha256: string } {
  const digest = factsSha256(next, options);
  if (existingText === null) return { verdict: "NEW_FILE", factsSha256: digest };
  let existing: unknown;
  try {
    existing = JSON.parse(existingText);
  } catch {
    return { verdict: "FACTS_CHANGED", factsSha256: digest };
  }
  return { verdict: factsSha256(existing, options) === digest ? "FACTS_UNCHANGED" : "FACTS_CHANGED", factsSha256: digest };
}

export interface StampStableWriteInput extends StampStableOptions {
  /** Absolute path to write. */
  readonly absolutePath: string;
  /** Repo-relative path, recorded on the observation. */
  readonly path: string;
  /** The document about to be written. */
  readonly next: unknown;
  /** Exactly the bytes the writer would have written; the caller keeps its own formatting. */
  readonly serialize: (value: unknown) => string;
  /** Where observations go when the runner asked for them; defaults to the env hook. */
  readonly observationsPath?: string | null;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

export interface StampStableWrite extends RefreshObservation {
  /** The bytes on disk after the call: the new text, or the untouched existing text. */
  bytesOnDisk: string;
}

/**
 * Write `next` to `absolutePath` unless its facts equal the facts already
 * there. Either way the observation is recorded (to `observationsPath` when
 * set) and stated on stdout, so a skipped write is never a silent one.
 */
export function writeStampStable(input: StampStableWriteInput): StampStableWrite {
  const existingText = existsSync(input.absolutePath) ? readFileSync(input.absolutePath, "utf8") : null;
  const { verdict, factsSha256: digest } = compareFacts(existingText, input.next, input);
  const observedAt = (input.now ?? (() => new Date()))().toISOString();
  const written = verdict !== "FACTS_UNCHANGED";
  let bytesOnDisk = existingText ?? "";
  if (written) {
    mkdirSync(dirname(input.absolutePath), { recursive: true });
    bytesOnDisk = input.serialize(input.next);
    writeFileSync(input.absolutePath, bytesOnDisk, "utf8");
  }
  const observation: RefreshObservation = {
    path: input.path,
    observedAt,
    verdict,
    written,
    stampKeys: [...input.stampKeys],
    ignoredTopLevel: [...(input.ignoreTopLevel ?? [])],
    factsSha256: digest,
  };
  recordObservation(observation, input.observationsPath === undefined ? process.env[OBSERVATIONS_ENV] ?? null : input.observationsPath);
  const log = input.log ?? ((line: string) => console.log(line));
  log(
    verdict === "FACTS_UNCHANGED"
      ? `stamp-stable: ${input.path} — facts unchanged (observed ${observedAt}); bytes left untouched, stamps not rewritten: ${input.stampKeys.join(", ")}`
      : `stamp-stable: ${input.path} — ${verdict === "NEW_FILE" ? "new file" : "facts changed"}; written (observed ${observedAt})`,
  );
  return { ...observation, bytesOnDisk };
}

/** Append one observation as a JSON line. A missing target means the runner did not ask. */
export function recordObservation(observation: RefreshObservation, observationsPath: string | null): void {
  if (!observationsPath) return;
  mkdirSync(dirname(observationsPath), { recursive: true });
  appendFileSync(observationsPath, `${JSON.stringify(observation)}\n`, "utf8");
}

/** Read every observation the writers recorded; a missing file is no observations, never an error. */
export function readObservations(observationsPath: string | null | undefined): RefreshObservation[] {
  if (!observationsPath || !existsSync(observationsPath)) return [];
  return readFileSync(observationsPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RefreshObservation);
}
