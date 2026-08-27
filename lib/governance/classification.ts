/**
 * Historical classification — the 43 records the mechanical importer could not
 * type from a marker, resolved from each entry's OWN WORDS.
 *
 * ## Why the importer left them alone
 *
 * `lib/governance/import.ts` reads kind and provenance from explicit markers.
 * Where a marker is absent it records `PENDING_INTERPRETATION` and says so,
 * because guessing would manufacture an authority nobody granted. That was the
 * right default and it left 43 records honestly unclassified.
 *
 * ## Why they can be classified now
 *
 * Not by a session deciding, but by reading what each entry SAYS about itself.
 * The legacy document supplies four distinct signals, and every assignment
 * below rests on one of them:
 *
 *   **"Not law. Recorded here."**   an explicit self-declaration → DECISION
 *   **"Adopted <date> (<brief>)"**  an adoption stamp → DECISION or LAW
 *   **"Sean's authority" / a quoted note** → `author_explicit`
 *   a statement about the world with no instruction → FACT
 *
 * ## The provenance floor, and where it comes from
 *
 * `docs/rulings.md` is titled *"Rulings — the author's decisions that are not
 * law"*, and its preamble describes every entry as a call the author made. An
 * entry in that document is therefore the author's decision by the document's
 * own account — `author_confirmed`, read off an artifact, exactly as a rule
 * sitting in `CLAUDE.md` is.
 *
 * `author_explicit` is reserved for entries that quote him directly or name his
 * authority in so many words. **The distinction is not decorative**: RULING 174
 * forbids a session upgrading its own prose into "Sean ruled this", and the
 * difference between "the document says he decided this" and "he said this" is
 * exactly the line that rule draws.
 *
 * ## What is NOT here
 *
 * Nothing is invented, nothing is paraphrased, and no entry is promoted to law
 * that does not already describe itself as law or as an amendment to law.
 */

import type { Provenance, RecordKind } from "./schema.ts";

export interface Classification {
  kind: RecordKind;
  provenance: Provenance;
  /** The words in the entry that support this. Quoted, not summarized. */
  evidence: string;
}

/**
 * The evidence strings are the entry's own language. Where one says
 * "self-declared", the entry literally contains that phrase.
 */
