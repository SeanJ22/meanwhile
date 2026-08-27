/**
 * The mechanical importer — legacy `docs/rulings.md` into the canonical ledger.
 *
 * ## The one law of this file
 *
 * **It never paraphrases.** 170-plus historical decisions carry the author's
 * own wording and their attached rationale, and rewriting them during ingestion
 * would replace the evidence with a session's reading of it — which is the
 * failure RULING 41 names about tracker rows, committed at scale.
 *
 * So the body is copied byte-for-byte from the heading to the next heading.
 * What the importer DERIVES is only the structured metadata around it: the id,
 * the aliases, the adopted date, and relations that the entry states in so many
 * words.
 *
 * ## Where it cannot tell, it says so
 *
 * Kind, domain and provenance are inferred from explicit markers. Where a
 * marker is absent the record lands as `PENDING_INTERPRETATION` with the
 * uncertainty NAMED, and the validator refuses to let it bind. Guessing would
 * manufacture an authority nobody granted — the exact move the provenance model
 * exists to prevent.
 */

import {
  type Domain,
  type GovernanceRecord,
  type Provenance,
  type RecordKind,
  type Relation,
  type RelationKind,
  type Status,
  canonicalId,
  CURRENT_STATUSES,
} from "./schema.ts";
import { scopeFor } from "./amendment-scopes.ts";

export interface ParsedEntry {
  /** The `### ...` heading line, without the marker. */
  heading: string;
  /** Everything from the heading to the next heading of equal or higher rank. */
  body: string;
  /** The `## ...` section heading this entry sat under. */
  section: string;
  line: number;
}

const HEADING = /^(#{2,3})\s+(.*)$/;

/** Split the legacy document into entries, preserving body text verbatim. */
export function parseRulingsDoc(text: string): ParsedEntry[] {
  const lines = text.split("\n");
  const entries: ParsedEntry[] = [];
  let section = "";
  let open: { heading: string; line: number; buf: string[]; section: string } | null = null;

  const flush = () => {
    if (!open) return;
    entries.push({
      heading: open.heading,
      body: open.buf.join("\n").replace(/\s+$/, ""),
      section: open.section,
      line: open.line,
    });
    open = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING.exec(lines[i]);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      if (level === 2) {
        flush();
        section = title;
        // A `## RULING n` heading is an entry in its own right — the file uses
        // both ranks for real rulings (RULING 171 arrives at rank 2).
        if (/^RULING\s+\d+/i.test(title)) {
          open = { heading: title, line: i + 1, buf: [], section: title };
        }
        continue;
      }
      flush();
      open = { heading: title, line: i + 1, buf: [], section };
      continue;
    }
    if (open) open.buf.push(lines[i]);
  }
  flush();
  return entries;
}

/** `RULING 26 — the title` -> 26. Null for the non-numbered entries. */
export function rulingNumber(heading: string): number | null {
  const m = /^RULING\s+(\d+)\b/i.exec(heading.trim());
  return m ? Number(m[1]) : null;
}

const ISO = /\b(20\d{2}-\d{2}-\d{2})\b/;

export function adoptedDate(heading: string, body: string, section = ""): string | null {
  // The date the entry states for ITSELF is the first one in its opening
  // paragraph. A date deeper in the body is usually a date being described.
  const head = body.split("\n\n").slice(0, 2).join("\n\n");
  const own = ISO.exec(head)?.[1] ?? ISO.exec(heading)?.[1] ?? null;
  if (own) return own;
  // The early entries carry no date of their own because their SECTION heading
  // carries it — `## Prompt C (2026-08-20)` dates every ruling beneath it. That
  // is the document stating the date, not the importer inventing one.
  const fromSection = ISO.exec(section)?.[1] ?? null;
  if (fromSection) return fromSection;
  return ISO.exec(body)?.[1] ?? null;
}

const RELATION_WORDS: Array<[RegExp, RelationKind]> = [
  [/\bsupersedes\s+(?:and\s+replaces\s+)?RULING\s+(\d+)/gi, "supersedes_full"],
  [/\bamends\s+RULING\s+(\d+)/gi, "amends"],
  [/\bextends\s+RULING\s+(\d+)/gi, "extends"],
  [/\bclarifies\s+RULING\s+(\d+)/gi, "clarifies"],
  [/\bratifies\s+RULING\s+(\d+)/gi, "ratifies"],
  [/\bimplements\s+RULING\s+(\d+)/gi, "implements"],
  [/\bnarrows\s+RULING\s+(\d+)/gi, "amends"],
  [/\brefines\s+RULING\s+(\d+)/gi, "amends"],
];

/**
 * Relations are read only from language the entry actually uses. A relation
 * that has to be inferred from adjacency is a relation a session invented.
 */
