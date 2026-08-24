/**
 * The questionnaire answer page and its store.
 *
 * Two things are guarded here and they are different in kind:
 *
 * 1. **The n-stores rule, asserted BY NAME.** A candidate's answer is published
 *    civic content, not reader data, so it lands in the content store — and the
 *    brief for this work asked for that to be asserted by name in a test rather
 *    than left to be noticed.
 * 2. **RULING 112's verbatim clause, swept BY SHAPE (RULING 110).** A search
 *    that returns nothing must show it looked in the right FORM. A shape is the
 *    pattern the thing takes, not the letters it is spelled with, so this sweeps
 *    for summarising and truncating in the forms they would actually appear in —
 *    and the sweep is shown catching a PLANT, because an instrument that cannot
 *    find the defect it was written for is one reporting green about nothing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Every source file on the questionnaire path, read once. */
function questionnaireSources(): { path: string; text: string }[] {
  const roots = [
    join(ROOT, "lib", "questionnaire"),
    join(ROOT, "components", "questionnaire"),
    join(ROOT, "app", "questionnaire"),
    join(ROOT, "app", "api", "questionnaire"),
  ];
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e)) out.push({ path: full, text: readFileSync(full, "utf8") });
    }
  };
  for (const r of roots) walk(r);
  out.push({
    path: join(ROOT, "lib", "db", "questionnaire.ts"),
    text: readFileSync(join(ROOT, "lib", "db", "questionnaire.ts"), "utf8"),
  });
  return out;
}

/** Comments carry the RULES; only executable code can break them. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const sources = questionnaireSources();

describe("the questionnaire store touches no sold store — asserted BY NAME", () => {
  /**
   * The three stores `CLAUDE.md`'s n-stores rule governs, named individually.
   *
   * Named rather than counted, because "no sold store is touched" is unfalsifiable
   * without the list, and the list is what a later reader checks against.
   */
  const SOLD_STORES = ["searchLog", "search_log", "reactions", "intakeLimiter", "intake_limiter"];

  it("names none of the sold stores anywhere on the questionnaire path", () => {
    for (const s of sources) {
      const code = stripComments(s.text);
      for (const store of SOLD_STORES) {
        assert.ok(
          !new RegExp(`\\b${store}\\b`).test(code),
          `${s.path} references ${store}. A candidate's answer is published civic content and may ` +
            "not land in, or join to, a store that is sold.",
        );
      }
    }
  });

  it("imports no sold-store module", () => {
    const banned = [
      "lib/db/search-log",
      "lib/db/reactions",
      "lib/db/intake-limiter",
      "@/lib/db/search-log",
      "@/lib/db/reactions",
      "@/lib/db/intake-limiter",
    ];
    for (const s of sources) {
      for (const mod of banned) {
        assert.ok(!s.text.includes(mod), `${s.path} imports ${mod}`);
      }
    }
  });

  it("creates no new reader identifier", () => {
    // RULING 112: no account, no password, no new identifier. Only sha256(token).
    const code = sources.map((s) => stripComments(s.text)).join("\n");
    for (const term of ["reactionKey", "deviceId", "fingerprint", "sessionKey", "subscriberId"]) {
      assert.ok(!new RegExp(`\\b${term}\\b`).test(code), `the questionnaire path mints ${term}`);
    }
  });
});