export const CLASSIFICATIONS: Record<string, Classification> = {
  // --- entries that declare their own type, verbatim -----------------------
  "R-0031": { kind: "DECISION", provenance: "author_confirmed", evidence: '"**Not law. Recorded here.**"' },
  "R-0034": { kind: "DECISION", provenance: "author_confirmed", evidence: '"**Not law. Recorded here.**"' },
  "R-0036": { kind: "DECISION", provenance: "author_confirmed", evidence: '"**Not law. Recorded here.**"' },
  "R-0039": { kind: "DECISION", provenance: "author_confirmed", evidence: '"**Not law. Recorded here.**"' },
  "R-0040": { kind: "DECISION", provenance: "author_confirmed", evidence: '"**Not law. Recorded here.**"' },

  // --- statements about the world, carrying no instruction -----------------
  "R-0008": {
    kind: "FACT",
    provenance: "observed_fact",
    evidence: '"The six API-client rows are records, sized, not implementations." A measurement of what Prompt C shipped.',
  },
  "R-0021": {
    kind: "FACT",
    provenance: "observed_fact",
    evidence: '"It is in `.env.local` at line 57." A statement about a file on a date, correcting an earlier wrong report.',
  },
  "R-X-f02-the-committee-denominator-is-per-representat": {
    kind: "FACT",
    provenance: "observed_fact",
    evidence:
      '"It was never a claim about how many parent committees exist and may not be treated as one." A count observed in one hunt.',
  },

  // --- a retired number ----------------------------------------------------
  "R-0011": {
    kind: "TOMBSTONE",
    provenance: "observed_fact",
    evidence: '"There is no RULING 11 and nothing is missing; the number was simply not used."',
  },

  // --- standing instructions, adopted, not promoted to constitutional law ---
  "R-0003": { kind: "DECISION", provenance: "author_confirmed", evidence: '"Report the number and the delta. Do not investigate its provenance."' },
  "R-0004": { kind: "DECISION", provenance: "author_confirmed", evidence: '"Do not look for them; do not recreate them."' },
  "R-0009": { kind: "DECISION", provenance: "author_confirmed", evidence: '"They can **never** establish Tier 2."' },
  "R-0010": { kind: "DECISION", provenance: "author_confirmed", evidence: '"Never present a ZCTA-derived answer as a ZIP-code answer without saying so."' },
  "R-0012": { kind: "DECISION", provenance: "author_confirmed", evidence: '"A source that is walled ... is a WALL: named, skipped ... Anything that is our code is a JOB failure."' },
  "R-0013": { kind: "DECISION", provenance: "author_confirmed", evidence: '"the type check now runs there on a checkout that was never built"' },
  "R-0014": { kind: "DECISION", provenance: "author_confirmed", evidence: '"A repo-relative path is POSIX, normalized once where it is produced, compared as POSIX everywhere."' },
  "R-0015": { kind: "DECISION", provenance: "author_confirmed", evidence: '"Never restate 15 as a floor."' },
  "R-0017": { kind: "DECISION", provenance: "author_confirmed", evidence: '"They are MARKED, never reinterpreted."' },
  "R-0019": { kind: "DECISION", provenance: "author_confirmed", evidence: '"This is a deliberate deferral, not an omission."' },
  "R-0025": { kind: "DECISION", provenance: "author_confirmed", evidence: '"must not change what a visitor sees"' },
  "R-0059": { kind: "DECISION", provenance: "author_confirmed", evidence: '"*Recorded 2026-08-21 by NH Hunt 5, from the session brief.*"' },
  "R-X-the-repeatability-bar-2026-08-20": {
    kind: "DECISION",
    provenance: "author_confirmed",
    evidence: '"The playbook is repeatable when the **third zip\'s** mandatory diff adds fewer than five new rungs."',
  },
  "R-X-the-zip-order-2026-08-20": {
    kind: "DECISION",
    provenance: "author_confirmed",
    evidence: '"All future depth work runs NH `03255` -> NJ `07866` -> AZ `85641` -> AZ `85701`." Carries an explicit Supersedes.',
  },

  // --- adopted in a brief, amending or shipping into product law ------------
  "R-0045": {
    kind: "LAW_DECISION",
    provenance: "author_confirmed",
    evidence: '"*Already law in `CLAUDE.md`; recorded here for the index.*" — it says it is law.',
  },
  "R-0046": { kind: "DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-20 (NH Hunt brief). Amends RULING 36.*"' },
  "R-0048": { kind: "DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-20 (NH Hunt brief).*"' },
  "R-0049": {
    kind: "LAW_DECISION",
    provenance: "author_confirmed",
    evidence: '"*Adopted 2026-08-20 (NH Hunt brief). Amends RULING 1.*" — RULING 1 is law, so its amendment is law.',
  },
  "R-0050": {
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    evidence: '"His note on `NH09`, verbatim: \\"Photos take priority...\\"" — the author\'s own words, quoted.',
  },
  "R-0051": {
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    evidence: '"His note on `PE04`, verbatim: \\"That one line should be listed once...\\"" — the author\'s own words, quoted.',
  },
  "R-0054": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-21 (NH Hunt 3), answering `NH12`.* ... Shipped in `lib/ballot/candidate-cards.ts`."' },
  "R-0055": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-21 (NH Hunt 3).* **Every photo is** ... Shipped as `data/photos/review.json`."' },
  "R-0064": {
    kind: "LAW_DECISION",
    provenance: "author_confirmed",
    evidence: '"*Adopted 2026-08-21 (NH Hunt 5).* ... they arrived in session briefs and were binding from the day they were made."',
  },
  "R-0065": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-21 (NH Hunt 5).* The footer is a named branch."' },
  "R-0066": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-21 (NH Hunt 5).* ... compliant routes only."' },
  "R-0067": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-22 (NJ Hunt 2).* **A total that reconciles is not a total that is correct.**"' },
  "R-0069": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"*Adopted 2026-08-22 (NJ Hunt 2). See RULING 73, which settles how it lands.*"' },

  // --- shipping and CI law, adopted late, all still in force ----------------
  "R-0155": {
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    evidence: '"(Adopted 2026-08-25, Sean\'s authority, from the recovery brief that followed `RO04`.)"',
  },
  "R-0156": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"(Adopted 2026-08-25, closing `NS20` and `NS21`.)"' },
  "R-0162": {
    kind: "LAW_DECISION",
    provenance: "author_confirmed",
    evidence: '"**A scheduled workflow that pushes to `main` declares which paths it may write.** ... Fail closed, per workflow, with no skip flag."',
  },
  "R-0163": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"**Branch protection is asserted against the live API by `pnpm protection:verify`.**"' },
  "R-0164": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"**Independent steps run to completion and report together.**"' },
  "R-0165": { kind: "LAW_DECISION", provenance: "author_confirmed", evidence: '"**What this replaces, and why.** ... A branch protection bypass **cannot** be granted to the GitHub Actions app."' },

  // --- the author confirming a prior reading --------------------------------
  "R-0168": {
    kind: "RATIFICATION",
    provenance: "author_explicit",
    evidence:
      '"Sean\'s ratification of the job-watch tracker grant" — "**`NH204` — RATIFIED**", recorded so a close has an authority which exists rather than a session deciding for him.',
  },
};

export function classificationFor(id: string): Classification | null {
  return CLASSIFICATIONS[id] ?? null;
}
