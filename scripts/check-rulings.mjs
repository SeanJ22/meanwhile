/** RC-01: lint's data diet, source contracts and browser privacy checks. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { browserEmailLeaks } from "../lib/feedback/browser-privacy.ts";

const BASELINE = "rulings-read-baseline.json";
const INITIAL = "208916a2c6718bec4f0446780662b288fddbaab1";
const DIET = "docs/rulings.md:192 and 194";
const CACHE_BYPASS = "bypass" + "Cache";
const hash = value => createHash("sha256").update(value).digest("hex");
const codeFile = file => /\.(?:[cm]?[jt]sx?|sql)$/.test(file);
const scriptFile = file => codeFile(file) || /\.(?:sh|bash|py|ps1|cmd|bat|rb|go)$/.test(file);
const sourceFile = file => /^(?:lib|scripts|app)\//.test(file) && codeFile(file);
const sentence = (what, file, ruling = DIET) => `${what} in ${file} violates ${ruling}.`;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}
function held(cwd, ref, file) {
  try { return git(cwd, "show", `${ref}:${file}`); } catch { return null; }
}
function files(cwd) {
  return [...new Set(git(cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0"))]
    .filter(file => file && existsSync(resolve(cwd, file))).sort();
}

/** Comments never spend the allowance. */
function withoutComments(text) {
  // Strip comments with the language scanner, retaining strings (including SQL).
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  let clean = "", start = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const at = scanner.getTokenPos();
    clean += text.slice(start, at) + text.slice(at, scanner.getTextPos()).replace(/[^\n]/g, " ");
    start = scanner.getTextPos();
  }
  clean += text.slice(start);
  return clean;
}
export function recordReads(file, text) {
  const rows = [], clean = withoutComments(text);
  for (const [kind, pattern] of [
    ["readCandidate", /\breadCandidate\s*\(/g],
    ["SELECT *", /\bselect\s+(?:(?!\bfrom\b|\bselect\b)[\s\S])*?\bfrom\b/gi],
    [CACHE_BYPASS, new RegExp(`\\b${CACHE_BYPASS}\\b`, "g")],
  ]) {
    for (const match of clean.matchAll(pattern)) {
      if (kind === "SELECT *" && !/(?:^select\s+|,)\s*(?:distinct\s+)?(?:[a-z_][\w$]*\s*\.\s*)?\*\s*(?:,|from\b)/i.test(match[0])) continue;
      if (kind === "SELECT *" && !storedProjection(clean, match)) continue;
      let signature = match[0];
      if (kind === "readCandidate") {
        const tokens = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, clean);
        tokens.setTextPos(match.index);
        let depth = 0;
        for (let token = tokens.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = tokens.scan()) {
          if (token === ts.SyntaxKind.OpenParenToken) depth++;
          if (token === ts.SyntaxKind.CloseParenToken && --depth === 0) { signature = clean.slice(match.index, tokens.getTextPos()); break; }
        }
      } else if (kind === "SELECT *") {
        signature += /^\s*(\$\{[^}]+\}|(?:[\w$"]+\.)?[\w$"]+)/.exec(clean.slice(match.index + match[0].length))?.[1] ?? "";
      }
      rows.push({ file, kind, fingerprint: hash(signature.replace(/\s+/g, "")), line: text.slice(0, match.index).split("\n").length });
    }
  }
  return rows;
}

