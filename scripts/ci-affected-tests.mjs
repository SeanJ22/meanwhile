#!/usr/bin/env node
/**
 * Which test files a pull request's change can reach, decided on a bare
 * checkout before anything is installed.
 *
 * Admission runs this when a ready pull request buys its certification (tier
 * `yes`). It diffs the pull request — the base commit against the checked-out
 * merge commit — and decides:
 *
 *   - A changed code file under lib/ app/ components/ hooks/ scripts/ tests/
 *     (or middleware.ts) selects every test file whose import closure reaches
 *     it: static, side-effect and literal dynamic imports, relative paths and
 *     the tsconfig `@/` alias. A file that names another by file name in its
 *     code (a test reading a script's source, a script spawning another, a
 *     helper importing `moduleUrl("lib/x.ts")`) counts as depending on it. A
 *     changed test file selects itself.
 *   - Tests that sweep source trees themselves (a test file or test helper
 *     that lists directories) are selected whenever any code changes, and so
 *     is any test reaching a module that loads code through a computed
 *     `import(...)` this reader cannot name.
 *   - A change made only of documents (anything under docs/, and Markdown
 *     anywhere outside the code roots: CLAUDE.md, AGENTS.md, README.md, state
 *     notes) selects only the tests that read those documents: a test
 *     whose code names one; a test reaching, through test files only, a module
 *     or script that names one (one hop, so a citation in a widely imported
 *     module does not pull in its whole import tree); a test reaching a module
 *     that names a script that names one (a test spawning the compiler); and
 *     a test or test helper that lists files where the document lives (the
 *     whole repository, the document's top directory, or Markdown). Source
 *     sweeps that list only code are not selected. No reader answers NONE.
 *   - Code mixed with documents keeps the code selection, unchanged: Markdown
 *     under docs/ selects the tests whose code names that document, and any
 *     other document selects the FULL suite.
 *   - ANY other changed file — data, fixtures, package.json, the lockfile,
 *     tsconfig, Next or ESLint config, CSS, workflows, public assets, the test
 *     runner and its loader, an unknown extension — selects the FULL suite.
 *   - Doubt selects the FULL suite: an unreadable diff, a missing base, too
 *     many changed files, or an import inside any test's closure that does not
 *     resolve to a tracked file.
 *
 * Output (GITHUB_OUTPUT and stdout): plan=affected|full|none, scope
 * (documents when the change is documents only, else code), legs (the test
 * matrix as JSON), files (newline-separated, for CI_TEST_FILES) and
 * needs_browser. The scheduled run (and a manual dispatch) always
 * answers full: it re-runs the whole suite on main as the integration check,
 * so a miss here is caught there. A push to main runs no tests.
 *
 * Dependency-free on purpose: it runs before `pnpm install`.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { discoverTests } from "./ci-tests.mjs";

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs", ".jsx", ".cts"];
const CODE_ROOTS = ["lib/", "app/", "components/", "hooks/", "scripts/", "tests/"];
const CODE_FILES = new Set(["middleware.ts"]);

/** Code whose change alters how every test runs, so it always buys the full suite. */
export const RUNNER_FILES = new Set([
  "scripts/ci-tests.mjs",
  "scripts/ci-test-timing-reporter.mjs",
  "scripts/ci-test-scheduling-hints.mjs",
  "scripts/register-test-loader.mjs",
  "scripts/test-alias-loader.mjs",
  "scripts/ci-affected-tests.mjs",
]);

/**
 * Modules that load code by a computed name, with the tree they load from.
 * A computed import not listed here makes its module depend on all code.
 */
export const COMPUTED_IMPORT_REACH = new Map([
  // Installed source adapters, loaded by name from this directory.
  ["lib/control-plane/scheduler/scout-adapters.ts", "lib/sources/platform-adapters/"],
]);

/** Above this many changed files the graph is not worth trusting over the full suite. */
export const MAX_CHANGED_FILES = 400;

