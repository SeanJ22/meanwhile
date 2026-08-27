/**
 * Amendment scopes — what each partial amendment CHANGED and what SURVIVES.
 *
 * ## Why this file is transcription and not authorship
 *
 * `supersedes_clause` and `amends` are the two relations that may not collapse
 * to a boolean. Reducing "RULING 94's five moves stand, its placement stands,
 * and its void condition stands — what changes is what reaching the end of them
 * MEANS" to `superseded: true` destroys exactly the information a session needs,
 * and it is how a rule gets read as dead while three quarters of it is in force.
 *
 * The importer cannot extract these pairs, because they are sentences rather
 * than tokens. It flags them instead, which is correct: **an importer that
 * authored a scope would be inventing the amendment's own reasoning.**
 *
 * So the pairs are TRANSCRIBED here from each entry's own words. Every string
 * below is the ruling's own sentence about itself, compressed to the clause and
 * nothing added. Where an entry says "narrows nothing", that is what `survives`
 * records; where it enumerates what stands, those are the words used. A pair
 * that cannot be read off the entry does not get invented — it stays flagged,
 * and the record stays out of binding authority until the author supplies it.
 *
 * Ten pairs on adoption (2026-08-26), all ten transcribed, none authored.
 */

export interface AmendmentScope {
  changed: string;
  survives: string;
}

/** Keyed `<amendingId>-><targetId>`. */
export const AMENDMENT_SCOPES: Record<string, AmendmentScope> = {
  "R-0046->R-0036": {
    changed:
      "the author may delete a row outright, which RULING 36's three resolution states did not provide for",
    survives:
      "RULING 35's 'nothing is ever deleted' governs WORK rows — a session may not erase its own row by marking it done",
  },
  "R-0049->R-0001": {
    changed:
      "a merge taken to satisfy a mid-session instruction from the author does not count against the one-merge cap",
    survives:
      "RULING 1 still caps merges; RULING 38 still makes the author's note binding on the session that reads it",
  },
  "R-0079->R-0037": {
    changed:
      "where a dated ruling demonstrably answers a Needs Sean row, the session marks it Resolved and records the ruling number and shipping SHA",
    survives:
      "RULING 37's rule that only the author closes a Needs Sean row stands for every row awaiting his judgement, and sessions still OPEN rows",
  },
  "R-0084->R-0061": {
    changed: "the manifest's SHAPE — every route carries a tier and the tiers are walked in order",
    survives: "the manifest's BAR does not change; RULING 61's named-list exhaustion is untouched",
  },
  "R-0102->R-0092": {
    changed:
      "RULING 92 is given an end condition: a generator whose digest moved fails the build until its artifact is regenerated and the digest re-recorded",
    survives:
      "RULING 92's rule that you fix the generator and never the output stands in full",
  },
  "R-0124->R-0078": {
    changed:
      "the ORCHESTRATOR runs once daily and each SOURCE inside it runs at the rate its own data moves, replacing RULING 78's flat once-daily cadence for every scheduled refresh",
    survives:
      "RULING 78's rule that a gate running three times for one merge is one gate and two copies of it, and that nothing stops gating",
  },
  "R-0135->R-0104": {
    changed:
      "a file the author places in the repo is registered into git UNREAD — committing is registration, not action",
    survives:
      "RULING 104 in full; it narrows nothing, and the fence on the file's CONTENT stands in full force",
  },
  "R-0160->R-0120": {
    changed:
      "in-cycle sales are ALLOWED as standing policy, superseding the pilot-scoped retrospective-only posture, and neutrality is carried by four named constraints",
    survives:
      "RULING 120's prohibition on exclusivity and its equal-solicitation obligation are UNCHANGED and carried forward verbatim in force, as is buyer composition not being an obligation",
  },
  "R-0166->R-0084": {
    changed:
      "the ORDER INSIDE Tier A: the body's own publication is A0 and its bulk download is taken first, before A1 third-party compilations",
    survives:
      "RULING 84's three tiers stand and its cost-per-fact reasoning is untouched; it narrows nothing",
  },
  "R-0170->R-0094": {
    changed:
      "what reaching the end of the five moves MEANS — running them does not earn an absence and never has; any cap in any brief is a FLOOR",
    survives:
      "RULING 94's five moves stand, its placement between Tier B and Tier C stands, and its void condition stands",
  },
};

export function scopeFor(fromId: string, toId: string): AmendmentScope | null {
  return AMENDMENT_SCOPES[`${fromId}->${toId}`] ?? null;
}
