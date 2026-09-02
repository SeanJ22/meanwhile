/**
 * READING THE LEGACY REFRESH'S OWN REPORT. (RULING 242, stage 1.)
 *
 * The machine-readable contract is `docs/refresh-run.json` (formatVersion 1).
 * When the file is absent the Markdown table in `docs/refresh-run.md` is
 * parsed instead and the reading SAYS SO — a fallback that reads as the
 * contract would misattribute what the refresh did.
 */

import type { LegacyRefreshReading, LegacySourceOutcome } from "./types.ts";

export interface RefreshRunJson {
  readonly formatVersion: 1;
  readonly runDate: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly mode: "CADENCE" | "ALL";
  readonly exitCode: 0 | 1 | 2;
  readonly sources: readonly {
    readonly id: string;
    readonly due: boolean;
    readonly ran: boolean;
    readonly outcome: "INGESTED" | "UNCHANGED" | "ROUTE_UNREAD" | "NOT_DUE";
    readonly reason: string;
    readonly commands: readonly string[];
    readonly failedCommand: string | null;
    readonly exitCode: number | null;
    readonly governs: readonly string[];
    readonly changedPaths: readonly string[];
    readonly recoveredFrom: readonly string[];
    readonly nextDueAt: string | null;
  }[];
}

export class RefreshRunUnreadable extends Error {
  constructor(where: string, detail: string) {
    super(`the legacy refresh report at ${where} could not be read as its contract: ${detail}`);
    this.name = "RefreshRunUnreadable";
  }
}

const OUTCOMES = ["INGESTED", "UNCHANGED", "ROUTE_UNREAD", "NOT_DUE"] as const;

export function parseRefreshRunJson(text: string, where = "docs/refresh-run.json"): LegacyRefreshReading {
  let parsed: RefreshRunJson;
  try {
    parsed = JSON.parse(text) as RefreshRunJson;
  } catch (error) {
    throw new RefreshRunUnreadable(where, error instanceof Error ? error.message : String(error));
  }
  if (parsed.formatVersion !== 1) {
    throw new RefreshRunUnreadable(where, `formatVersion ${JSON.stringify(parsed.formatVersion)} is not 1`);
  }
  if (!Array.isArray(parsed.sources)) throw new RefreshRunUnreadable(where, "sources is not an array");
  if (parsed.sources.length === 0) {
    throw new RefreshRunUnreadable(where, "sources is empty; a refresh over no sources is a failed read, never a quiet day");
  }
  const sources: LegacySourceOutcome[] = parsed.sources.map((s) => {
    if (typeof s.id !== "string" || s.id === "") throw new RefreshRunUnreadable(where, "a source carries no id");
    if (!(OUTCOMES as readonly string[]).includes(s.outcome)) {
      throw new RefreshRunUnreadable(where, `source ${s.id} outcome ${JSON.stringify(s.outcome)} is not one of ${OUTCOMES.join(", ")}`);
    }
    return {
      id: s.id,
      due: s.due === true,
      ran: s.ran === true,
      outcome: s.outcome,
      reason: s.reason ?? "",
      governs: s.governs ?? [],
      changedPaths: s.changedPaths ?? [],
      recoveredFrom: s.recoveredFrom ?? [],
      nextDueAt: s.nextDueAt ?? null,
    };
  });
  return { source: "JSON", runDate: parsed.runDate, exitCode: parsed.exitCode, sources };
}

/**
 * The Markdown fallback: `docs/refresh-run.md`'s table. Outcomes there are
 * "clean" / "failed" / "not due" words, mapped conservatively — a "clean" row
 * says the source RAN, not that anything moved, so it is UNKNOWN rather than
 * INGESTED or UNCHANGED.
 */
export function parseRefreshRunMarkdown(text: string): LegacyRefreshReading {
  const runDate = text.match(/Run date: \*\*(\d{4}-\d{2}-\d{2})\*\*/)?.[1] ?? null;
  const sources: LegacySourceOutcome[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\| `([a-z0-9-]+)` \| ([^|]*) \| (yes|no) \| ([^|]*) \| ([^|]*) \| (.*) \|\s*$/);
    if (!m) continue;
    const [, id, , ran, why, result, governsRaw] = m;
    const resultText = result.trim();
    const outcome: LegacySourceOutcome["outcome"] = resultText.startsWith("not due")
      ? "NOT_DUE"
      : resultText.startsWith("clean")
        ? "UNKNOWN"
        : resultText.startsWith("failed") || resultText.startsWith("FAILED")
          ? "ROUTE_UNREAD"
          : "UNKNOWN";
    const recovered = why.match(/(?:recover(?:ed|ing)|CATCH-UP for) (\d{4}-\d{2}-\d{2})/g)?.map((s) => s.slice(-10)) ?? [];
    sources.push({
      id,
      due: ran === "yes" || outcome !== "NOT_DUE",
      ran: ran === "yes",
      outcome,
      reason: `${why.trim()} — ${resultText}`,
      governs: [...governsRaw.matchAll(/`([^`]+)`/g)].map((x) => x[1]),
      changedPaths: [],
      recoveredFrom: recovered,
      nextDueAt: null,
    });
  }
  if (sources.length === 0) {
    throw new RefreshRunUnreadable("docs/refresh-run.md", "no source rows were found in the table; a zero-row parse is a failed read");
  }
  return { source: "MARKDOWN_FALLBACK", runDate, exitCode: null, sources };
}

/** One line per source for a digest. */
export function legacyRefreshLines(reading: LegacyRefreshReading | null): string[] {
  if (reading === null) return ["- legacy refresh: NOT RUN in this window (see the stage record for the reason)"];
  const out = [
    `- read from ${reading.source === "JSON" ? "docs/refresh-run.json (the contract)" : "docs/refresh-run.md (MARKDOWN FALLBACK — the JSON contract was absent, so outcomes are coarser than the contract's)"}` +
      `; run date ${reading.runDate ?? "unrecorded"}; exit ${reading.exitCode ?? "unrecorded"}`,
    `- ${reading.sources.filter((s) => s.ran).length} of ${reading.sources.length} source(s) ran`,
  ];
  for (const s of reading.sources) {
    out.push(
      `  - \`${s.id}\` — ${s.outcome}${s.ran ? "" : " (did not run)"}; governs ${s.governs.map((g) => `\`${g}\``).join(", ") || "nothing recorded"}` +
        (s.changedPaths.length > 0 ? `; changed ${s.changedPaths.join(", ")}` : "") +
        (s.recoveredFrom.length > 0 ? `; recovered ${s.recoveredFrom.join(", ")}` : "") +
        (s.reason ? ` — ${s.reason}` : ""),
    );
  }
  return out;
}
