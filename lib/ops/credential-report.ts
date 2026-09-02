/**
 * Credential reports — the record that an owner-accessible copy of a masked
 * provider secret exists, and where.
 *
 * The invariant: a provider that masks a credential after creation makes the
 * plaintext unrecoverable, so a copy must reach the gitignored secret store
 * (`.env.local`) BEFORE the provider installs it, and the session must report
 * that it did. Six fields are required so a later reader can find the copy
 * without the session that made it: name, provider, context, scope, actor,
 * owner-copy location.
 *
 * The value guard exists because the report file is COMMITTED. A field that
 * holds a secret-shaped value instead of a description is refused by field
 * name only — nothing here ever echoes a value, a line, or a file body.
 *
 * `data/ops/credential-events.jsonl` absent is the legitimate "no credential
 * event has happened" state. A present file that cannot be parsed is a failed
 * read and throws; it is never reported as zero events.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CREDENTIAL_REPORT_FIELDS = [
  "name",
  "provider",
  "context",
  "scope",
  "actor",
  "ownerCopyLocation",
] as const;
export type CredentialReportField = (typeof CREDENTIAL_REPORT_FIELDS)[number];

export const CREDENTIAL_EVENT_KINDS = ["CREATED", "ROTATED", "SCOPE_CHANGED"] as const;
export type CredentialEventKind = (typeof CREDENTIAL_EVENT_KINDS)[number];

export interface CredentialReport {
  readonly kind: CredentialEventKind;
  /** ISO date (or date-time) the event was reported. */
  readonly reportedAt: string;
  readonly name: string;
  readonly provider: string;
  readonly context: string;
  readonly scope: string;
  readonly actor: string;
  /** Where the owner can find the plaintext, e.g. `.env.local (VAR_NAME)`. */
  readonly ownerCopyLocation: string;
  readonly note?: string;
}

export type CredentialReportCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: string[]; readonly refused: string[] };

export const CREDENTIAL_EVENTS_PATH = "data/ops/credential-events.jsonl";

/**
 * A bare token is NAME-shaped — a branch, an env var, a dated slug — when its
 * `-`/`_`/`/` segments are all words or numbers, with at most one short
 * alphanumeric piece (a commit fragment). A provider secret has a long mixed
 * run or many mixed pieces, and neither is exempt.
 */
function isNameShaped(token: string): boolean {
  let mixed = 0;
  for (const seg of token.split(/[-_/]/)) {
    if (seg === "" || /^[A-Za-z]+$/.test(seg) || /^[0-9]+$/.test(seg)) continue;
    if (seg.length > 8) return false;
    mixed += 1;
  }
  return mixed <= 1;
}

/**
 * Does this VALUE look like a secret rather than a description of one?
 *
 * Three shapes: a bare whitespace-free token of 32+ characters from the
 * base64/url-safe alphabet that is not name-shaped; a URL carrying
 * `://user:pass@`; a PEM private-key header. A false refusal costs a reworded
 * field; a false pass costs a secret in git, so ambiguity refuses.
 */
export function looksLikeSecretValue(value: string): boolean {
  for (const m of value.matchAll(/(?:^|\s)([A-Za-z0-9_\-+/=]{32,})(?=\s|$)/g)) {
    if (!isNameShaped(m[1])) return true;
  }
  if (/:\/\/[^\s/@]+:[^\s/@]+@/.test(value)) return true;
  if (/BEGIN [^\n]*PRIVATE KEY/.test(value)) return true;
  return false;
}

function isBlank(v: unknown): boolean {
  return typeof v !== "string" || v.trim().length === 0;
}

