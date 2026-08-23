/**
 * **A CLASS SWEEP COVERS DUPLICATED IMPLEMENTATIONS, NOT ONLY NAMED
 * INSTANCES** — RULING 103, 2026-08-23.
 *
 * ## The gap in the named-instance rule
 *
 * `CLAUDE.md` already says a named instance is an example of a class-wide
 * defect: fix at the shared code path, sweep the class, state count found and
 * count fixed. That rule has caught real things and it has one blind spot, and
 * the blind spot is in its own instruction — **"fix at the SHARED code path"
 * assumes there is one.**
 *
 * Three separate copies of an initials function rendered *Thomas J. Haynes
 * III* as **"TI"**: each took the first letter of the first token and the
 * first letter of the LAST token, and the last token was the generational
 * suffix. Fixing the copy the reader complained about left two copies of the
 * same defect standing. A sweep for the SYMPTOM — grep for `TI`, grep for the
 * card that showed it — cannot find a second and third implementation of the
 * same logic, because they are not the same text and they may not even use the
 * same variable names.
 *
 * So the sweep predicate is BOTH: every surface showing the named symptom, and
 * every duplicate implementation of the code path.
 *
 * ## Two hashes, because a rename is still a copy
 *
 * - **exact** — comments and whitespace stripped. Catches copy-paste.
 * - **shape** — every identifier additionally replaced by a placeholder, so
 *   `initials(name)`, `initialsOf(who)` and `initialsFor(person)` with
 *   identical logic collide. Keywords, operators, punctuation and literals
 *   survive, so the structure is what is being compared.
 *
 * The shape hash is the one that would have found the initials family. It also
 * produces genuine collisions on trivial bodies — two one-line getters have the
 * same shape and are not duplicates in any meaningful sense — which is why
 * there is a minimum size and an allowlist that demands a REASON per entry.
 *
 * ## What an allowlist entry means
 *
 * "These two really are separate implementations and here is why." Not "this
 * one is fine". An entry with no reason fails, exactly as an impure generator
 * with no stated impurity fails: the why is the finding, not a shrug.
 */

/** One function-shaped declaration found in a file. */
export interface Implementation {
  file: string;
  name: string;
  line: number;
  /** Normalised body: comments and whitespace gone. */
  exact: string;
  /** Normalised body with identifiers replaced. Catches a rename. */
  shape: string;
  /** Length of the normalised body, for the size threshold and the report. */
  size: number;
}

export interface DuplicateGroup {
  kind: "exact" | "shape";
  /** The hash they share. */
  key: string;
  members: Implementation[];
}

/*
 * The stripper is LENGTH-PRESERVING and NEWLINE-PRESERVING, which is not a
 * detail: the scan runs over the stripped text and reports line numbers, and
 * the first version reported lines that did not exist in the file. A finding
 * pointing at the wrong line is a finding nobody can act on.
 *
 * Known limit, stated: a regex literal containing `//` is treated as a
 * comment. No such literal exists in this tree today and the scan would only
 * under-report if one appeared, which is the safe direction — but it is a
 * limit rather than a guarantee.
 */

/**
 * Words that are STRUCTURE rather than naming. Kept verbatim in the shape
 * hash, because replacing them would make every block look like every other.
 */
const KEYWORDS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "default",
  "delete", "do", "else", "export", "extends", "false", "finally", "for",
  "function", "if", "in", "instanceof", "let", "new", "null", "of", "return",
  "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var",
  "void", "while", "yield", "undefined", "as", "satisfies", "keyof", "readonly",
]);

export function stripComments(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    // A string or template literal: skipped whole, and KEPT — its content is
    // part of what makes two bodies identical.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = src.length;
      blank(i, end);
      i = end - 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let end = src.indexOf("*/", i + 2);
      end = end === -1 ? src.length : end + 2;
      blank(i, end);
      i = end - 1;
      continue;
    }
  }
  return out.join("");
}

export function normalise(body: string): string {
  return stripComments(body).replace(/\s+/g, " ").trim();
}

export function shapeOf(normalised: string): string {
  return normalised.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (word) =>
    KEYWORDS.has(word) ? word : "_",
  );
}

/**
 * Where a declaration STARTS. Only the head is matched by regex — the
 * parameter list is walked with a paren matcher, because a regex over
 * `\([^)]*\)` loses every function with a destructured parameter, a default
 * value containing `)`, or a multi-line signature.
 *
 * **That was not hypothetical.** The first version of this file scanned 806
 * files and found 241 declarations, which is a sweep reporting nothing found
 * without having looked — the exact failure this repo keeps naming.
 */
const DECLARATION_HEAD =
  /(?:^|\n)[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:(function)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]{0,400})?=\s*(?:(async)\s+)?(?:(function)\b[\w$\s]*)?)/g;

