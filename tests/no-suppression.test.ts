import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **RULING 26 AND RULING 27 (Prompt D item 1, 2026-08-20) — THE GUARD.**
 *
 * RULING 26: everything the product holds about a candidate renders.
 * Collection state never governs display. There is no threshold, no
 * completeness bar, no equality condition, and no circumstance under which a
 * candidate, a contest or a field is suppressed because something else is
 * missing. A gap in one field has no bearing on any other field, on that
 * candidate's other data, on the other candidates in the contest, or on
 * whether the contest appears at all.
 *
 * RULING 27: **no suppression path may exist in the codebase.** Not live, not
 * behind a flag, not disabled, not retained for a future feature, not as a
 * guard, not commented out as a reference implementation. This test fails the
 * build if one is reintroduced, which is the point — the previous two versions
 * of the gate were each discovered by the author opening the site and finding
 * a blank ballot.
 *
 * RULING 28: absence is ONE buried annotation per contest. A field with no
 * data renders nothing, and hunt-queue vocabulary never reaches a reader.
 *
 * ## Why the sweep is a filesystem walk and not a grep
 *
 * `git grep` skips nothing, but it is not available to a test that has to run
 * on a checkout with no git. ripgrep skips a file with a NUL byte and skips
 * hidden paths, and both of those failures report NOTHING FOUND without having
 * looked — which is exactly the shape this repo has been bitten by twice. So
 * the walk below enumerates every file itself, reads the bytes, and counts
 * what it read: `assert.ok(scanned > N)` is the operation-count rule applied
 * to the guard's own instrument.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories that hold code a reader's page is built from. */
const RENDER_ROOTS = ["app", "components"];
/** Everything the sweep for a suppression PATH covers. */
const CODE_ROOTS = ["app", "components", "lib", "scripts", "tests"];

const CODE_EXT = /\.(ts|tsx|mts|mjs|js|jsx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "fixtures"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry)) out.push(full);
  }
  return out;
}

function filesUnder(roots: string[]): string[] {
  return roots.flatMap((r) => walk(join(ROOT, r)));
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

/**
 * The file's content with comments removed.
 *
 * Deliberately line-oriented and deliberately crude: this repo's comments are
 * doc blocks whose continuation lines start with `*`, and the only thing that
 * matters is that a sentence ABOUT a dead rule in a comment is not mistaken
 * for a sentence a reader sees. The symbol sweep below reads the RAW bytes, so
 * a suppression path hidden in a comment is still caught — this narrower read
 * exists only for the reader-facing vocabulary check.
 */
function withoutComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("//")) continue;
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("*")) continue;
    out.push(line);
  }
  return out.join("\n");
}

/* ========================================================================== */
/* 1. No suppression path exists — live, flagged, disabled or commented out   */
/* ========================================================================== */

/**
 * The identifiers and markers that only a suppression path has a reason to
 * carry. Prompt B's strict-equality implementation and Prompt C's
 * hunt-completion implementation shared all of these, so a third attempt built
 * from either would trip here on its first commit.
 */
const SUPPRESSION_SYMBOLS = [
  "equalDepthGate",
  "EqualDepthDecision",
  "CandidateDepth",
  "UnhuntedCandidate",
  "unhuntedFieldsOf",
  "data-equal-depth",
  "equal-depth",
  "EqualDepth",
  "verifiedAbsent",
  "VERIFIED_ABSENT_WORDING",
  "KELLY_FIELD_LABEL",
];

