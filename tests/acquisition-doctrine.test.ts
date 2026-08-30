import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { currentLawText } from "../lib/governance/current-law.ts";
import { loadIndex } from "../lib/governance/ledger.ts";
import { CURRENT_STATUSES } from "../lib/governance/schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Collapse whitespace before matching.
 *
 * Every document checked here is HARD-WRAPPED prose, so a phrase that fits on
 * one line today straddles two the moment a word is added above it. Asserting
 * on raw bytes would make this guard fail on REFLOW — and a guard that goes red
 * when nothing changed is a guard somebody deletes, which is how the rule it
 * protects is eventually lost. Reflowing a paragraph is not weakening a rule.
 * Deleting the sentence is, and that is what stays checked.
 */
const flat = (text: string) => text.replace(/\s+/g, " ");

/**
 * **THE ACQUISITION DOCTRINE MUST NOT BE LOSABLE.**
 *
 * RULING 205-208 were adopted 2026-08-29 from an author directive whose stated
 * purpose was that the author never has to state it again. That purpose is not
 * served by prose. It is served by this file.
 *
 * ## Why a guard is genuinely needed here, and is not ceremony
 *
 * The doctrine lives in THREE places on purpose, and each is lost a different
 * way:
 *
 *   docs/governance/ledger.jsonl   canonical. Lost by an adoption being
 *                                  dropped from `lib/governance/adoptions.ts`,
 *                                  or by a status resolution retiring it.
 *   CLAUDE.md                      what a session reads first. HAND-MAINTAINED.
 *   AGENTS.md                      what a coding agent reads first. Its
 *                                  generated Next block is rewritten by
 *                                  `next dev` on every run.
 *
 * **The compiler cannot catch any of those three.** `governance:compile`
 * deliberately does NOT re-derive constitutional records from the live
 * `CLAUDE.md` — that mirror behaviour was a real defect which silently deleted
 * the transparency mandate and the ladder the moment the constitution was
 * shortened, and it was removed for exactly that reason. The consequence is
 * that today NOTHING reads `CLAUDE.md` back and asks whether the law is still
 * in it. A session could delete the doctrine section and every governance gate
 * would stay green, because deletion is not duplication and the ledger would be
 * untouched.
 *
 * `AGENTS.md` is worse: it is rewritten by a tool this repository does not own.
 * The Next generator replaces only the marked region when the file exists and
 * hosts the block — but if `AGENTS.md` is ever absent when `next dev` runs, the
 * generator writes a bare block AND overwrites `CLAUDE.md` with a 12-byte stub.
 * That has already happened once to this repository.
 *
 * ## What this file therefore asserts
 *
 * 1. the canonical law exists, is CURRENT, and carries author provenance;
 * 2. `CLAUDE.md` still states it, near the top, undiluted;
 * 3. `AGENTS.md` still carries the project-law block as its FIRST
 *    project-owned content, with the generated block intact;
 * 4. the agent mirror has not DRIFTED — every operative claim it makes is a
 *    claim current law also makes.
 *
 * Point 4 is the one that matters most over time. A mirror is only safe while
 * something checks that it is still a mirror.
 */

/**
 * The canonical records, each with a phrase that is load-bearing rather than
 * decorative.
 *
 * The phrase is chosen so that WEAKENING the rule breaks the test, not only
 * deleting it. "Our failure to retrieve it is never that evidence" cannot
 * survive a rewrite that lets a failed fetch count as proof of absence, which
 * is the specific dilution this doctrine exists to refuse.
 */
const CANONICAL = [
  {
    id: "R-0205",
    what: "the record obligation outlives the route and the worker",
    claim: { key: "acquisition.obligation_closure", value: "acquired-evidenced-or-human-route" },
    mustSay: [
      "IF A PUBLIC CIVIC RECORD EXISTS, GET IT",
      "Our failure to retrieve it is never that evidence",
      "Three closes, and there is no fourth",
      "EXHAUSTION IS NOT A DISPOSITION",
    ],
  },
  {
    id: "R-0206",
    what: "the vendor is not the record",
    claim: { key: "acquisition.record_identity", value: "government-record-with-representations" },
    mustSay: [
      "VENDOR != RECORD",
      "A FAILED REPRESENTATION != A MISSING GOVERNMENT RECORD",
      "resolve another representation of the same\nrecord",
    ],
  },
  {
    id: "R-0207",
    what: "one successful route never collapses the source universe",
    claim: { key: "acquisition.representation_coverage", value: "every-material-representation" },
    mustSay: [
      "ONE ROUTE SUCCEEDING DOES NOT CANCEL THE OTHERS",
      "ROUTE PORTFOLIO, not one fetch function",
    ],
  },
  {
    id: "R-0208",
    what: "an access escalation is a parallel lane, never a stop",
    claim: { key: "escalation.access_request", value: "parallel-never-blocking" },
    mustSay: [
      "never stops the record\nobligation",
      "never closes, pauses or satisfies the underlying acquisition obligation",
    ],
  },
] as const;

