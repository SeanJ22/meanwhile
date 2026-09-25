import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadIndex } from "../lib/governance/ledger.ts";
import { CURRENT_STATUSES, type SemanticClaim } from "../lib/governance/schema.ts";

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
 * 2. `docs/rulings.md` §2 still states it, near the top, undiluted (Sean's
 *    adopted wording since 2026-09-25), and `CLAUDE.md` applies it;
 * 3. `AGENTS.md` still carries the project-law block as its FIRST
 *    project-owned content, with the generated block intact;
 * 4. the agent mirror has not DRIFTED — every rulings section the working
 *    guide applies exists, and the mirror carries the same references.
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
// After the 2026-09-03 consolidation the doctrine is RULING 248 (which absorbed
// R-0205/0206/0207 and the transparency mandate) plus RULING 271 for the
// escalation lane (which absorbed R-0208). The obligations and the semantic
// claims travelled to the successors; this guard asserts the successors carry
// them undiluted, verbatim from their new bodies.
const CANONICAL = [
  {
    id: "R-0248",
    what: "if a public record exists, get it — the obligation outlives the route",
    claims: [
      { key: "acquisition.obligation_closure", value: "acquired-evidenced-or-human-route" },
      { key: "acquisition.record_identity", value: "government-record-with-representations" },
      { key: "acquisition.representation_coverage", value: "every-material-representation" },
    ],
    mustSay: [
      "no upstream success implies a downstream one",
      "Three closes, and no fourth",
      "our failure to retrieve is never that evidence",
      "The vendor is not the record",
      "One successful route never collapses the source universe",
    ],
  },
  {
    id: "R-0271",
    what: "an access escalation is a parallel lane, never a stop",
    claims: [{ key: "escalation.access_request", value: "parallel-never-blocking" }],
    mustSay: [
      "An access escalation is a parallel lane, never a stop",
      "never closes, pauses or satisfies the obligation the row is about",
    ],
  },
];

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

    for (const claim of rule.claims) {
      const held: SemanticClaim | undefined = r.claims.find((c) => c.key === claim.key);
      assert.ok(held, `${rule.id} stopped answering the slot ${claim.key}`);
      assert.equal(
        held.value,
        claim.value,
        `${rule.id} now answers ${claim.key} with "${held.value}". ` +
          `The refused value is the reading sessions actually arrived at before the doctrine ` +
          `was written down, so a flip here is the defect returning, not a rename.`,
      );
    }
  }
});

/**
 * The doctrine, in the words Sean adopted on 2026-09-25.
 *
 * Until that date these were the mantras in the author's shorthand ("IT
 * EXISTS = GET IT", "VENDOR != RECORD", ...), asserted against the old root
 * constitution. Sean then adopted `docs/rulings.md` as the single source for
 * his standing decisions, and its §2 carries the doctrine in plain words;
 * `CLAUDE.md` and `AGENTS.md` send every agent there. The job is unchanged:
 * the doctrine must be UNMISSABLE to a session that reads only the normal
 * repository instructions.
 */
const DOCTRINE = [
  "Find a way to get the information, parse it, verify it, and push it to readers.",
  "Finding a link or knowing information exists is not completion.",
  "A failed route does not end the obligation.",
  "A healthy feed does not prove complete coverage.",
  "One failed step does not establish that the information is unavailable.",
  "“Not found in the sources checked” must not become “does not exist.”",
] as const;

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("docs/rulings.md states the acquisition doctrine, near the top, undiluted, and CLAUDE.md applies it", () => {
  const rulings = read("docs/rulings.md");

  /*
   * Near the top: §2 follows only the section that sets the direction, and
   * precedes the publishing and coverage rules that inherit from it.
   */
  const doctrine = rulings.indexOf("## 2. Get the public information to readers");
  const next = rulings.indexOf("## 3. ");
  assert.ok(doctrine > 0 && next > doctrine, "docs/rulings.md's section layout changed shape");

  /*
   * The clauses that carry the weight. Deleting a section is loud; softening
   * the sentence in it is quiet, and it is how a rule stops meaning what it
   * said while still appearing to say it.
   */
  const section = flat(rulings.slice(doctrine, next));
  for (const clause of DOCTRINE) {
    assert.ok(
      section.includes(flat(clause)),
      `docs/rulings.md §2 lost the operative clause "${clause}" — the section survived but the rule in it did not`,
    );
  }

  assert.match(flat(read("CLAUDE.md")), /Apply rulings §2–4 and §7/, "CLAUDE.md no longer applies rulings §2");
});