/*
 * **WHY `THIN_CANDIDATE_LINE` IS NOT ON THAT LIST** (RULING 42, Prompt E item
 * 3, 2026-08-20), recorded so the next reader does not add it and then delete
 * the guard when it fails.
 *
 * The sweep above reads RAW BYTES, deliberately: a suppression path commented
 * out as a reference implementation is still a suppression path, and stripping
 * comments would hide exactly that. But RULING 42's deletion is different in
 * kind. Four files carry a NOTE saying the constant was deleted and why —
 * `lib/ballot/candidate-cards.ts` where it lived, the card that rendered it,
 * the page that replaced it, and the frozen field matrix that cited it. Those
 * notes are the record of the decision, and a byte sweep cannot tell a record
 * of a deletion from the deletion coming undone.
 *
 * So RULING 42 is guarded where the distinction is structural instead:
 *   - `tests/candidate-cards.test.ts` asserts the module EXPORTS neither
 *     symbol, the card IMPORTS and CALLS neither, and the page-level
 *     disclosure is declared once and rendered once.
 *   - the reader-vocabulary sweep below (comments stripped) bans the
 *     SENTENCE, which is the thing a reader would actually meet.
 *   - `pnpm walk:all` fails on the live deploy if either half comes undone.
 *
 * Three guards on the structure beat one guard on the spelling.
 */

/**
 * **DOCUMENTS ARE SWEPT TOO** (Prompt E item 1, 2026-08-20).
 *
 * RULING 27 says no suppression path may exist in the CODEBASE, and the
 * codebase is not only its `.ts` files. Both dead gates were SPECIFIED in a
 * document before either was written, and a spec is how the third one arrives:
 * a session reads a doc that still describes the gate as the plan and builds
 * what it read.
 *
 * The files below are exempt, by name, because their JOB is to hold the record
 * of what was removed — a guard that bans the historical account of the thing
 * it bans erases the reason anybody knows not to rebuild it. Everything else
 * under `docs/`, and every markdown file at the root, is swept.
 */
const DOC_ROOTS = ["docs"];
const DOC_EXT = /\.(md|csv|json|txt)$/;
const RECORD_FILES = new Set([
  "CLAUDE.md",
  "docs/rulings.md",
  "docs/state.md",
  "docs/tracker.csv",
  "docs/tracker-working.csv",
  "docs/tracker-resolved.csv",
  "docs/deferred.csv",
  "docs/log.md",
  // Derived from git diffs of CLAUDE.md and docs/rulings.md themselves, so by
  // construction it quotes the headings of rules that were removed. A guard
  // that banned the record of a deletion would erase the reason anybody knows
  // not to rebuild the thing.
  "docs/amendment-history.md",
  /*
   * RULING 108 (2026-08-23) put the orientation file in the repo, where a
   * session can read it. It is GENERATED from `CLAUDE.md`, `docs/rulings.md`
   * and `docs/tracker.csv` — every one of which is already exempt directly
   * above — so it quotes their historical account of the removed gate by
   * construction. Scanning it is scanning the same text a second time, and the
   * text that matters is still swept at its source. This exemption adds no
   * unscanned prose to the repo.
   */
  "docs/context.md",
]);

/** The sentences the two dead gates were specified in, before any code. */
const DEAD_DOCTRINE = [
  "same depth",
  "none of them ship",
  "equal depth",
  "until every candidate",
  "thumb on the scale",
];

function docsUnder(): string[] {
  const out: string[] = [];
  for (const root of DOC_ROOTS) {
    const stack = [join(ROOT, root)];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) stack.push(full);
        else if (DOC_EXT.test(entry)) out.push(full);
      }
    }
  }
  for (const entry of readdirSync(ROOT)) {
    if (/\.md$/.test(entry)) out.push(join(ROOT, entry));
  }
  return out;
}