/** The test matrix for each plan. Every leg must also be known to lib/ops/required-checks.ts. */
export const TEST_LEGS = Object.freeze({
  affected: ["affected"],
  full: ["1/4", "2/4", "3/4", "4/4"],
  none: [],
});

const BROWSER_PACKAGES = new Set(["playwright", "playwright-core", "@playwright/test"]);

function isCodeFile(path) {
  return CODE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function isCodePath(path) {
  return isCodeFile(path) && (CODE_FILES.has(path) || CODE_ROOTS.some((root) => path.startsWith(root)));
}

export function isDocsMarkdown(path) {
  return path.startsWith("docs/") && path.endsWith(".md");
}

/**
 * A document for the documents-only selection: anything under docs/, or
 * Markdown outside the code roots and public/ (CLAUDE.md, AGENTS.md,
 * README.md, state notes). Markdown under a code root may be a runtime input
 * (a prompt template read by computed path), so it keeps the code rules.
 */
export function isDocumentPath(path) {
  if (path.startsWith("docs/")) return true;
  if (!path.endsWith(".md")) return false;
  return !CODE_ROOTS.some((root) => path.startsWith(root)) && !path.startsWith("public/");
}

const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);

/**
 * The source with every comment and the inside of every string, template and
 * regular expression blanked to spaces (delimiters, newlines and `${ }`
 * expressions kept), so a pattern run over it sees only code: an import
 * written inside a fixture string or quoted in prose is not an import. Same
 * length as the input, so a position found here reads the literal from the
 * original. With `keepStrings`, only comments and regular expressions are
 * blanked: the view in which one file names another.
 */
