/**
 * Importing the constitution's UN-NUMBERED law.
 *
 * ## Why this exists at all
 *
 * The ledger holds 171 numbered rulings. It does not hold the law that was
 * never a ruling — the transparency mandate, the fourteen-rung ladder, the
 * never-generate-a-position rule, the four photo doors, the n-stores rule, the
 * Kelly standard. Those are among the most load-bearing rules in the product
 * and not one of them has a number.
 *
 * If the domain policies were hand-written to carry them, the policies would be
 * a NEW hand-maintained authority — the exact thing this remediation exists to
 * end, rebuilt inside the fix for it. So the un-numbered law becomes records
 * too, in its own id namespace, and the policies are generated from the ledger
 * like everything else.
 *
 * ## The namespace, and why it is separate
 *
 * `R-C-<slug>`. Not the numeric space, because these were never rulings and
 * minting ruling numbers for a hundred paragraphs would spend a hundred
 * immutable ids on records that never had one. Not `R-X-`, which belongs to the
 * un-numbered entries of `docs/rulings.md`. Three namespaces, three origins,
 * no collisions possible.
 *
 * ## What it does NOT do
 *
 * It does not paraphrase, reorder, compress or improve a single sentence. The
 * body is the constitution's own bytes. This is a move, not a rewrite.
 */

import { UNSTAMPED_NOTE, type Domain, type GovernanceRecord } from "./schema.ts";
import { inferDomain } from "./import.ts";

export interface ConstitutionBlock {
  heading: string;
  body: string;
  section: string;
  line: number;
  /** True for a `###` section, false for a bold-led paragraph run. */
  isSection: boolean;
}

const HEADING = /^(#{2,3})\s+(.*)$/;
const RULING_HEADING = /^RULING\s+\d+\b/i;

/**
 * Sections whose content is NOT law and must not become records.
 *
 * Each one is excluded for a stated reason, because an unexplained exclusion
 * list is how law quietly stops being law.
 */
export const NON_LAW_SECTIONS: Array<[string, string]> = [
  ["THE MAPPING TABLE", "a lookup table from a brief's letters to ruling numbers; the rulings themselves are records"],
  ["THE FIVE PROCESS RULINGS OF NJ HUNT 5", "a numbering-collision note; the five rulings are records 83-87"],
  ["WHAT IS LAW HERE, AND WHAT IS A RULING", "superseded by the typed ledger — RULING 172 and RULING 173 replace it"],
];

/**
 * Split the constitution into law blocks.
 *
 * Two granularities, because the file uses two. A `###` section that is not a
 * ruling is one block. Under a `##` section, each bold-led paragraph run before
 * the first `###` is one block — that is how the file writes a standing rule
 * ("**Never generate a candidate position.** ...").
 */
export function parseConstitution(text: string): ConstitutionBlock[] {
  const lines = text.split("\n");
  const blocks: ConstitutionBlock[] = [];
  let section = "";
  let inRulingSection = false;
  let sectionBuf: string[] = [];
  let sectionStart = 0;
  let openSection: { heading: string; line: number; buf: string[] } | null = null;

  const flushProse = () => {
    if (sectionBuf.length === 0) return;
    blocks.push(...splitBoldRuns(sectionBuf.join("\n"), section, sectionStart));
    sectionBuf = [];
  };

  const flushSection = () => {
    if (!openSection) return;
    blocks.push({
      heading: openSection.heading,
      body: stripRulingRuns(openSection.buf.join("\n")).replace(/\s+$/, ""),
      section,
      line: openSection.line,
      isSection: true,
    });
    openSection = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const m = HEADING.exec(lines[i]);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      if (level === 2) {
        flushProse();
        flushSection();
        section = title;
        inRulingSection = false;
        sectionStart = i + 1;
        continue;
      }
      flushProse();
      flushSection();
      inRulingSection = RULING_HEADING.test(title);
      if (!inRulingSection) openSection = { heading: title, line: i + 1, buf: [] };
      continue;
    }
    if (openSection) openSection.buf.push(lines[i]);
    else if (!inRulingSection) sectionBuf.push(lines[i]);
  }
  flushProse();
  flushSection();

  const excluded = new Set(NON_LAW_SECTIONS.map(([name]) => name));
  return blocks.filter((b) => {
    for (const name of excluded) if (b.heading.toUpperCase().startsWith(name.toUpperCase())) return false;
    // A bold-led block whose heading IS a ruling is the constitution's PARALLEL
    // COPY of a record the ledger already holds — RULING 37, 38 and 41 are
    // written this way, as bold paragraphs rather than `###` sections. Importing
    // them would mint a second canonical record for one rule, which is the
    // duplication this whole remediation exists to end. The ruling record is
    // canonical; this copy is what the migration removes.
    if (RULING_HEADING.test(b.heading)) return false;
    return b.body.trim().length > 0;
  });
}