test("RULING 27: no suppression path exists anywhere in the codebase", () => {
  const files = filesUnder(CODE_ROOTS);
  const hits: string[] = [];
  for (const f of files) {
    // This file is the only place the dead vocabulary is allowed to appear:
    // it is the list of what must never come back, and a guard that cannot
    // name what it bans cannot ban it.
    if (rel(f) === "tests/no-suppression.test.ts") continue;
    const src = readFileSync(f, "utf8");
    for (const sym of SUPPRESSION_SYMBOLS) {
      if (src.includes(sym)) hits.push(`${rel(f)} — ${sym}`);
    }
  }
  assert.ok(
    files.length > 300,
    `the sweep read ${files.length} files — a walk that read almost nothing ` +
      "must not read as a sweep that found nothing",
  );

  const docs = docsUnder();
  let docsRead = 0;
  for (const f of docs) {
    if (RECORD_FILES.has(rel(f))) continue;
    docsRead += 1;
    const src = readFileSync(f, "utf8");
    for (const sym of SUPPRESSION_SYMBOLS) {
      if (src.includes(sym)) hits.push(`${rel(f)} — ${sym}`);
    }
    // The prose form. A gate is specified in sentences long before it is
    // specified in identifiers, and these are the sentences both dead
    // versions were specified in.
    for (const phrase of DEAD_DOCTRINE) {
      if (src.toLowerCase().includes(phrase)) hits.push(`${rel(f)} — "${phrase}"`);
    }
  }
  assert.ok(
    docsRead > 20,
    `the document sweep read ${docsRead} files — a walk that read almost ` +
      "nothing must not read as a sweep that found nothing",
  );

  assert.deepEqual(
    hits,
    [],
    "RULING 27 — a suppression path may not exist live, behind a flag, " +
      "disabled, retained for a future feature, commented out as a " +
      "reference implementation, or written down as a plan",
  );
});

/* ========================================================================== */
/* 2. No render path reads a collection-state value                           */
/* ========================================================================== */

/**
 * RULING 23 keeps the four-state field as DATA — the work queue `HD01`–`HD30`
 * were sized against. Nothing reads it to decide what renders, and the
 * cheapest way to hold that line is structural: a page or a component may not
 * import the module at all. A rule enforced by an import graph cannot be
 * forgotten halfway through a refactor the way a conditional can.
 */
test("RULING 23: no page or component imports the hunt-state work queue", () => {
  const hits: string[] = [];
  for (const f of filesUnder(RENDER_ROOTS)) {
    const src = readFileSync(f, "utf8");
    if (/from\s+["'][^"']*ballot\/hunt-state(-server)?["']/.test(src)) {
      hits.push(rel(f));
    }
  }
  assert.deepEqual(
    hits,
    [],
    "collection state never governs display — a render path that can read " +
      "the work queue is one edit away from gating on it",
  );
});

/* ========================================================================== */
/* 3. Hunt-queue vocabulary never reaches a reader                            */
/* ========================================================================== */

/**
 * RULING 28's last bullet. `NOT_HUNTED`, `VERIFIED_ABSENT`, `NOT_APPLICABLE`
 * and the "still looking for" construction are internal states. They live in
 * the tracker and in session reports — never on a card, in a header, or in a
 * tooltip. Comments are stripped first: a comment explaining that a state
 * exists is not a state rendered to anybody.
 */
const READER_BANNED = [
  "NOT_HUNTED",
  "VERIFIED_ABSENT",
  "NOT_APPLICABLE",
  "NOT_ATTEMPTED",
  "NO_SOURCE_FOUND",
  "still looking for",
  // RULING 42 (Prompt E item 3, 2026-08-20). The exact sentence the deleted
  // per-card marker rendered. Comments are stripped before this sweep runs,
  // so the notes recording the deletion may quote it and nothing a reader
  // meets may contain it.
  "found much about this candidate",
];

test("RULING 28: no internal state vocabulary appears in a render path", () => {
  const hits: string[] = [];
  let scanned = 0;
  for (const f of filesUnder(RENDER_ROOTS)) {
    scanned += 1;
    const src = withoutComments(readFileSync(f, "utf8"));
    for (const word of READER_BANNED) {
      if (src.includes(word)) hits.push(`${rel(f)} — ${word}`);
    }
  }
  assert.ok(scanned > 50, `scanned ${scanned} render files`);
  assert.deepEqual(
    hits,
    [],
    "hunt-queue vocabulary is internal — it never renders to a reader",
  );
});

/* ========================================================================== */
/* 4. Every candidate in a contest reaches a card                             */
/* ========================================================================== */

/**
 * The behaviour RULING 26 actually buys, asserted where it is decided: the
 * ballot page maps the contest's candidate list straight onto cards. A
 * `.filter(` anywhere in that expression would be a suppression path wearing a
 * different name, and it would not trip the symbol sweep above.
 *
 * The two branches are the certified lineup and the filing list, and both are
 * checked, because the defect that produced this rule shipped in both.
 */