export function codeView(source, { keepStrings = false } = {}) {
  const out = source.split("");
  const erase = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
  const blank = keepStrings ? () => {} : erase;
  const templateDepth = []; // brace depth at which each open `${` returns to its template
  let braces = 0;
  let previous = ""; // last significant code character: decides regex or division
  let word = "";
  let i = 0;
  const n = source.length;
  const scanTemplate = () => {
    const start = i;
    while (i < n) {
      const c = source[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { blank(start, i); i++; previous = "`"; return; }
      if (c === "$" && source[i + 1] === "{") { blank(start, i); i += 2; templateDepth.push(braces); braces++; previous = "{"; return; }
      i++;
    }
    blank(start, n);
  };
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      erase(i, end < 0 ? n : end);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      erase(i, end < 0 ? n : end + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      previous = c;
      word = "";
      continue;
    }
    if (c === "`") { i++; scanTemplate(); word = ""; continue; }
    if (c === "/" && (previous === "" || "(,=:[!&|?{};+-*%<>~^".includes(previous) || KEYWORDS_BEFORE_REGEX.has(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        const r = source[j];
        if (r === "\\") { j += 2; continue; }
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      previous = "/";
      word = "";
      continue;
    }
    if (c === "{") braces++;
    if (c === "}") {
      braces--;
      if (templateDepth.length && templateDepth[templateDepth.length - 1] === braces) {
        templateDepth.pop();
        i++;
        scanTemplate();
        word = "";
        continue;
      }
    }
    if (/[\w$]/.test(c)) { word = /[\w$]/.test(previous) ? word + c : c; previous = c; }
    else if (!/\s/.test(c)) { previous = c; word = ""; }
    i++;
  }
  return out.join("");
}

/** The string literals inside the parenthesised argument that starts at `open`. */
function argumentLiterals(source, code, open) {
  let depth = 0;
  let end = open;
  for (; end < code.length && end < open + 400; end++) {
    if (code[end] === "(") depth++;
    else if (code[end] === ")" && --depth === 0) break;
  }
  const literals = [];
  for (const match of code.slice(open, end).matchAll(/(["'`])(\s*)\1/g)) {
    const at = open + match.index;
    const value = source.slice(at + 1, at + match[0].length - 1);
    if (!value.includes("${")) literals.push(value);
  }
  return literals;
}

/**
 * Module specifiers a source file asks the runtime to load.
 * `computed` lists dynamic imports whose target is an expression; each carries
 * the string literals in its argument (a path helper's input, often).
 * `named` is the source without comments and without its import specifiers:
 * the text in which it names other files OTHER than by importing them (the
 * graph already follows imports, and an erased `import type` must not come
 * back as a mention).
 */
export function moduleReferences(source) {
  const code = codeView(source);
  const named = codeView(source, { keepStrings: true }).split("");
  const specs = [];
  const computed = [];
  const literal = (quoteAt) => {
    const end = source.indexOf(source[quoteAt], quoteAt + 1);
    if (end < 0) return null;
    for (let k = quoteAt + 1; k < end; k++) named[k] = " ";
    return source.slice(quoteAt + 1, end);
  };
  // `import type` / `export type` are erased before anything runs, so they
  // carry no runtime dependency; an inline `{ type X }` clause is kept.
  for (const match of code.matchAll(/^[ \t]*(?:import|export)\b(\s+type\b)?[^;'"`]*?\bfrom\s*(["'])/gm)) {
    const spec = literal(match.index + match[0].length - 1);
    if (!match[1]) specs.push(spec);
  }
  for (const match of code.matchAll(/^[ \t]*import\s*(["'])/gm)) specs.push(literal(match.index + match[0].length - 1));
  for (const match of code.matchAll(/(?<![\w$.])(import|require)\s*\(\s*(["'`]?)/g)) {
    const quoteAt = match.index + match[0].length - 1;
    const end = match[2] ? source.indexOf(source[quoteAt], quoteAt + 1) : -1;
    const value = end < 0 ? null : source.slice(quoteAt + 1, end);
    const closes = value !== null && /^\s*[,)]/.test(code.slice(end + 1, end + 40));
    if (value !== null && closes && !value.includes("${")) {
      specs.push(literal(quoteAt));
    } else if (match[1] === "import") {
      const open = match.index + match[0].indexOf("(");
      computed.push({
        line: source.slice(0, match.index).split("\n").length,
        text: source.slice(match.index, match.index + 80).split("\n")[0],
        literals: argumentLiterals(source, code, open),
      });
    }
  }
  return { specs: [...new Set(specs.filter((spec) => typeof spec === "string" && spec.length > 0))], computed, named: named.join("") };
}
// Git's file-listing subcommand, spelled in pieces so this file does not match
// its own detector.
// does not read this detector as a gate that lists only tracked files.
const GIT_LISTING = new RegExp(`["'\`]ls-${"files"}["'\`\\s]|git ls-${"files"}`);

/** Whether a source lists directories or repository files itself, rather than naming what it reads. */
export function enumeratesFiles(source) {
  const code = codeView(source);
  if (/(?<![\w$.])(?:readdirSync|readdir|opendirSync|opendir|globSync|glob|filesThatWouldBeCommitted)\s*\(|\.(?:readdirSync|readdir|globSync|glob)\s*\(/.test(code)) return true;
  return GIT_LISTING.test(codeView(source, { keepStrings: true }));
}

/**
 * Resolve one specifier from `from` against the tracked file set.
 * @returns {{ kind: "file", path: string } | { kind: "package", name: string } | { kind: "unresolved" }}
 */
export function resolveSpecifier(from, spec, files) {
  const clean = spec.split(/[?#]/)[0];
  let base;
  if (clean.startsWith("./") || clean.startsWith("../") || clean === "." || clean === "..") {
    base = posix.normalize(posix.join(posix.dirname(from), clean));
  } else if (clean.startsWith("@/")) {
    base = posix.normalize(clean.slice(2));
  } else if (/^(?:node|data|https?):/.test(clean)) {
    return { kind: "package", name: clean };
  } else if (clean.startsWith("/") || clean.startsWith("file:") || /^[a-zA-Z]:/.test(clean) || clean === "") {
    return { kind: "unresolved" };
  } else {
    const parts = clean.split("/");
    return { kind: "package", name: clean.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] };
  }
  if (base === ".." || base.startsWith("../")) return { kind: "unresolved" };
  const found = resolvePath(base, files);
  return found ? { kind: "file", path: found } : { kind: "unresolved" };
}

function resolvePath(base, files) {
  const candidates = [base];
  for (const extension of CODE_EXTENSIONS) candidates.push(`${base}${extension}`);
  // TypeScript's convention: `./x.js` names `./x.ts`.
  const swapped = /\.(m|c)?jsx?$/.exec(base);
  if (swapped) {
    const stem = base.slice(0, -swapped[0].length);
    candidates.push(`${stem}.${swapped[1] ?? ""}ts`, `${stem}.tsx`);
  }
  for (const extension of CODE_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

/**
 * Every tracked code file with its resolved local imports.
 * `wildcard` marks a module that may load any code: a computed import whose
 * target this reader cannot name.
 */
export function buildGraph(trackedFiles, readText) {
  const files = new Set(trackedFiles);
  const nodes = new Map();
  for (const path of trackedFiles) {
    if (!isCodeFile(path)) continue;
    let text;
    try { text = readText(path); } catch { text = null; }
    if (text === null) { nodes.set(path, { text: "", imports: [], packages: [], unresolved: ["(unreadable)"], wildcard: true, enumerates: false }); continue; }
    const { specs, computed, named } = moduleReferences(text);
    const imports = new Set();
    const packages = new Set();
    const unresolved = [];
    for (const spec of specs) {
      const target = resolveSpecifier(path, spec, files);
      if (target.kind === "file") imports.add(target.path);
      else if (target.kind === "package") packages.add(target.name);
      else unresolved.push(spec);
    }
    let wildcard = false;
    const reach = COMPUTED_IMPORT_REACH.get(path);
    if (reach) {
      for (const file of trackedFiles) if (file.startsWith(reach) && isCodeFile(file) && !/\.test\.tsx?$/.test(file)) imports.add(file);
    } else {
      for (const call of computed) {
        // A computed import whose argument names a tracked file (`moduleUrl("lib/x.ts")`) loads that file.
        const named = call.literals
          .map((value) => resolveSpecifier(path, value, files).path ?? (value && !value.startsWith(".") ? resolvePath(posix.normalize(value), files) : null))
          .filter(Boolean);
        if (named.length) named.forEach((file) => imports.add(file));
        else wildcard = true;
      }
    }
    // `text` is the source without comments or import specifiers: what this file names, for selection by name.
    nodes.set(path, { text: named, imports: [...imports], packages: [...packages], unresolved, wildcard, enumerates: enumeratesFiles(text) });
  }
  return nodes;
}

function reach(starts, edges) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const path = stack.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    for (const next of edges(path)) stack.push(next);
  }
  return seen;
}

/**
 * Whether the file at `referrer`, whose code is `text`, names `path`. A
 * basename several tracked files share (route.ts, page.tsx, index.ts) must
 * appear with its directory's name, unless the referrer sits beside it.
 */
function namer(path, basenameCounts) {
  const name = posix.basename(path);
  const directory = posix.dirname(path);
  const parent = posix.basename(directory);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[^\\w.-])${escaped}(?![\\w-])`);
  const shared = (basenameCounts.get(name) ?? 0) > 1;
  return (referrer, text) => text.includes(name) && pattern.test(text) &&
    (!shared || directory === "." || posix.dirname(referrer) === directory || text.includes(parent));
}

/**
 * @typedef {{ plan: "affected" | "full" | "none", files: string[], needsBrowser: boolean, reasons: string[], scope?: "code" | "documents", changed?: string[] }} TestPlan
 */

/** @param {string} reason @returns {TestPlan} */
const fullPlan = (reason) => ({ plan: "full", files: [], needsBrowser: true, reasons: [reason] });

/**
 * Decide the plan for one change set.
 * @param {{ changed: string[], tracked: string[], tests: string[], readText: (path: string) => string }} input
 * @returns {TestPlan}
 */
export function selectTests({ changed, tracked, tests, readText }) {
  if (!Array.isArray(changed)) return fullPlan("the changed-file list could not be read");
  const unique = [...new Set(changed.filter(Boolean))].sort();
  if (unique.length === 0) return { plan: "none", files: [], needsBrowser: false, reasons: ["the pull request changes no files"] };
  if (unique.length > MAX_CHANGED_FILES) return fullPlan(`${unique.length} changed files exceed ${MAX_CHANGED_FILES}`);
  const documentsOnly = unique.every(isDocumentPath);
  for (const path of documentsOnly ? [] : unique) {
    if (RUNNER_FILES.has(path)) return fullPlan(`${path} changes how every test runs`);
    if (!isDocsMarkdown(path) && !isCodePath(path)) return fullPlan(`${path} is not code the import graph follows`);
  }

  const graph = buildGraph(tracked, readText);
  const edges = (path) => graph.get(path)?.imports ?? [];
  const testClosure = reach(tests, edges);
  for (const path of testClosure) {
    const node = graph.get(path);
    if (node?.unresolved.length) return fullPlan(`${path} imports ${node.unresolved[0]}, which does not resolve to a tracked file`);
  }

  const importers = new Map();
  for (const [path, node] of graph) {
    for (const target of node.imports) {
      if (!importers.has(target)) importers.set(target, []);
      importers.get(target).push(path);
    }
  }
  const basenameCounts = new Map();
  for (const path of tracked) {
    const name = posix.basename(path);
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
  }

  if (documentsOnly) return selectDocumentReaders({ changed: unique, tests, graph, importers, basenameCounts, edges });

  const codeChanged = unique.some((path) => !isDocsMarkdown(path));
  const seeds = new Set(unique.filter((path) => !isDocsMarkdown(path)));
  for (const path of unique) {
    const names = namer(path, basenameCounts);
    for (const [other, node] of graph) {
      if (other !== path && names(other, node.text)) seeds.add(other);
    }
  }
  if (codeChanged) {
    for (const [path, node] of graph) {
      if (node.wildcard || (node.enumerates && path.startsWith("tests/"))) seeds.add(path);
    }
  }
  const affected = reach(seeds, (path) => importers.get(path) ?? []);
  const files = tests.filter((test) => affected.has(test)).sort();
  const browserClosure = reach(files, edges);
  const needsBrowser = [...browserClosure].some((path) => (graph.get(path)?.packages ?? []).some((name) => BROWSER_PACKAGES.has(name)));
  const reasons = [floorLine(floored("test files the change reaches", "scripts/ci-affected-tests.mjs", tests.length, files.length))];
  return { plan: files.length ? "affected" : "none", scope: "code", files, needsBrowser, reasons };
}

/** Whether a source lists every repository file (rather than one tree). */
function listsRepository(text) {
  return /(?<![\w$.])filesThatWouldBeCommitted\s*\(/.test(text) || GIT_LISTING.test(text);
}

/**
 * The tests that read a documents-only change, and nothing else. See
 * the header. `graph`, `importers` and `basenameCounts` are selectTests'.
 * @returns {TestPlan}
 */
function selectDocumentReaders({ changed, tests, graph, importers, basenameCounts, edges }) {
  const inTests = (path) => path.startsWith("tests/");
  // Files whose code names a changed document.
  const namers = new Set();
  for (const path of changed) {
    const names = namer(path, basenameCounts);
    for (const [other, node] of graph) if (names(other, node.text)) namers.add(other);
  }
  // A script outside tests/ that names a document is often its reader or
  // compiler; a file that names that script (spawns or reads it) reads the
  // document through it.
  const referrers = new Map();
  for (const path of namers) {
    if (inTests(path) || !path.startsWith("scripts/")) continue;
    const names = namer(path, basenameCounts);
    for (const [other, node] of graph) {
      if (other === path || !names(other, node.text)) continue;
      if (!referrers.has(path)) referrers.set(path, []);
      referrers.get(path).push(other);
    }
  }
  // Tests and test helpers that list files where a changed document lives.
  const tokens = new Set();
  for (const path of changed) {
    const top = path.includes("/") ? path.slice(0, path.indexOf("/")) : null;
    if (top) tokens.add(new RegExp(`(?:^|[^\\w.-])${top.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`));
    if (path.endsWith(".md")) tokens.add(/\.md(?![\w-])/);
  }
  const sweeps = new Set();
  for (const [path, node] of graph) {
    if (!inTests(path) || !node.enumerates) continue;
    if (listsRepository(node.text) || [...tokens].some((token) => token.test(node.text))) sweeps.add(path);
  }
  // One hop out of a module or script that names a document; past that, only
  // through test files, so a citation in a widely imported module does not
  // select its whole import tree.
  const affected = reach([...namers, ...sweeps], (path) => {
    if (!namers.has(path) && !sweeps.has(path) && !inTests(path)) return [];
    return [...(importers.get(path) ?? []), ...(referrers.get(path) ?? [])];
  });
  const files = tests.filter((test) => affected.has(test)).sort();
  const browserClosure = reach(files, edges);
  const needsBrowser = [...browserClosure].some((path) => (graph.get(path)?.packages ?? []).some((name) => BROWSER_PACKAGES.has(name)));
  const count = floorLine(floored("test files that read the changed documents", "scripts/ci-affected-tests.mjs", tests.length, files.length));
  const reasons = [
    files.length ? `documents only: ${count}` : `documents only: NONE of the test files read the changed documents (${count})`,
    "lint, types and governance still run; source sweeps do not, and builds follow the deploy classification",
  ];
  return { plan: files.length ? "affected" : "none", scope: "documents", files, needsBrowser, reasons };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** The pull request's own changes: merge-base(base, HEAD)..HEAD. A stale base only adds files. */
export function changedFiles(root, base, head = "HEAD") {
  if (!/^[0-9a-f]{40}$/.test(base ?? "")) throw new Error("the base commit is missing or not a full SHA");
  return git(root, ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`]).split("\0").filter(Boolean);
}

/**
 * The plan for this event: the scheduled and dispatched certifications run
 * everything; a push to main and the cheap tiers run no tests.
 * @param {{ root: string, tier?: string, eventName?: string, base?: string }} input
 * @returns {TestPlan}
 */
export function decide({ root, tier, eventName, base }) {
  if (tier !== "yes") return { plan: "none", files: [], needsBrowser: false, reasons: [`tier ${tier || "(none)"} runs no tests`] };
  if (eventName !== "pull_request") return fullPlan(`a ${eventName || "non-pull-request"} certification runs the whole suite`);
  try {
    const tracked = filesThatWouldBeCommitted({ cwd: root });
    const changed = changedFiles(root, base);
    const decision = selectTests({ changed, tracked, tests: discoverTests(root), readText: (path) => readFileSync(resolve(root, path), "utf8") });
    return { ...decision, changed };
  } catch (error) {
    return fullPlan(`selection failed, so the whole suite runs: ${error?.message ?? error}`);
  }
}

function emit(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  if (value.includes("\n")) {
    const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
  } else {
    appendFileSync(file, `${name}=${value}\n`, "utf8");
  }
}

function main() {
  const decision = decide({
    root: process.cwd(),
    tier: process.env.CI_TIER,
    eventName: process.env.CI_EVENT_NAME,
    base: process.env.CI_BASE_SHA,
  });
  emit("plan", decision.plan);
  emit("scope", decision.scope ?? "code");
  emit("legs", JSON.stringify(TEST_LEGS[decision.plan]));
  emit("needs_browser", String(decision.needsBrowser));
  emit("files", decision.files.join("\n"));
  console.log(`ci-affected-tests · ${decision.plan.toUpperCase()} — ${decision.reasons.join("; ")}`);
  if (decision.changed) console.log(`changed:\n  ${decision.changed.join("\n  ")}`);
  if (decision.plan === "affected") console.log(`selected:\n  ${decision.files.join("\n  ")}`);
  console.log(`scope=${decision.scope ?? "code"} needs_browser=${decision.needsBrowser}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