/** Match the closing paren for the `(` at `open`, skipping literals. */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Skip a `<...>` generic parameter list. Returns the index after it, or `at`. */
function skipGenerics(src: string, at: number): number {
  if (src[at] !== "<") return at;
  let depth = 0;
  for (let i = at; i < src.length && i < at + 400; i += 1) {
    if (src[i] === "<") depth += 1;
    else if (src[i] === ">") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    // A generic list never contains these; bail rather than run away.
    else if (src[i] === ";" || src[i] === "{") return at;
  }
  return at;
}

/**
 * Find the matching `}` for the `{` at `open`.
 *
 * String and template literals are skipped so a brace inside one does not
 * close the body early. Comments were already removed by the caller.
 */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every function-shaped declaration in one file, with its normalised body.
 *
 * Comments are stripped from the WHOLE file before scanning, so a declaration
 * that only appears inside a comment (a doc example, a reference
 * implementation) is not counted as an implementation. That is deliberate:
 * RULING 27 already forbids a commented-out reference implementation of a
 * suppression path, and it should not show up here as a duplicate either.
 */
export function implementationsIn(file: string, source: string): Implementation[] {
  const src = stripComments(source);
  const lineAt = (index: number) => src.slice(0, index).split("\n").length;
  const found: Implementation[] = [];
  DECLARATION_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECLARATION_HEAD.exec(src)) !== null) {
    const name = m[2] ?? m[3];
    if (name === undefined) continue;

    // Where the signature begins: just past the name (function form) or past
    // the `=` and any `async`/`function` keyword (assignment form).
    let at = m.index + m[0].length;
    while (at < src.length && /\s/.test(src[at])) at += 1;
    at = skipGenerics(src, at);
    while (at < src.length && /\s/.test(src[at])) at += 1;
    if (src[at] !== "(") continue;

    const closeParen = matchParen(src, at);
    if (closeParen === -1) continue;

    // Past the parameter list: an optional `: ReturnType`, then either `{`
    // (function declaration) or `=> {` (arrow with a block body).
    let after = closeParen + 1;
    const isFunctionForm = m[1] !== undefined || m[5] !== undefined;
    const tail = src.slice(after, after + 500);
    const arrow = /^\s*(?::[^=]{0,300}?)?=>\s*\{/.exec(tail);
    const block = /^\s*(?::[^={]{0,300}?)?\{/.exec(tail);
    if (arrow !== null) after += arrow[0].length - 1;
    else if (isFunctionForm && block !== null) after += block[0].length - 1;
    // An arrow returning an expression rather than a block, an interface, a
    // typed constant. Nothing to compare — skipped, not counted.
    else continue;

    const close = matchBrace(src, after);
    if (close === -1) continue;
    const body = normalise(src.slice(after + 1, close));
    found.push({
      file,
      name,
      line: lineAt(m.index) + 1,
      exact: body,
      shape: shapeOf(body),
      size: body.length,
    });
    /*
     * The scan deliberately does NOT skip past this body. A nested helper is
     * exactly the kind of thing that gets copy-pasted between two big
     * functions in two files, and skipping the body would hide every one of
     * them — the same under-scan that reported 241 declarations across 806
     * files. An outer body and an inner one are different strings, so both
     * being counted is correct rather than double counting.
     */
  }
  return found;
}

/** Anything shorter than this is structure, not an implementation. */
export const MIN_BODY = 120;

/**
 * Group implementations that share a body, ACROSS FILES.
 *
 * Two copies in the same file are a refactor waiting to happen; two copies in
 * different files are the shape that let the initials defect survive its own
 * fix, because a sweep of one file cannot see the other.
 */
export function duplicates(all: Implementation[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const kind of ["exact", "shape"] as const) {
    const byKey = new Map<string, Implementation[]>();
    for (const impl of all) {
      if (impl.size < MIN_BODY) continue;
      const key = impl[kind];
      const list = byKey.get(key);
      if (list === undefined) byKey.set(key, [impl]);
      else list.push(impl);
    }
    for (const [key, members] of byKey) {
      const files = new Set(members.map((m) => m.file));
      if (files.size < 2) continue;
      groups.push({ kind, key, members });
    }
  }
  /*
   * A group that is duplicated EXACTLY is also duplicated in shape. Reporting
   * both would double-count, so a shape group whose members are already an
   * exact group is dropped — the exact finding is the more specific one.
   */
  const exactKeys = new Set(
    groups
      .filter((g) => g.kind === "exact")
      .map((g) => g.members.map((m) => `${m.file}:${m.name}`).sort().join("|")),
  );
  return groups.filter(
    (g) =>
      g.kind === "exact" ||
      !exactKeys.has(g.members.map((m) => `${m.file}:${m.name}`).sort().join("|")),
  );
}

/** A stable id for a group, so an allowlist entry survives a line move. */
export function groupId(group: DuplicateGroup): string {
  return `${group.kind}:${group.members
    .map((m) => `${m.file}#${m.name}`)
    .sort()
    .join(",")}`;
}