test("RULING 26: both ballot branches map every candidate onto a card", () => {
  const src = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
  const branches = [
    "photosFirst(lineup.nominees,",
    "photosFirst(candidatesOf(set, contest),",
  ];
  for (const opener of branches) {
    const at = src.indexOf(opener);
    assert.ok(at >= 0, `the ballot page still maps a whole candidate list: ${opener}`);
    // From the opener to the `.map(` that turns the list into cards. A
    // `.filter(` inside that span would suppress candidates from a contest the
    // page is already rendering, and it would not trip the symbol sweep above.
    const mapAt = src.indexOf(").map(", at);
    assert.ok(mapAt > at, `${opener} still ends in a .map( onto cards`);
    assert.ok(
      !src.slice(at, mapAt).includes(".filter("),
      `a filter inside ${opener} would suppress candidates from a rendered contest`,
    );
  }
});

/* ========================================================================== */
/* 5. The one disclosure RULING 28 allows, and only that one                  */
/* ========================================================================== */

test("RULING 28: the contest annotation is one asterisk and one footnote", () => {
  /*
   * Read as SOURCE rather than imported. `pnpm test` runs node's own runner
   * with the alias loader, which resolves `@/` but does not compile JSX — a
   * `.tsx` import here fails with ERR_UNKNOWN_FILE_EXTENSION, and a guard that
   * cannot run is not a guard.
   */
  const noteSrc = readFileSync(
    join(ROOT, "components", "ballot", "incumbency-note.tsx"),
    "utf8",
  );
  const declared = /export const INCUMBENCY_FOOTNOTE =\s*"([^"]+)";/.exec(noteSrc);
  assert.ok(declared, "the footnote sentence is declared in one place");
  const INCUMBENCY_FOOTNOTE = declared![1]!;

  assert.ok(
    INCUMBENCY_FOOTNOTE.length > 40,
    "the footnote says what it means rather than gesturing at it",
  );
  assert.equal(
    INCUMBENCY_FOOTNOTE.split(".").filter((s) => s.trim()).length,
    1,
    "one sentence",
  );
  for (const banned of READER_BANNED) {
    assert.ok(
      !INCUMBENCY_FOOTNOTE.includes(banned),
      `the footnote carries no internal vocabulary (${banned})`,
    );
  }

  const page = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8");
  assert.equal(
    [...page.matchAll(/<IncumbencyMarker \/>/g)].length,
    1,
    "one marker construction, on the contest heading, shared by both branches",
  );
  assert.equal(
    [...page.matchAll(/<IncumbencyFootnote \/>/g)].length,
    2,
    "one footnote per candidate branch — the lineup and the filing list",
  );
});

/* ========================================================================== */
/* 6. No per-card completeness statement, BY MEANING rather than by spelling  */
/* ========================================================================== */