/**
 * Remove bold-led RULING runs from a section body.
 *
 * `### THE DEFERRAL BOUNDARY` is a non-ruling section, and RULING 26, 27, 28
 * and 42 are written UNDERNEATH it as bold paragraphs rather than as their own
 * `###` headings. Without this, one constitution record swallows four rulings'
 * operative text and becomes a second canonical copy of each — the exact dual
 * write this migration exists to end, rebuilt by the importer.
 *
 * The rulings are canonical in the ledger. What is removed here is the
 * constitution's parallel copy, and the duplicate-canonical-law check is what
 * caught this rather than anybody noticing.
 */
function stripRulingRuns(text: string): string {
  const paras = text.split(/\n\s*\n/);
  const keep: string[] = [];
  let dropping = false;
  for (const p of paras) {
    const bold = /^\*\*([\s\S]+?)\*\*/.exec(p.trim());
    if (bold) dropping = RULING_HEADING.test(bold[1].replace(/\s+/g, " ").trim());
    if (!dropping) keep.push(p);
  }
  return keep.join("\n\n");
}

/**
 * A bold-led paragraph run is one rule. A run ends at the next bold-led
 * paragraph or at the end of the section, so a rule keeps its own rationale
 * paragraphs — which this repository requires, because a stripped rule reads as
 * guidance.
 */
function splitBoldRuns(text: string, section: string, startLine: number): ConstitutionBlock[] {
  const paras = text.split(/\n\s*\n/);
  const out: ConstitutionBlock[] = [];
  let current: { heading: string; buf: string[] } | null = null;
  let line = startLine;
  for (const p of paras) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const bold = /^\*\*([\s\S]+?)\*\*/.exec(trimmed);
    if (bold) {
      if (current) out.push(mk(current, section, line, false));
      current = { heading: bold[1].replace(/\s+/g, " ").trim(), buf: [trimmed] };
    } else if (current) {
      current.buf.push(trimmed);
    }
    line += p.split("\n").length + 1;
  }
  if (current) out.push(mk(current, section, line, false));
  return out;
}

function mk(
  c: { heading: string; buf: string[] },
  section: string,
  line: number,
  isSection: boolean,
): ConstitutionBlock {
  return { heading: c.heading, body: c.buf.join("\n\n"), section, line, isSection };
}

export function constitutionId(block: ConstitutionBlock): string {
  const slug = `${block.section} ${block.heading}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/, "");
  return `R-C-${slug}`;
}

/**
 * Un-numbered constitutional law is `author_explicit` by construction: the
 * constitution is changed only by the author, so a rule sitting in it has his
 * authority. That is evidence read off an artifact, not a session upgrading its
 * own prose — which is the only upgrade RULING 174 forbids.
 */
export function importConstitutionBlock(block: ConstitutionBlock): GovernanceRecord {
  const { domain } = inferDomain(block.heading, block.body);
  const adopted = adoptedFrom(block.body);
  const routingNotes = [
    "un-numbered constitutional law, moved into the ledger by the 2026-08-26 governance remediation",
    "provenance is author_explicit by construction: CLAUDE.md is changed only by the author",
  ];
  if (adopted === null) {
    routingNotes.push(`${UNSTAMPED_NOTE}; the date is UNKNOWN rather than guessed (RULING 107)`);
  }
  return {
    id: constitutionId(block),
    aliases: [],
    kind: "LAW_DECISION",
    status: "ACTIVE",
    provenance: "author_explicit",
    domain: domain as Domain,
    title: block.heading,
    adopted,
    body: block.body,
    variants: [],
    relations: DERIVED_FROM[constitutionId(block)] ?? [],
    operativePolicy: `docs/governance/policies/${domain}.md`,
    claims: [],
    uncertain: [],
    routingNotes,
    sourceRef: `CLAUDE.md:${block.line}`,
  };
}

/**
 * Constitution blocks that RESTATE a ruling rather than adding law of their own.
 *
 * The tracker-stores paragraph and RULING 35 both carry "nothing is ever
 * deleted; the resolved store is permanent and is the record of what was
 * decided and when". That is one rule written twice — the dual write this
 * remediation exists to end — and the honest repair is to DECLARE it rather
 * than to edit the author's sentence out of one of them. `derived_from` says
 * these are one rule, and the duplicate-canonical-law check then stops reading
 * them as two canonical sources.
 *
 * **This was found by that check, not by anybody reading the file.** That is
 * the whole argument for having it.
 */
const DERIVED_FROM: Record<string, GovernanceRecord["relations"]> = {
  "R-C-repo-layout-task-status-lives-in-the-two-tracker-stores-and-the": [
    { kind: "derived_from", target: "R-0035" },
  ],
};

const ISO = /\b(20\d{2}-\d{2}-\d{2})\b/;
const ADOPTED = /\b(?:Adopted|adopted|Rewritten|Stated|Created|Corrected|revised)[^.\n]{0,40}?(20\d{2}-\d{2}-\d{2})/;

function adoptedFrom(body: string): string | null {
  // The constitution stamps its own rules. Where a block carries no stamp the
  // date is genuinely unknown and stays null rather than being filled in with a
  // plausible one — that is the fabrication rule, and RULING 107 one floor up.
  return ADOPTED.exec(body)?.[1] ?? ISO.exec(body)?.[1] ?? null;
}