describe("RULING 112 — verbatim, swept by SHAPE", () => {
  /**
   * The shapes a truncation or a summarisation would actually take.
   *
   * Not the string "summarize". A shape: *a call that shortens text*, in the
   * forms it appears in this codebase.
   */
  const SHAPES: [string, RegExp][] = [
    /*
     * A slice to a POSITIVE length. The negative form is excluded deliberately.
     *
     * `parts.slice(0, -1)` in `positions-state.ts` drops the last element of a
     * list of dates so the sentence can read "…, … and …". That is prose
     * assembly, not truncation, and the first version of this pattern flagged
     * it — an instrument that flags honest code becomes pressure to delete the
     * honest code, which is RULING 110's other half and the more dangerous one.
     */
    [
      "a slice on answer text to a fixed length",
      // The second argument must actually START with a digit or an identifier.
      // A negative lookahead does not work here: `\s*` backtracks to empty, the
      // lookahead then sees the SPACE before `-1`, and `slice(0, -1)` passes it.
      /\.(slice|substring|substr)\s*\(\s*0\s*,\s*[\d$A-Za-z_]/,
    ],
    ["a maxLength cap on an answer field", /maxLength\s*[=:]/],
    ["a summarise / abstract / excerpt call", /\b(summari[sz]e|abstract|excerpt|condense|paraphrase)\s*\(/i],
    ["a summary field on a response", /\b(summary|excerpt|preview|abstract)\s*:/i],
    ["an ellipsis appended to an answer", /\+\s*["'`]\s*(\.\.\.|…)\s*["'`]/],
    ["a truncate helper", /\btruncat\w*\s*\(/i],
  ];

  it("finds none of those shapes on the questionnaire path", () => {
    for (const s of sources) {
      const code = stripComments(s.text);
      for (const [label, re] of SHAPES) {
        assert.ok(!re.test(code), `${s.path} carries ${label}`);
      }
    }
  });

  it("the sweep CATCHES a plant — otherwise it reports green about nothing", () => {
    // RULING 110's second half, made real: each shape is shown finding an
    // instance of the thing it was written for.
    const plants: [RegExp, string][] = [
      [SHAPES[0][1], "const shown = answer.slice(0, 150);"],
      [SHAPES[1][1], '<textarea maxLength={900} />'],
      [SHAPES[2][1], "const short = summarize(answer);"],
      [SHAPES[3][1], "return { summary: firstSentence(answer) };"],
      [SHAPES[4][1], 'const shown = head + "…";'],
      [SHAPES[5][1], "const shown = truncateWords(answer, 150);"],
    ];
    for (const [re, plant] of plants) {
      assert.ok(re.test(plant), `the sweep does not catch its own plant: ${plant}`);
    }
  });

  it("does not flag the honest copy the page actually ships", () => {
    // The half that is easy to get wrong would delete a rule rather than
    // enforce one: the page SAYS it never shortens anything, and a sweep that
    // flagged that sentence would become pressure to remove it.
    const honest = [
      "Your answers publish exactly as you write them — word for word, with nothing summarised, shortened or edited.",
      "Nothing has been saved and nothing has been cut — please shorten it and send again.",
      "Nothing will be cut for you.",
      // Real code from `positions-state.ts`: dropping the last element of a
      // list to build "a, b and c". Pinned here because the first version of
      // the slice pattern flagged it.
      'return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;',
    ];
    for (const line of honest) {
      for (const [label, re] of SHAPES) {
        assert.ok(!re.test(line), `the honest line "${line.slice(0, 40)}…" is flagged by ${label}`);
      }
    }
  });
});

describe("the answer page speaks plain language", () => {
  it("renders no candidacy id or contest id at a reader", () => {
    // CLAUDE.md: identifiers and internal keys never render outside a
    // technical-details disclosure. The first version of the page printed a
    // candidacy slug at the candidate as their own name.
    const page = readFileSync(join(ROOT, "app", "questionnaire", "[token]", "page.tsx"), "utf8");
    const code = stripComments(page);
    assert.ok(
      !/candidateName=\{[^}]*candidacyId/.test(code),
      "the page passes a candidacy id where a name belongs",
    );
    assert.ok(
      !/officeTitle=\{[^}]*contestId/.test(code),
      "the page passes a contest id where an office title belongs",
    );
  });

  it("keeps the three token refusals apart rather than collapsing them", () => {
    const auth = readFileSync(join(ROOT, "lib", "questionnaire", "auth.ts"), "utf8");
    for (const reason of ["EXPIRED", "ALREADY_USED", "UNKNOWN"]) {
      assert.ok(auth.includes(`case "${reason}"`), `tokenRefusalLine has no branch for ${reason}`);
    }
  });

  it("carries the verbatim promise on the page a candidate actually reads", () => {
    // Whitespace-normalised before matching: JSX wraps prose across lines at
    // whatever column the formatter chose, so a raw regex over the file tests
    // the formatter rather than the copy — and would fail the moment somebody
    // reflowed a paragraph that still said exactly the right thing.
    const form = readFileSync(
      join(ROOT, "components", "questionnaire", "answer-form.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    assert.match(form, /word for word/i);
    assert.match(form, /nothing summarised, shortened or edited/i);
  });
});

describe("nothing on this path sends email", () => {
  it("has no mail transport, because NH108's send decisions are Sean's", () => {
    const code = sources.map((s) => stripComments(s.text)).join("\n");
    for (const shape of [/\bnodemailer\b/, /\bsendgrid\b/i, /\bresend\b/i, /\bsendMail\s*\(/, /\bpostmark\b/i, /\bses\.send/i]) {
      assert.ok(!shape.test(code), `the questionnaire path carries a mail transport: ${shape}`);
    }
  });
});
