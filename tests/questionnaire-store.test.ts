/**
 * The questionnaire answer page and its store. A candidate's answer is published civic content, so it lands in the
 * content store, asserted by name. Verbatim display is swept by shape (summarising and truncating in the forms they
 * would take), and each shape is shown catching a plant.
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
  /** The stores, named individually rather than counted. */
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
    // No account, no password, no new identifier. Only sha256(token).
    const code = sources.map((s) => stripComments(s.text)).join("\n");
    for (const term of ["reactionKey", "deviceId", "fingerprint", "sessionKey", "subscriberId"]) {
      assert.ok(!new RegExp(`\\b${term}\\b`).test(code), `the questionnaire path mints ${term}`);
    }
  });
});

describe("RULING 112 — verbatim, swept by SHAPE", () => {
  /** The shapes a truncation or a summarisation would take: a call that shortens text. */
  const SHAPES: [string, RegExp][] = [
    /*
     * A slice to a positive length. The negative form is prose assembly (dropping the last list element to build
     * "a, b and c"), not truncation.
     */
    [
      "a slice on answer text to a fixed length",
      // The second argument must start with a digit or an identifier. A negative lookahead does not work: `\s*`
      // backtracks to empty and the lookahead sees the space before `-1`.
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
    // Each shape is shown finding an instance of what it was written for.
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
    // The page says it never shortens anything; that sentence must not be flagged.
    const honest = [
      "Your answers publish exactly as you write them — word for word, with nothing summarised, shortened or edited.",
      "Nothing has been saved and nothing has been cut — please shorten it and send again.",
      "Nothing will be cut for you.",
    // Dropping the last element of a list to build "a, b and c".
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
    // Identifiers and internal keys never render outside a technical-details disclosure.
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
    // Whitespace-normalised: JSX wraps prose at the formatter's column.
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