test("the acquisition doctrine is CURRENT canonical law with author provenance", () => {
  const index = loadIndex();

  for (const rule of CANONICAL) {
    const r = index.resolve(rule.id);
    assert.ok(r, `${rule.id} (${rule.what}) is gone from the canonical ledger entirely`);

    assert.equal(
      r.kind,
      "LAW_DECISION",
      `${rule.id} stopped being law — it is now ${r.kind}, which does not bind`,
    );
    assert.ok(
      CURRENT_STATUSES.includes(r.status),
      `${rule.id} is ${r.status}, so it is no longer current law. ` +
        `Retiring it needs a LATER dated ruling naming it (RULING 99, RULING 176), ` +
        `not a status resolution that quietly drops the doctrine.`,
    );
    /*
     * RULING 174: only author provenance may create binding law. If this ever
     * reads `session_interpretation`, some session has re-authored the
     * doctrine as its own opinion, and it stopped binding at that moment.
     */
    assert.ok(
      r.provenance === "author_explicit" || r.provenance === "author_confirmed",
      `${rule.id} carries provenance ${r.provenance} — an LLM may not hold the author's directive ` +
        `under its own authority (RULING 174)`,
    );
    assert.ok(
      r.operativePolicy,
      `${rule.id} has no operative policy, so its detail files nowhere a session would look`,
    );

    for (const phrase of rule.mustSay) {
      assert.ok(
        flat(r.body).includes(flat(phrase)),
        `${rule.id} no longer says "${phrase}" — the rule was weakened rather than amended. ` +
          `An amendment names what changed and what survives; an edit in place is refused ` +
          `(RULING 99, RULING 176).`,
      );
    }

    const held = r.claims.find((c) => c.key === rule.claim.key);
    assert.ok(held, `${rule.id} stopped answering the slot ${rule.claim.key}`);
    assert.equal(
      held.value,
      rule.claim.value,
      `${rule.id} now answers ${rule.claim.key} with "${held.value}". ` +
        `The refused value is the reading sessions actually arrived at before the doctrine ` +
        `was written down, so a flip here is the defect returning, not a rename.`,
    );
  }
});

/**
 * The mantras, in the author's own shorthand.
 *
 * These are asserted against `CLAUDE.md` and `AGENTS.md` rather than against
 * the ledger, because their job is to be UNMISSABLE to a session that reads
 * only the normal repository instructions. That was the directive's stated
 * invariant: a fresh coding agent must meet the doctrine without being handed
 * the brief that created it.
 */
const MANTRAS = [
  "IT EXISTS = GET IT",
  "VENDOR != RECORD",
  "URL != RECORD",
  "ONE ROUTE SUCCESS",
  "EFFORT != EVIDENCE",
  "EXHAUSTION != DISPOSITION",
  "THE WORKER MAY STOP; THE OBLIGATION DOES NOT",
] as const;

test("CLAUDE.md states the acquisition doctrine, near the top, undiluted", () => {
  const text = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");

  const doctrine = text.indexOf("## The acquisition doctrine");
  assert.ok(
    doctrine > 0,
    "CLAUDE.md has lost the acquisition doctrine section. Nothing in the governance " +
      "compiler would have caught this: it does not re-derive constitutional records from " +
      "the live file, precisely so that shortening the constitution cannot delete law from " +
      "the ledger. The cost of that safety is this guard.",
  );

  /*
   * "Near the top of substantive current law" is checkable rather than
   * atmospheric: the doctrine must precede the cross-cutting rules that
   * inherit from it, and must follow the transparency mandate it is the
   * operative half of.
   */
  const mandate = text.indexOf("## The transparency mandate");
  const nonNegotiables = text.indexOf("## The cross-cutting non-negotiables");
  assert.ok(mandate > 0 && nonNegotiables > 0, "CLAUDE.md's section layout changed shape");
  assert.ok(
    doctrine > mandate,
    "the acquisition doctrine now precedes the transparency mandate it derives from",
  );
  assert.ok(
    doctrine < nonNegotiables,
    "the acquisition doctrine has been pushed below the cross-cutting non-negotiables — " +
      "the rules that inherit from it now read first",
  );

  for (const m of MANTRAS) {
    assert.ok(flat(text).includes(flat(m)), `CLAUDE.md no longer carries the mantra "${m}"`);
  }

  /*
   * The clauses that carry the weight. Deleting a mantra is loud; softening
   * the sentence under it is quiet, and it is how a rule stops meaning what it
   * said while still appearing to say it.
   */
  const UNDILUTED = [
    "no upstream success implies a\ndownstream one",
    "Three closes, and there is no fourth",
    "our failure to retrieve it is never that evidence",
    "PUBLIC RECORD STILL OWED",
    "never skip a materially DISTINCT representation",
    "never closes, pauses or satisfies the obligation the row is\nabout",
  ];
  for (const clause of UNDILUTED) {
    assert.ok(
      flat(text).includes(flat(clause)),
      `CLAUDE.md's acquisition doctrine lost the operative clause "${clause.replace(/\n/g, " ")}" — ` +
        `the section survived but the rule in it did not`,
    );
  }
});