function isIsoDate(v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

/** Check one report. Names fields only; never returns a field's value. */
export function checkCredentialReport(report: unknown): CredentialReportCheck {
  const missing: string[] = [];
  const refused: string[] = [];

  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    return { ok: false, missing: ["kind", "reportedAt", ...CREDENTIAL_REPORT_FIELDS], refused };
  }
  const r = report as Record<string, unknown>;

  if (!(CREDENTIAL_EVENT_KINDS as readonly unknown[]).includes(r.kind)) missing.push("kind");
  if (!isIsoDate(r.reportedAt)) missing.push("reportedAt");

  for (const field of CREDENTIAL_REPORT_FIELDS) {
    const v = r[field];
    if (isBlank(v)) missing.push(field);
    else if (looksLikeSecretValue(v as string)) refused.push(field);
  }
  // The note is optional, but it is committed like everything else.
  if (typeof r.note === "string" && looksLikeSecretValue(r.note)) refused.push("note");

  return missing.length === 0 && refused.length === 0 ? { ok: true } : { ok: false, missing, refused };
}

export interface LoadedCredentialReports {
  readonly reports: unknown[];
  /** The resolved file path that was read (or found absent). */
  readonly source: string;
  /** False when the file does not exist — a legitimate "no events" state. */
  readonly present: boolean;
}

/**
 * Read the JSONL event log: one JSON object per non-blank line.
 *
 * `path` may be repo-relative or absolute (the gate's env override). A line
 * that does not parse throws, naming the line NUMBER only.
 */
export function loadCredentialReports(root: string, path: string = CREDENTIAL_EVENTS_PATH): LoadedCredentialReports {
  const source = resolve(root, path);
  if (!existsSync(source)) return { reports: [], source, present: false };

  const reports: unknown[] = [];
  const lines = readFileSync(source, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    try {
      reports.push(JSON.parse(lines[i]));
    } catch {
      throw new Error(
        `credential events: line ${i + 1} of ${path} is not a JSON object — ` +
          "a failed read is never an empty success; the line is not echoed here",
      );
    }
  }
  return { reports, source, present: true };
}

export interface CredentialReportsCheck {
  readonly ok: boolean;
  readonly results: Array<{ index: number; ok: boolean; missing: string[]; refused: string[] }>;
}

/** Check every loaded report. `index` is the 0-based position in `reports`. */
export function checkCredentialReports(reports: unknown[]): CredentialReportsCheck {
  const results = reports.map((report, index) => {
    const c = checkCredentialReport(report);
    return c.ok
      ? { index, ok: true, missing: [], refused: [] }
      : { index, ok: false, missing: c.missing, refused: c.refused };
  });
  return { ok: results.every((r) => r.ok), results };
}

export const SESSION_REPORT_GATE_REFUSED = "SESSION REPORT GATE: REFUSED";

/**
 * The lines the session report gate prints, and whether it refuses.
 *
 * Report `#n` in the output is `index + 1`. Every count carries its
 * denominator. The gate line is the last line, present only on refusal.
 */
export function sessionReportGateLines(
  loaded: { readonly reports: readonly unknown[]; readonly present: boolean },
  displayPath: string = CREDENTIAL_EVENTS_PATH,
): { lines: string[]; refused: boolean } {
  if (!loaded.present) {
    return { lines: [`credential reports: none recorded (${displayPath} absent)`], refused: false };
  }
  if (loaded.reports.length === 0) {
    return {
      lines: [`credential reports: none recorded (${displayPath} present but holds no events)`],
      refused: false,
    };
  }

  const check = checkCredentialReports([...loaded.reports]);
  const lines: string[] = [];
  for (const r of check.results) {
    if (r.ok) {
      lines.push(`credential report #${r.index + 1}: OK`);
      continue;
    }
    const parts: string[] = [];
    if (r.missing.length) parts.push(`missing: ${r.missing.join(", ")}`);
    if (r.refused.length) parts.push(`refused: ${r.refused.join(", ")}`);
    lines.push(`credential report #${r.index + 1}: REFUSED — ${parts.join("; ")}`);
  }
  const complete = check.results.filter((r) => r.ok).length;
  lines.push(`credential reports: ${complete} of ${check.results.length} complete`);

  if (!check.ok) {
    const anyValue = check.results.some((r) => r.refused.length > 0);
    lines.push(
      `${SESSION_REPORT_GATE_REFUSED} — a credential report lacks required fields` +
        (anyValue ? " or carries a secret-shaped value where a description belongs" : ""),
    );
  }
  return { lines, refused: !check.ok };
}
