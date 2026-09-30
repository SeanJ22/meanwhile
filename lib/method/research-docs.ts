/**
 * **THE RESEARCH DOCS, LOADED IN FULL INTO THE FIELD MANUAL.**
 *
 * The per-state dossiers (`states/**` markdown) and the detective write-ups
 * (`docs/detective/`) hold what earlier hunts learned. A pointer entry ("read
 * this 50 KB file") means a worker inherits the fact that the knowledge exists
 * and none of the knowledge. Here every `##`/`###` section becomes its own
 * entry with its FULL body in the payload, so the section a worker needs is in
 * the manual it reads, and nothing of the document is left behind: the text
 * before the first heading rides on the document entry, and
 * `reassembleResearchDoc` puts the sections back together for the loss check.
 *
 * Pure: the caller reads the file and supplies the text.
 */

import { fieldManualEntryId, type FieldManualEntry } from "../control-plane/field-manual.ts";

export interface MarkdownSection {
  readonly level: number;
  readonly heading: string;
  readonly body: string;
}

/**
 * A document's `##`/`###` sections, fence-aware so a heading inside a code
 * fence is never read as one. `preamble` is everything before the first
 * section (the `#` title and its intro), kept so no text is dropped.
 */
export function splitMarkdownDocument(text: string): { readonly preamble: string; readonly sections: readonly MarkdownSection[] } {
  const sections: MarkdownSection[] = [];
  const pre: string[] = [];
  let cur: { level: number; heading: string; body: string[] } | null = null;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{2,3})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      if (cur) sections.push({ level: cur.level, heading: cur.heading, body: cur.body.join("\n").trim() });
      cur = { level: m[1]!.length, heading: m[2]!.trim(), body: [] };
    } else if (cur) cur.body.push(line);
    else pre.push(line);
  }
  if (cur) sections.push({ level: cur.level, heading: cur.heading, body: cur.body.join("\n").trim() });
  return { preamble: pre.join("\n").trim(), sections };
}

/** A section's first prose line: the short summary a projection shows. */
export function leadLine(body: string): string {
  return body.split("\n").find((l) => l.trim() && !/^[|>`#-]/.test(l.trim()))?.replace(/\s+/g, " ").trim()
    ?? body.split("\n").find((l) => l.trim())?.replace(/\s+/g, " ").trim() ?? "";
}

function firstUrl(text: string): string | null {
  const m = /\bhttps?:\/\/[^\s)>\]"'`]+/.exec(text);
  return m ? m[0].replace(/[.,;:]+$/, "") : null;
}

function latestDate(...values: (string | null | undefined)[]): string | null {
  const dates = values.filter((v): v is string => typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v));
  return dates.length === 0 ? null : dates.sort().at(-1)!;
}

export interface ResearchDocInput {
  /** Repo-relative, forward slashes. */
  readonly path: string;
  readonly text: string;
  /** Two-letter states the document is about; empty = portable. */
  readonly states: readonly string[];
  /** Vendor platforms named in a heading or opening lines. */
  readonly platformHints: (text: string) => readonly string[];
}

/** The entry kind a research document's sections carry, from where it lives. */
function kindFor(path: string): string {
  if (path.startsWith("docs/detective/")) return "DETECTIVE_FINDING";
  if (/\/NOTES\.md$/.test(path)) return "STATE_NOTE";
  if (/\/sources\.md$/.test(path)) return "SOURCE_REGISTER";
  if (/\/tenancy\.md$/.test(path)) return "PLATFORM_FINGERPRINT";
  if (/\/descent/.test(path)) return "DESCENT_NOTE";
  return "RESEARCH_SECTION";
}

/**
 * The section id, kept identical to the one the dossier importer has always used
 * (`path` + heading) so a re-seed refreshes the entry in place; a repeated
 * heading in the same file gets `#2`, `#3` rather than overwriting the first.
 */
export function sectionEntryId(path: string, heading: string, occurrence: number): string {
  return fieldManualEntryId(path, occurrence === 1 ? heading : `${heading}#${occurrence}`);
}

/** Every section of one research document as a manual entry, full body in the payload, plus the document entry carrying the preamble. */
export function researchDocEntries(doc: ResearchDocInput): FieldManualEntry[] {
  const { preamble, sections } = splitMarkdownDocument(doc.text);
  const kind = kindFor(doc.path);
  const seen = new Map<string, number>();
  const label = doc.states.length === 1 ? `${doc.states[0]!.toUpperCase()} — ` : "";
  const entries: FieldManualEntry[] = [];
  entries.push({
    id: fieldManualEntryId(doc.path, "doc"),
    role: "SHARED",
    kind,
    title: `${label}${doc.path}`.slice(0, 200),
    summary: (leadLine(preamble) || doc.path).slice(0, 300),
    states: [...doc.states],
    recordClasses: [],
    platforms: [...doc.platformHints(preamble.slice(0, 600))],
    outcome: "REFERENCE",
    url: doc.path,
    source: doc.path,
    observedAt: latestDate(preamble),
    tier: null,
    payload: { path: doc.path, bytes: Buffer.byteLength(doc.text), sections: sections.length, preamble },
  });
  for (const sec of sections) {
    const occurrence = (seen.get(sec.heading) ?? 0) + 1;
    seen.set(sec.heading, occurrence);
    entries.push({
      id: sectionEntryId(doc.path, sec.heading, occurrence),
      role: "SHARED",
      kind,
      title: `${label}${sec.heading}`.slice(0, 200),
      summary: (leadLine(sec.body) || sec.heading).slice(0, 300),
      states: [...doc.states],
      recordClasses: [],
      platforms: [...doc.platformHints(`${sec.heading}\n${sec.body.slice(0, 600)}`)],
      outcome: "REFERENCE",
      url: firstUrl(sec.body),
      source: doc.path,
      observedAt: latestDate(sec.heading, ...sec.body.split("\n").slice(0, 8)),
      tier: null,
      payload: { path: doc.path, heading: sec.heading, level: sec.level, occurrence, body: sec.body },
    });
  }
  return entries;
}

/** The document put back together from its entries, for the loss check. */
export function reassembleResearchDoc(entries: readonly FieldManualEntry[]): string {
  const doc = entries.find((e) => (e.payload as { preamble?: unknown }).preamble !== undefined);
  const parts: string[] = [];
  if (doc) parts.push(String((doc.payload as { preamble: string }).preamble));
  for (const e of entries) {
    const p = e.payload as { heading?: unknown; level?: unknown; body?: unknown };
    if (typeof p.heading === "string" && typeof p.body === "string") parts.push(`${"#".repeat(Number(p.level))} ${p.heading}\n${p.body}`);
  }
  return parts.join("\n");
}