test("AGENTS.md carries the project law as its first project-owned content", () => {
  const text = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

  const end = text.indexOf("<!-- END:nextjs-agent-rules -->");
  assert.ok(
    text.includes("<!-- BEGIN:nextjs-agent-rules -->") && end > 0,
    "AGENTS.md has lost the generated Next block markers. Without them `next dev` stops " +
      "upserting in place and appends a second copy — and if AGENTS.md is ever missing " +
      "entirely when it runs, the generator overwrites CLAUDE.md with a 12-byte stub. " +
      "That has happened to this repository before (tracker R01).",
  );

  const law = text.indexOf("# MEANWHILE — NON-NEGOTIABLE PROJECT LAW");
  assert.ok(law > 0, "AGENTS.md has lost the project-law block");
  assert.ok(law > end, "the project-law block moved INSIDE the generated region and will be erased");

  /*
   * FIRST project-owned content, asserted as "nothing but whitespace between
   * the generated block and the law". An agent that reads the top of the file
   * and stops must still have met the doctrine.
   */
  const between = text.slice(end + "<!-- END:nextjs-agent-rules -->".length, law);
  assert.equal(
    between.trim(),
    "",
    `${JSON.stringify(between.trim().slice(0, 80))} was inserted ahead of the project law — ` +
      `it is no longer the first thing an agent reads after the generated block`,
  );

  for (const m of MANTRAS) {
    assert.ok(
      flat(text).includes(flat(m)),
      `the AGENTS.md mirror no longer carries the mantra "${m}"`,
    );
  }
  for (const extra of ["ROUTE FAILED", "ROUTE BLOCKED", "EXTRACTION FAILED", "NEEDS_SEAN != STOP"]) {
    assert.ok(flat(text).includes(extra), `the AGENTS.md mirror no longer carries "${extra}"`);
  }
});

test("the AGENTS.md mirror has not drifted from current law", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const law = currentLawText(ROOT);

  /*
   * **THE DRIFT CHECK.**
   *
   * A mirror is safe only while something proves it is still a mirror. Two
   * directions, and they fail differently:
   *
   *   mirror says something law does not   -> an agent obeys a rule nobody
   *                                           adopted, believing it is law
   *   law says something the mirror omits  -> an agent misses a rule that
   *                                           binds it
   *
   * Both are checked here on the doctrine's operative vocabulary. This cannot
   * prove semantic identity of two prose documents and does not claim to — it
   * proves that the load-bearing statements travel together, which is the part
   * that actually rots.
   */
  for (const m of MANTRAS) {
    assert.ok(
      flat(law).includes(flat(m)),
      `the AGENTS.md mirror states "${m}" but current law no longer does. ` +
        `The ledger and CLAUDE.md are the authority; a mirror that outlives its source ` +
        `is an agent obeying a rule nobody adopted.`,
    );
    assert.ok(
      flat(agents).includes(flat(m)),
      `current law states "${m}" but the AGENTS.md mirror does not — a coding agent reading ` +
        `only AGENTS.md would never meet it`,
    );
  }

  /*
   * The mirror must say where it is NOT the authority. Without this line an
   * agent that finds a disagreement has no rule for resolving it, and the
   * convenient reading — "the file I already have open wins" — is the wrong
   * one every time.
   */
  assert.match(
    flat(agents),
    /the ledger wins/i,
    "the AGENTS.md mirror no longer defers to the canonical ledger, so a drift between " +
      "them has no stated resolution",
  );
  assert.ok(
    agents.includes("docs/governance/ledger.jsonl"),
    "the AGENTS.md mirror no longer names the canonical store it mirrors",
  );
  for (const rule of CANONICAL) {
    const n = rule.id.replace("R-0", "").replace(/^0+/, "");
    assert.ok(
      agents.includes(`RULING ${n}`) || agents.includes(`${n},`) || agents.includes(`${n}, `),
      `the AGENTS.md mirror no longer cites RULING ${n} (${rule.what}), so an agent cannot ` +
        `reach the canonical text from it`,
    );
  }
});

test("a session cannot satisfy the doctrine by opening a tracker row", () => {
  /*
   * The directive names this failure by name, and it is the one a capable
   * session is most likely to commit: the work is real, large and executable,
   * so it gets WRITTEN DOWN instead of done, and the row is then reported as
   * progress.
   *
   * `CLAUDE.md` already carried "A tracker row is a record of work, never a
   * substitute for it" under the engineering-organization rules. The doctrine
   * needs it too, because the row is exactly what a blocked route tempts a
   * session into producing INSTEAD of another route.
   */
  const law = currentLawText(ROOT);
  assert.match(
    flat(law),
    /a tracker row is a record of work, never a substitute for it/i,
    "current law lost the rule that a tracker row is not work completion",
  );
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  assert.match(
    flat(agents),
    /a tracker row is a record of work, never a substitute for it/i,
    "the AGENTS.md mirror lost the rule that a tracker row is not work completion",
  );
});