test("AGENTS.md carries the project law as its first project-owned content", () => {
  const text = read("AGENTS.md");

  const end = text.indexOf("<!-- END:nextjs-agent-rules -->");
  assert.ok(
    text.includes("<!-- BEGIN:nextjs-agent-rules -->") && end > 0,
    "AGENTS.md has lost the generated Next block markers. Without them `next dev` stops " +
      "upserting in place and appends a second copy — and if AGENTS.md is ever missing " +
      "entirely when it runs, the generator overwrites CLAUDE.md with a 12-byte stub. " +
      "That has happened to this repository before (tracker R01).",
  );

  const law = text.indexOf("# MEANWHILE — INSTRUCTIONS FOR CODEX AND EVERY CODING AGENT");
  assert.ok(law > 0, "AGENTS.md has lost the project-instructions block");
  assert.ok(law > end, "the project-instructions block moved INSIDE the generated region and will be erased");

  /*
   * FIRST project-owned content, asserted as "nothing but whitespace between
   * the generated block and the instructions". An agent that reads the top of
   * the file and stops must still have been sent to Sean's standing decisions.
   */
  const between = text.slice(end + "<!-- END:nextjs-agent-rules -->".length, law);
  assert.equal(
    between.trim(),
    "",
    `${JSON.stringify(between.trim().slice(0, 80))} was inserted ahead of the project instructions — ` +
      `it is no longer the first thing an agent reads after the generated block`,
  );

  const head = flat(text.slice(law, law + 1200));
  assert.match(head, /Sean's standing decisions are `docs\/rulings\.md`/, "AGENTS.md no longer sends Codex to docs/rulings.md first");
  assert.ok(flat(text).includes("Apply rulings §2–4 and §7"), "the AGENTS.md mirror no longer applies rulings §2");
});

test("the AGENTS.md mirror has not drifted from current law", () => {
  const agents = read("AGENTS.md");
  const claude = read("CLAUDE.md");
  const rulings = read("docs/rulings.md");

  /*
   * **THE DRIFT CHECK.**
   *
   * A mirror is safe only while something proves it is still a mirror, and a
   * pointer is safe only while its target exists. So: every rulings section
   * the working guide applies must exist in docs/rulings.md, and the AGENTS.md
   * mirror must carry the same references. This cannot prove semantic
   * identity of two prose documents and does not claim to — it proves that
   * the references an agent follows still land.
   */
  const cited = new Set<number>();
  for (const m of claude.matchAll(/§(\d+)(?:–(\d+))?/g)) {
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    for (let n = from; n <= to; n += 1) cited.add(n);
  }
  assert.ok(cited.size >= 8, `CLAUDE.md cites only ${cited.size} rulings sections — parser drift`);
  for (const n of cited) {
    assert.match(rulings, new RegExp(`^## ${n}\\. `, "m"), `CLAUDE.md applies rulings §${n}, which docs/rulings.md does not have`);
  }
  for (const m of claude.matchAll(/(?:rulings )?§\d+(?:–\d+)?/g)) {
    assert.ok(agents.includes(m[0]), `the AGENTS.md mirror does not carry "${m[0]}"`);
  }

  /*
   * The mirror must say which file wins. Without this line an agent that finds
   * a disagreement has no rule for resolving it, and the convenient reading —
   * "the file I already have open wins" — is the wrong one every time.
   */
  assert.ok(agents.includes("`CLAUDE.md` is right"), "the AGENTS.md mirror no longer defers to CLAUDE.md");
  assert.ok(agents.includes("docs/rulings.md"), "the AGENTS.md mirror no longer names Sean's standing decisions");
});

test("a session cannot satisfy the doctrine by opening a tracker row", () => {
  /*
   * The directive names this failure by name, and it is the one a capable
   * session is most likely to commit: the work is real, large and executable,
   * so it gets WRITTEN DOWN instead of done, and the row is then reported as
   * progress. Sean's adopted wording is rulings §10.
   */
  assert.match(
    flat(read("docs/rulings.md")),
    /A task recorded for later is not completed work/,
    "docs/rulings.md lost the rule that a recorded task is not work completion",
  );
  assert.match(
    flat(read("AGENTS.md")),
    /Apply rulings §10/,
    "the AGENTS.md mirror no longer applies rulings §10",
  );
});