/** Expanding a parameter recordset or a CTE's explicit columns does not re-read a stored record. */
function storedProjection(source, match) {
  const at = match.index, end = at + match[0].length;
  const start = Math.max(source.lastIndexOf("`", at), source.lastIndexOf(";", at)) + 1;
  const ctes = new Set([...source.slice(start, at).matchAll(/(\$\{[^}]+\}|[\w"]+)\s+as\s+(?:(?:not\s+)?materialized\s+)?\(/gi)].map(m => m[1].toLowerCase()));
  const boundary = [source.indexOf("`", end), source.indexOf(";", end)].filter(i => i >= 0);
  const tail = source.slice(end, boundary.length ? Math.min(...boundary) : undefined);
  // Only this SELECT's sources count; later CTEs and nested subqueries have their own SELECTs.
  const tokens = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, tail);
  let level = "", depth = 0;
  for (let token = tokens.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = tokens.scan()) {
    if (token === ts.SyntaxKind.CloseParenToken && depth === 0) break;
    if (token === ts.SyntaxKind.OpenParenToken) { if (depth++ === 0) level += "("; }
    else if (token === ts.SyntaxKind.CloseParenToken) { if (--depth === 0) level += ")"; }
    else if (depth === 0) level += token === ts.SyntaxKind.StringLiteral ? " " : tokens.getTokenText();
  }
  const targets = new Map();
  for (const m of (`FROM ${level}`).matchAll(/\b(?:from|join)\s+(?:lateral\s+)?(\$\{[^}]+\}|[\w."]+)(\s*\([^)]*\))?(?:\s+(?:as\s+)?([a-z_][\w$]*))?/gi)) {
    const table = m[1].toLowerCase(), alias = m[3]?.toLowerCase();
    const stored = !m[2] && !ctes.has(table);
    targets.set(table, stored);
    if (alias && !/^(?:where|on|left|right|inner|outer|cross|full|join|order|group|limit|union)$/.test(alias)) targets.set(alias, stored);
  }
  for (const m of (`FROM ${level}`).matchAll(/\b(?:from|join)\s+(?:lateral\s+)?\([^)]*\)\s+(?:as\s+)?([a-z_][\w$]*)/gi)) targets.set(m[1].toLowerCase(), false);
  const qualified = [...match[0].matchAll(/\b([a-z_][\w$]*)\s*\.\s*\*/gi)];
  return qualified.length ? qualified.some(m => targets.get(m[1].toLowerCase()) !== false) : targets.size === 0 || [...targets.values()].some(Boolean);
}
const keyOf = row => `${row.file}\t${row.kind}\t${row.fingerprint}`;
function excess(rows, allowance) {
  const counts = new Map();
  for (const row of allowance) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
  return rows.filter(row => {
    const key = keyOf(row), left = counts.get(key) ?? 0;
    if (left) { counts.set(key, left - 1); return false; }
    return true;
  });
}

/** A script must be reachable from code or an executable configuration, including through another script. */
function importedScripts(texts) {
  const scripts = [...texts.keys()].filter(file => file.startsWith("scripts/") && scriptFile(file));
  const edges = new Map();
  for (const [file, text] of texts) {
    if (!scriptFile(file) && !/^(?:package\.json|[^/]*config[^/]*|\.github\/.*\.ya?ml|Dockerfile|Makefile)$/.test(file)) continue;
    const source = codeFile(file) ? withoutComments(text) : text;
    const targets = new Set();
    for (const script of scripts) {
      if (file === script) continue;
      const relative = posix.relative(posix.dirname(file), script);
      const local = relative.startsWith(".") ? relative : `./${relative}`;
      if ([script, local].some(path => source.includes(path) || source.includes(path.replace(/\.[cm]?[jt]sx?$/, "") + '"') || source.includes(path.replace(/\.[cm]?[jt]sx?$/, "") + "'"))) targets.add(script);
    }
    edges.set(file, targets);
  }
  const seen = new Set(), queue = [...edges.keys()].filter(file => !file.startsWith("scripts/"));
  for (const file of queue) for (const target of edges.get(file) ?? []) {
    if (seen.has(target)) continue;
    seen.add(target); queue.push(target);
  }
  return seen;
}

function jobDeclarations(file, source) {
  const problems = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const prop = name => node.properties.find(p => p.name?.getText(ast).replaceAll(/["']/g, "") === name);
      const adapter = prop("acquisitionAdapter"), command = prop("command"), args = prop("args");
      const job = adapter || command && prop("sourceId") && ts.isArrayLiteralExpression(command.initializer) || args && (prop("id") && prop("executable") || prop("everyMs") || /["']scripts\//.test(args.getText(ast)));
      if (job && !prop("databaseBytesPerRun") && !prop("contract")) problems.push(sentence("A job has no database bytes per run", file));
      const bytes = prop("databaseBytesPerRun");
      if (bytes && ts.isPropertyAssignment(bytes) && (ts.isNumericLiteral(bytes.initializer) || ts.isStringLiteral(bytes.initializer) ||
        /^(?:[+-]?(?:NaN|Infinity|\d)|undefined|null|true|false)\b/.test(bytes.initializer.getText(ast)))) {
        const number = Number(bytes.initializer.getText(ast).replaceAll("_", ""));
        if (!Number.isSafeInteger(number) || number < 0) problems.push(sentence("A job has invalid database bytes per run", file));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return problems;
}

/** @param {{ cwd?: string, base?: string, update?: boolean }} options */
export async function checkRulings({ cwd = process.cwd(), base, update = true } = {}) {
  const problems = [], texts = new Map();
  const paths = files(cwd);
  for (const file of paths) {
    if (/\.(?:png|jpe?g|gif|webp|avif|woff2?|ttf|pmtiles|parquet|pdf|gz|zip)$/.test(file)) continue;
    texts.set(file, readFileSync(resolve(cwd, file), "utf8"));
  }
  base ??= git(cwd, "merge-base", "origin/river", "HEAD").trim();
  const previous = new Set(git(cwd, "ls-tree", "-r", "--name-only", base).trim().split("\n"));
  const baselineText = texts.get(BASELINE);
  if (!baselineText) return [sentence("The saved whole-record read list is missing", BASELINE)];
  const baseline = JSON.parse(baselineText);
  const prior = held(cwd, base, BASELINE) ?? held(cwd, "HEAD", BASELINE);
  const current = [...texts].filter(([file]) => sourceFile(file)).flatMap(([file, text]) => recordReads(file, text));
  const allowance = prior ? JSON.parse(prior).reads : [...new Set([...baseline.reads, ...current].map(row => row.file))]
    .flatMap(file => recordReads(file, held(cwd, INITIAL, file) ?? ""));
  const history = git(cwd, "log", "-2", "--format=%H", "--", BASELINE).trim().split("\n").filter(Boolean)
    .map(ref => JSON.parse(held(cwd, ref, BASELINE)).reads);
  for (const row of [...excess(baseline.reads, allowance), ...excess(current, allowance),
    ...excess(current, baseline.reads), ...(history.length === 2 ? excess(history[0], history[1]) : []),
    ...(history.length ? excess(baseline.reads, history[0]) : [])]) {
    problems.push(sentence(`An added ${row.kind} whole-record read`, row.file));
  }
  const reachable = importedScripts(texts);
  for (const file of paths.filter(file => !previous.has(file))) {
    if (/^docs\/(?:evidence\/|measurements\/|[a-z][a-z0-9]*-[a-z]*\d[a-z0-9-]*\.md$)/i.test(file)) problems.push(sentence("An added proof file", file));
    if (file.startsWith("scripts/") && scriptFile(file) && !reachable.has(file)) problems.push(sentence("An added script is never imported or run", file));
  }
  for (const [file, source] of texts) {
    if (file === "docs/rulings.md") {
      // Trust committed authors, never the configured author of the current session.
      const ownerBase = held(cwd, base, file);
      const uncommitted = source !== held(cwd, "HEAD", file) && source !== ownerBase;
      const authors = git(cwd, "log", "-1", "--format=%ae", source === ownerBase ? base : "HEAD", "--", file).trim().split("\n").filter(Boolean);
      if (uncommitted || authors.some(author => !["seanj22@gmail.com", "123616252+SeanJ22@users.noreply.github.com"].includes(author))) problems.push(sentence("Only Sean may edit the rulings", file, "docs/rulings.md:3"));
    }
    if (sourceFile(file) && !file.endsWith("check-rulings.mjs")) problems.push(...jobDeclarations(file, source));
  }
  for (const file of browserEmailLeaks(texts)) problems.push(sentence("Sean's personal email is browser reachable", file, "docs/rulings.md:214 and 218"));
  // Evaluate the actual registered contracts, so NaN, undefined and dynamic factories cannot evade the source check.
  const invalidJobs = new Set();
  for (const [file, name, projection] of [
    ["lib/civic-data/contracts.ts", "ROUTINE_SOURCE_CONTRACTS"],
    ["lib/civic-data/manual-contracts.ts", "MANUAL_PRODUCTION_SOURCE_CONTRACTS"],
    ["lib/civic-data/runner.ts", "ROUTINE_SOURCE_TASKS", "contract"],
    ["lib/civic-data/state-binding-refresh-contracts.ts", "STATE_BINDING_REFRESH_TASKS", "contract"],
  ]) {
    if (!texts.has(file)) continue;
    const contractsModule = await import(pathToFileURL(resolve(cwd, file)).href);
    for (const job of contractsModule[name]) {
      const number = (projection ? job[projection] : job).databaseBytesPerRun;
      if (!Number.isSafeInteger(number) || number < 0) {
        if (!projection || !invalidJobs.has(job.id)) problems.push(sentence(number === undefined ? "A job has no database bytes per run" : "A job has invalid database bytes per run", file));
        invalidJobs.add(job.id);
      }
    }
  }
  if (update && !problems.length) {
    const next = JSON.stringify({ ...baseline, reads: current }, null, 2) + "\n";
    if (next !== baselineText) writeFileSync(resolve(cwd, BASELINE), next);
  }
  return [...new Set(problems)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv.find(arg => arg.startsWith("--base="))?.slice(7);
  try {
    const problems = await checkRulings({ base });
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exitCode = 1;
  } catch {
    console.error(sentence("The rulings check could not read the change", "scripts/check-rulings.mjs"));
    process.exitCode = 1;
  }
}