/**
 * **RULING 44's guard, widened after it failed** (item 2.2, 2026-08-20).
 *
 * RULING 42 deleted `THIN_CANDIDATE_LINE` and the guard above was written to
 * make sure it stayed deleted — by banning the string it rendered. In the same
 * session the product shipped a semantically identical sentence with different
 * words (*"We haven't collected anything this candidate has published yet —
 * that's about our research, not about them."*), and the guard was happy,
 * because the guard was matching a spelling. That is `PE01`, and the guard gap
 * is the defect: a rule about MEANING enforced by a list of KNOWN STRINGS is a
 * rule that only catches the instance already found.
 *
 * ## The method
 *
 * Every string literal in a per-card render surface is pulled out and read as
 * a sentence, comments stripped. A sentence is a completeness statement when
 * three things co-occur in it:
 *
 *   1. **a subject that is us or this record** — we, our, this candidate, this
 *      card, so far, yet;
 *   2. **an absence polarity** — haven't, no, nothing, none, missing, few,
 *      little, thin, sparse, empty, still, not yet;
 *   3. **a coverage object** — collected, found, information, detail, data,
 *      record, published, research, words, profile, material, source.
 *
 * That is the concept, not a phrasing of it, so a rewrite that means the same
 * thing trips it. The second matcher is the digit form RULING 47 named: an
 * interpolated value inside a sentence about issues, coverage or absence — the
 * banned statement compressed.
 *
 * ## What it will still miss, stated rather than implied
 *
 * A semantic guard has false negatives and this one has four kinds:
 *
 * - **Assembled sentences.** It reads literals in these files. A sentence
 *   built from fragments, held in a data file, returned by a helper in `lib/`
 *   or received as a prop from somewhere else is invisible to it. `PE01`
 *   itself lived in `lib/candidates/positions.ts`, which is why `LIB_SURFACES`
 *   below is swept too — but only the modules named there.
 * - **Vocabulary it does not know.** "Their entry is light on specifics"
 *   carries none of the three lexicons and passes. English has more ways to
 *   say this than a list can hold.
 * - **Non-sentence markers.** A dimmed style, an icon, a shorter card, an
 *   ordering. RULING 44 bans those too and this guard cannot see them; the
 *   structural guards in `tests/candidate-cards.test.ts` and the live walk are
 *   what cover that half.
 * - **Context.** It cannot tell a statement about a CANDIDATE's record from
 *   one about a MEETING's agenda, so a legitimate line in these files must be
 *   exempted BY NAME with a reason. That list is short on purpose: it is the
 *   honest ledger of what this guard decided not to look at.
 */
const CARD_SURFACES = [
  "components/ballot/candidate-card.tsx",
  "components/ballot/candidate-positions.tsx",
  "components/ballot/candidate-battlecard.tsx",
  "components/ballot/incumbency-note.tsx",
  "app/ballot/page.tsx",
];

/** Modules that BUILD the sentences those surfaces render. `PE01` lived here. */
const LIB_SURFACES = [
  "lib/ballot/candidate-cards.ts",
  "lib/candidates/positions.ts",
];