export function extractRelations(body: string, selfId: string): Relation[] {
  const out = new Map<string, Relation>();
  for (const [re, kind] of RELATION_WORDS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const target = canonicalId(Number(m[1]));
      if (target === selfId) continue;
      const key = `${kind}:${target}`;
      if (out.has(key)) continue;
      const rel: Relation = { kind, target };
      // A scoped relation needs what changed and what survives. The importer
      // cannot author those sentences, so it records the entry's own claim and
      // flags the record uncertain rather than inventing a scope.
      out.set(key, rel);
    }
  }
  return [...out.values()];
}

/**
 * Domain routing, from vocabulary the entries already use. This is the one
 * piece of genuinely derived metadata, and it is derived from words rather
 * than from a hand-written list of 171 assignments — a hand list would be a
 * third authority, maintained by nobody.
 */
const DOMAIN_SIGNALS: Array<[Domain, RegExp]> = [
  ["discovery", /\b(ladder|rung|branch|manifest|hunt|absence|exhaust|descent|stuck protocol|tier A|discovery|walled|VERIFIED_ABSENT|retriev)/i],
  ["data-privacy", /\b(reaction|search log|identity boundary|joinable|continuity key|PII|anonym|subscriber|intake limiter|speak your mind)/i],
  ["sources-licensing", /\b(licen|robots|attribution|Wikipedia|Ballotpedia|credential|\.gov public domain|terms of use|source of record)/i],
  ["shipping-ci", /\b(deploy|Netlify|merge|close-?out|CI\b|workflow|build check|walk:all|gate|Actions|cron|schedule)/i],
  ["tracker-workflow", /\b(tracker|Needs Sean|row|resolved store|working store|priority|P1\b)/i],
  ["visual-feedback", /\b(capture|screenshot|annotated|walkthrough|layout|card|visual|dark mode|spec image)/i],
  ["business", /\b(sell|sold|buyer|solicit|exclusiv|rate sheet|export|aggregate.*buyer|revenue)/i],
  ["rendering-neutrality", /\b(render|reader|card|candidate|score|rank|recommend|neutral|donor|photo|blurb|plain language|measure)/i],
  ["meta-governance", /\b(ruling|numbering|append-only|CLAUDE\.md|governance|amendment procedure|law)/i],
];

export function inferDomain(heading: string, body: string): { domain: Domain; certain: boolean } {
  const hay = `${heading}\n${body}`;
  const hits: Array<[Domain, number]> = [];
  for (const [domain, re] of DOMAIN_SIGNALS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const n = (hay.match(g) ?? []).length;
    if (n > 0) hits.push([domain, n]);
  }
  if (hits.length === 0) return { domain: "meta-governance", certain: false };
  hits.sort((a, b) => b[1] - a[1]);
  // A clear winner is one that outscores the runner-up. A near-tie is a record
  // that genuinely spans two domains, and saying so beats picking one.
  const certain = hits.length === 1 || hits[0][1] > hits[1][1];
  return { domain: hits[0][0], certain };
}

export interface ImportOptions {
  /** Ids the constitution currently cites. Used only to seed LAW candidacy. */
  citedByConstitution: ReadonlySet<string>;
}

export interface ImportedRecord extends GovernanceRecord {
  /** Set where the importer read an explicit `Status:` marker. */
  declaredStatus: string | null;
}

/**
 * Import one parsed entry.
 *
 * Kind and status come from markers the document states. Where it states
 * nothing, the record is `PENDING_INTERPRETATION` / `HISTORICAL` and carries
 * its uncertainty by name — never a guess that would let it bind.
 */