const SUBJECT_SELF =
  /\b(we|we'?ve|we'?re|our|us|this candidate'?s? (record|entry|card|page)|so far|yet)\b/i;
const ABSENCE =
  /\b(haven'?t|have not|hasn'?t|has not|didn'?t|did not|don'?t|do not|no|none|nothing|not|never|missing|few|little|thin|sparse|empty|blank|unknown|unavailable|absent|lack(s|ing)?|still|incomplete|partial)\b/i;
const COVERAGE =
  /\b(collect(ed|ing)?|found|find|information|info|detail(s)?|data|record(s|ed)?|publish(ed)?|research|words|profile|material|content|source(s)?|coverage|issues?)\b/i;

/** Strings in those files that are NOT completeness statements, with why. */
const CARD_STRING_EXEMPT = new Map<string, string>([
  [
    "the body hasn't published a join link",
    "a fact about a MEETING's notice, not about our coverage of a candidate",
  ],
]);

/** Pull every single- double- and back-quoted literal out of a source file. */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\\n]|\\.)*"|'([^'\\\n]|\\.)*'|`([^`\\]|\\.)*`/g;
  for (const m of src.match(re) ?? []) {
    const body = m.slice(1, -1);
    // Not prose: class lists, selectors, urls, identifiers, css.
    if (!/\s/.test(body)) continue;
    if (/^[a-z0-9 :_\-[\]().%/#*+,>~]+$/.test(body) && !/[A-Z]/.test(body)) {
      // Tailwind class strings and selectors are all lowercase with no
      // sentence punctuation. A real sentence has a capital or an apostrophe.
      if (!/['’.!?]/.test(body)) continue;
    }
    out.push(body);
  }
  return out;
}

test("RULING 44: no per-card completeness statement, by meaning", () => {
  const hits: string[] = [];
  let scanned = 0;
  let sentences = 0;

  for (const relPath of [...CARD_SURFACES, ...LIB_SURFACES]) {
    const full = join(ROOT, ...relPath.split("/"));
    scanned += 1;
    const src = withoutComments(readFileSync(full, "utf8"));
    for (const raw of stringLiterals(src)) {
      // A JSX-interpolated sentence arrives in pieces; judge the piece.
      const s = raw.replace(/\s+/g, " ").trim();
      if (s.length < 12) continue;
      sentences += 1;
      if ([...CARD_STRING_EXEMPT.keys()].some((k) => s.includes(k))) continue;

      const meaningful =
        SUBJECT_SELF.test(s) && ABSENCE.test(s) && COVERAGE.test(s);
      /*
       * The digit form (RULING 47): an interpolated value inside a sentence
       * about coverage. `found` is deliberately NOT in this lexicon — it
       * matched "Your ballot, with sources: found via ${PRODUCT_NAME}", which
       * is a provenance line and not a measurement. The pattern is a count
       * ABOUT the record, so the words that qualify it are the counting ones.
       */
      const counted =
        /\$\{/.test(s) &&
        /\b(issues?|of the|mention(s|ed)?|collect(ed)?|missing|nothing|so far)\b/i.test(
          s,
        );

      if (meaningful || counted) {
        hits.push(`${relPath} — "${s.slice(0, 110)}"`);
      }
    }
  }

  assert.equal(scanned, CARD_SURFACES.length + LIB_SURFACES.length);
  assert.ok(
    sentences > 30,
    `only ${sentences} candidate sentences read — a sweep that read almost ` +
      "nothing must not read as a sweep that found nothing",
  );
  assert.deepEqual(
    hits,
    [],
    "RULING 44 — a card may not state, count, mark or imply what is missing " +
      "from it, in ANY wording. The one disclosure is page-level.",
  );
});

/**
 * **The guard proves it is not vacuous.** A sweep that finds nothing is
 * indistinguishable from a sweep that looks for nothing, and the guard this
 * one replaces was exactly that: it passed while the sentence it was written
 * for was on the live site in different words.
 *
 * So the matcher is run against the sentences the product has actually
 * shipped — the deleted `THIN_CANDIDATE_LINE`, the `PE01` sentence, the
 * `positionsAnnotation` count, and three rewrites nobody has written yet —
 * and every one of them must be caught. The negatives are real lines from the
 * same surfaces that must NOT be caught, because a guard that flags the whole
 * page is a guard somebody turns off.
 */
test("RULING 44: the meaning matcher catches the sentences that shipped", () => {
  const judge = (s: string) =>
    (SUBJECT_SELF.test(s) && ABSENCE.test(s) && COVERAGE.test(s)) ||
    (/\$\{/.test(s) &&
      /\b(issues?|of the|mention(s|ed)?|collect(ed)?|missing|nothing|so far)\b/i.test(
        s,
      ));

  const mustCatch = [
    // RULING 42's deleted line, verbatim.
    "We haven't found much about this candidate yet.",
    // PE01, verbatim — the one the old guard missed.
    "We haven't collected anything this candidate has published yet — that's about our research, not about them. Their battlecard has the detail.",
    // RULING 47's count, in its template form.
    "Their own pages mention ${issuesWithPassages} of the ${issuesSearched} issues we check for every candidate in this contest.",
    // The buried enumeration's summary.
    "Which ${searchedEmpty.length} we found nothing on",
    // Rewrites nobody has shipped, which is the point of a meaning matcher.
    "We have no information for this candidate so far.",
    "Nothing has been collected for this candidate yet.",
    "Our research on this candidate is still incomplete.",
  ];
  const mustPass = [
    "What we have found, we are displaying here.",
    "An incumbent is likely to have more information available here than the people running against them.",
    "Passages below are this candidate's own words, from the pages named under each one.",
    "Your ballot, with sources: found via ${PRODUCT_NAME}.",
  ];

  assert.deepEqual(
    mustCatch.filter((s) => !judge(s)),
    [],
    "the matcher would let a shipped completeness statement through",
  );
  assert.deepEqual(
    mustPass.filter((s) => judge(s)),
    [],
    "the matcher flags a line that is not a completeness statement",
  );
});