export function importEntry(entry: ParsedEntry, options: ImportOptions): ImportedRecord {
  const n = rulingNumber(entry.heading);
  const id = n === null ? slugId(entry) : canonicalId(n);
  const aliases = n === null ? [] : [`RULING ${n}`, `R${n}`, `R-${n}`];
  const uncertain: string[] = [];
  const routingNotes: string[] = [];

  const declared = /\*\*Status:\s*([A-Z]+)/.exec(entry.body)?.[1] ?? null;
  const supersededHere = /\bSUPERSEDED\b/i.test(entry.body) && !/supersedes/i.test(entry.body);

  let kind: RecordKind;
  let status: Status;
  let provenance: Provenance;

  const authorVoice =
    /\b(the author'?s? (ruling|instruction|decision|standing order|authority|call|words)|Sean'?s (ruling|instruction|decision)|his ruling|author-approved|the author ruled)/i.test(
      entry.body,
    );

  if (n === null) {
    // The un-numbered entries are acceptances, ratifications and recorded
    // measurements. They were never rulings and typing them as such is the
    // "numbered therefore constitutional" error this schema exists to end.
    kind = classifyUnnumbered(entry, uncertain);
    status = "HISTORICAL";
    provenance = authorVoice ? "author_confirmed" : "observed_fact";
  } else if (declared === "DEAD" || supersededHere) {
    kind = "LAW_DECISION";
    status = "SUPERSEDED";
    provenance = authorVoice ? "author_explicit" : "author_confirmed";
  } else if (declared === "LAW" || options.citedByConstitution.has(id)) {
    kind = "LAW_DECISION";
    status = "ACTIVE";
    provenance = authorVoice ? "author_explicit" : "author_confirmed";
  } else {
    kind = "DECISION";
    status = "ACTIVE";
    provenance = authorVoice ? "author_explicit" : "author_confirmed";
    if (!authorVoice) {
      // Absent an explicit author-voice phrase, the constitution carrying the
      // rule IS the evidence. `CLAUDE.md` is changed only by the author, so a
      // rule sitting in it has his authority behind it whether or not the
      // ledger entry says "the author's ruling" in those words. That is
      // evidence read off an artifact, not a session upgrading its own prose —
      // which is the only upgrade the provenance model forbids.
      if (options.citedByConstitution.has(id)) {
        routingNotes.push("author voice implicit; provenance evidenced by citation in CLAUDE.md");
      } else {
        uncertain.push(
          "author voice not explicit in the entry and not cited by the constitution",
        );
      }
    }
  }

  const relations = extractRelations(entry.body, id);
  for (const rel of relations) {
    if (rel.kind !== "amends" && rel.kind !== "supersedes_clause") continue;
    // The scope sentences exist in the prose but are not machine-extractable
    // without paraphrasing them, so they are TRANSCRIBED once in
    // `amendment-scopes.ts` from each entry's own words. A pair that has not
    // been transcribed stays flagged and the record stays out of binding
    // authority — authoring one here would invent the amendment's reasoning.
    const scope = scopeFor(id, rel.target);
    if (scope) {
      rel.changed = scope.changed;
      rel.survives = scope.survives;
    } else {
      uncertain.push(`scope of ${rel.kind} -> ${rel.target} needs a named changed/survives pair`);
    }
  }

  const { domain, certain } = inferDomain(entry.heading, entry.body);

  const adopted = adoptedDate(entry.heading, entry.body, entry.section);
  if (!adopted) uncertain.push("no adopted date found in the entry or its section heading");

  // Routing notes are NOT authority doubt, and conflating them was an importer
  // defect that downgraded 74 real rulings to PENDING_INTERPRETATION. Which
  // policy file a rule files under says nothing about whether the author made
  // it; a rule spanning two domains is still binding in both. Only doubt about
  // WHO DECIDED or WHAT A RELATION CHANGED can block binding, because only
  // those two can manufacture an authority nobody granted.
  if (!certain) routingNotes.push(`domain routed to ${domain} without a clear signal winner`);

  // Uncertainty may not sit on a binding record. Downgrade rather than drop the
  // uncertainty — a record that binds because its doubt was deleted is worse
  // than one that is honestly unclassified.
  if (uncertain.length > 0 && (kind === "LAW_DECISION" || kind === "DECISION")) {
    kind = "PENDING_INTERPRETATION";
    status = "HISTORICAL";
  }

  return {
    id,
    aliases,
    kind,
    status,
    provenance,
    domain,
    title: entry.heading,
    adopted,
    body: entry.body,
    variants: [],
    relations,
    // Where the operative CURRENT text of this rule lives. It is derived from
    // the domain rather than hand-assigned 171 times, because a hand list would
    // be a third authority nobody maintains. Only law that is still in force
    // gets a pointer: a superseded rule has no current home, and giving it one
    // would put retired text back in front of a session.
    // The predicate is the SHARED one rather than a literal comparison. The
    // importer only ever emits ACTIVE, SUPERSEDED or HISTORICAL — `AMENDED`
    // arrives later, when the compiler applies a status resolution — so a
    // hand-written `status === "AMENDED"` here is dead code that TypeScript
    // correctly refuses. Asking `CURRENT_STATUSES` states the intent once and
    // keeps working when the status set grows.
    operativePolicy:
      kind === "LAW_DECISION" && (CURRENT_STATUSES as readonly string[]).includes(status)
        ? `docs/governance/policies/${domain}.md`
        : null,
    claims: [],
    uncertain,
    routingNotes,
    sourceRef: `docs/rulings.md:${entry.line}`,
    declaredStatus: declared,
  };
}

function slugId(entry: ParsedEntry): string {
  const slug = entry.heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `R-X-${slug}`;
}

function classifyUnnumbered(entry: ParsedEntry, uncertain: string[]): RecordKind {
  const h = entry.heading.toLowerCase();
  const b = entry.body.toLowerCase();
  if (/\bunassigned\b|deliberately unassigned/.test(h + b)) return "TOMBSTONE";
  if (/\baccepted\b|\bclosed\b|closed as correct/.test(h)) return "ACCEPTANCE";
  if (/\bwas kept\b|\bmoved nothing\b|\bis reserved\b/.test(h)) return "FACT";
  if (/^rulings \d+/i.test(entry.heading)) return "FACT";
  uncertain.push("un-numbered entry: kind read from heading vocabulary");
  return "INTERPRETATION";
}
