import { posix } from "node:path";
import * as nodeModule from "node:module";

import type { RoutineSourceContract } from "./contracts.ts";
import type { ManualProductionSourceContract } from "./manual-contracts.ts";

export interface CivicDataFirewallTree {
  readonly files: Readonly<Record<string, string>>;
  readonly contracts: readonly RoutineSourceContract[];
  readonly manualContracts: readonly ManualProductionSourceContract[];
}

export interface CivicDataFirewallFinding {
  readonly code: string;
  readonly path: string;
  readonly detail: string;
}

const ROUTINE_DATA_MARKER = /refresh(?::|-)(?:daily|meetings|nj-filing|dotgov|fec|legiscan)|routine:civic-data|routine-civic-data|ingest\s+composite|nj:ballot|dotgov:fetch|fec:fetch|nh:members|acs:population/i;
const ROUTINE_OPS_MARKER = /job(?::|-)?watch|watch(?::|-)?workflows|intake(?::|-)?tripwire|schedule(?::|-)?audit|jobs(?::|-)?status|freshness(?::|-)?shadow|nightly(?::|-)?window|window:run|runtime(?:-|_|\s)+(?:health|status|watch)|(?:health|status|watch)(?:-|_|\s)+runtime|refresh-run-log|workflow-run-index/i;
const SCHEDULE = /(?:^|\n)\s*schedule\s*:/m;
const CONTENTS_WRITE = /contents\s*:\s*write/i;
const WORKFLOW_GIT_WRITE = /\bgit(?:\.exe)?\b[^\r\n]{0,240}\b(?:add|commit|push)\b|scripts[\\/]push-main\.mjs|\bgh\s+api\b[^\r\n]*(?:\/contents(?:\/|\b)|repos\/[^/\s]+\/[^/\s]+\/contents)/i;
const RELEASE_INVOCATION = /scripts[\\/]push-main\.mjs|(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|execa|command:|runCommand)\s*\([\s\S]{0,480}(?:["'`]git["'`][\s\S]{0,200}["'`](?:add|commit|push|merge|rebase|tag)["'`]|["'`]git\s+(?:add|commit|push|merge|rebase|tag)\b|["'`]gh["'`]|["'`]next["'`][\s\S]{0,100}["'`]build["'`]|netlify|\bdeploy\b|(?:pnpm|npm|yarn|bun)[\s\S]{0,160}\b(?:test|build|walk)\b|playwright)/i;
const PROCESS_LAUNCH_METHODS = new Set(["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]);
const PROCESS_LAUNCH_METHOD = [...PROCESS_LAUNCH_METHODS].sort((left, right) => right.length - left.length).join("|");
const GIT_MUTATION_ARGUMENT = /(?:["'`](?:add|apply|am|checkout|cherry-pick|clean|commit|merge|mv|pull|push|rebase|reset|restore|revert|rm|switch|tag|update-index|update-ref|worktree)["'`]|\bgit(?:\.exe)?\s+(?:-[^\s"'`]+\s+)*(?:add|apply|am|checkout|cherry-pick|clean|commit|merge|mv|pull|push|rebase|reset|restore|revert|rm|switch|tag|update-index|update-ref|worktree)\b)/i;
const GIT_READ_ONLY_ARGUMENT = /["'`](?:cat-file|diff|log|ls-files|merge-base|remote|rev-parse|show|status|symbolic-ref)["'`]/i;
const NON_GIT_RELEASE_PAYLOAD = /scripts[\\/]push-main\.mjs|["'`]gh(?:\.exe)?["'`]|["'`]next(?:\.cmd)?["'`][\s\S]{0,120}["'`]build["'`]|\bnetlify\b|\bdeploy\b|["'`](?:pnpm|pnpm\.cmd|npm|npm\.cmd|yarn|bun)["'`][\s\S]{0,180}["'`](?:test|build|walk)["'`]|\bplaywright\b/i;
const SOFTWARE_CERTIFICATION_INVOCATION = /(?:(?:spawnSync|execFileSync|execSync|execa|command:|runCommand)\s*\([\s\S]{0,480}(?:(?:pnpm|npm|yarn|bun)[\s\S]{0,160}\b(?:test|build|lint|tsc|typecheck|walk)\b|--test|playwright|office-opening-spell|tests[\\/][^\s"'`]+\.test\.[cm]?[jt]s)|(?:from\s*|import\s*\()\s*["'][^"']*tests[\\/][^"']+\.test\.[cm]?[jt]s["'])/i;
const SOFTWARE_CERTIFICATION_PAYLOAD = /(?:pnpm|npm|yarn|bun)[\s\S]{0,180}\b(?:test|build|lint|tsc|typecheck|walk)\b|["'`]--test["'`]|\bplaywright\b|office-opening-spell|tests[\\/][^\s"'`]+\.test\.[cm]?[jt]s/i;
const SHELL_EXECUTABLE = /\.(?:ps1|sh|cmd|bat)$/i;
const SHELL_RELEASE_INVOCATION = /\bgit(?:\.exe)?\b[^\r\n]{0,240}\b(?:add|apply|am|checkout|cherry-pick|clean|commit|merge|pull|push|rebase|reset|restore|revert|rm|tag|update-ref)\b|scripts[\\/]push-main\.mjs|\bgh(?:\.exe)?\b|\bnetlify\b|\bdeploy\b/i;
const SHELL_FILESYSTEM_MUTATION = /\b(?:Add-Content|Clear-Content|Copy-Item|Move-Item|New-Item|Out-File|Remove-Item|Rename-Item|Set-Content)\b|(?:^|[;&|]\s*)(?:copy|cp|del|erase|mkdir|move|mv|rm|rmdir|touch|truncate)\b/im;
const FILESYSTEM_MUTATION_METHODS = new Set([
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createWriteStream",
  "fchmod",
  "fchmodSync",
  "fchown",
  "fchownSync",
  "ftruncate",
  "ftruncateSync",
  "futimes",
  "futimesSync",
  "lchmod",
  "lchmodSync",
  "lchown",
  "lchownSync",
  "link",
  "linkSync",
  "lutimes",
  "lutimesSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "unlink",
  "unlinkSync",
  "utimes",
  "utimesSync",
  "write",
  "writeFile",
  "writeFileSync",
  "writeSync",
  "writev",
  "writevSync",
]);
const DISTINCTIVE_FILESYSTEM_MUTATION_CALL = /(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|writeStampStable)\s*\(/;
function stripExecutableComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function stripShellComments(source: string, path: string): string {
  if (/\.(?:ps1|sh)$/i.test(path)) return source.replace(/^\s*#.*$/gm, "");
  if (/\.(?:cmd|bat)$/i.test(path)) return source.replace(/^\s*(?:rem\b|::).*$/gim, "");
  return source;
}


function maskStringLiterals(source: string): string {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let masked = "";
  for (const char of source) {
    if (quote !== null) {
      if (escaped) {
        escaped = false;
        masked += char === "\n" ? "\n" : " ";
      } else if (char === "\\") {
        escaped = true;
        masked += " ";
      } else if (char === quote) {
        quote = null;
        masked += char;
      } else {
        masked += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    masked += char;
  }
  return masked;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNamedBindings(specifiers: string): readonly { imported: string; local: string }[] {
  return specifiers.split(",").flatMap((raw) => {
    const item = raw.trim().replace(/^type\s+/, "");
    if (!item) return [];
    const alias = /^([A-Za-z_$][\w$]*)(?:\s+as\s+|\s*:\s*)([A-Za-z_$][\w$]*)$/.exec(item);
    const imported = alias?.[1] ?? item;
    const local = alias?.[2] ?? imported;
    return /^[A-Za-z_$][\w$]*$/.test(imported) && /^[A-Za-z_$][\w$]*$/.test(local)
      ? [{ imported, local }]
      : [];
  });
}


function resolveDetachedMethodBindings(
  source: string,
  namespaces: Set<string>,
  callables: Set<string>,
  methods: ReadonlySet<string>,
  { promisesNamespace = false }: { readonly promisesNamespace?: boolean } = {},
): void {
  const methodPattern = [...methods]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  const simpleAssignments = [...source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;\r\n]+)?\s*=\s*([^;\r\n]+)/g,
  )];
  const destructuredAssignments = [...source.matchAll(
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([^;\r\n]+)/g,
  )];

  let changed = true;
  while (changed) {
    changed = false;
    for (const match of simpleAssignments) {
      const local = match[1]!;
      const value = (match[2] ?? "").trim();
      for (const namespace of [...namespaces]) {
        const escapedNamespace = escapeRegExp(namespace);
        if (new RegExp(String.raw`^${escapedNamespace}\s*$`).test(value) && !namespaces.has(local)) {
          namespaces.add(local);
          changed = true;
        }
        if (
          promisesNamespace
          && new RegExp(String.raw`^${escapedNamespace}\s*(?:\?\.|\.)\s*promises\s*$`).test(value)
          && !namespaces.has(local)
        ) {
          namespaces.add(local);
          changed = true;
        }
        const detachedMethod = new RegExp(
          String.raw`^${escapedNamespace}\s*(?:\?\.|\.)\s*${promisesNamespace ? String.raw`(?:promises\s*(?:\?\.|\.)\s*)?` : ""}(?:${methodPattern})\b(?:\s*\.\s*bind\s*\([^)]*\))?\s*$`,
        );
        if (detachedMethod.test(value) && !callables.has(local)) {
          callables.add(local);
          changed = true;
        }
      }
      for (const callable of [...callables]) {
        if (
          new RegExp(String.raw`^${escapeRegExp(callable)}\s*(?:\.\s*bind\s*\([^)]*\))?\s*$`).test(value)
          && !callables.has(local)
        ) {
          callables.add(local);
          changed = true;
        }
      }
    }

    for (const match of destructuredAssignments) {
      const value = (match[2] ?? "").trim();
      for (const namespace of [...namespaces]) {
        const escapedNamespace = escapeRegExp(namespace);
        const comesFromNamespace = new RegExp(
          String.raw`^${escapedNamespace}${promisesNamespace ? String.raw`(?:\s*(?:\?\.|\.)\s*promises)?` : ""}\s*$`,
        ).test(value);
        if (!comesFromNamespace) continue;
        for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
          if (promisesNamespace && imported === "promises" && !namespaces.has(local)) {
            namespaces.add(local);
            changed = true;
          }
          if (methods.has(imported) && !callables.has(local)) {
            callables.add(local);
            changed = true;
          }
        }
      }
    }
  }
}

function balancedCall(source: string, openAt: number): string {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let index = openAt; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openAt, index + 1);
    }
  }
  // An incomplete expression is still inspected fail-closed rather than
  // becoming an evasion merely because the static instrument cannot balance it.
  return source.slice(openAt, Math.min(source.length, openAt + 1_200));
}

/** Match against masked code, then recover the same balanced call from source. */
function matchingExecutableCalls(
  source: string,
  masked: string,
  callee: RegExp,
): readonly string[] {
  const calls: string[] = [];
  for (const match of masked.matchAll(callee)) {
    const at = (match.index ?? 0) + match[0].lastIndexOf("(");
    calls.push(balancedCall(source, at));
  }
  return calls;
}

function callCarriesReleasePayload(call: string): boolean {
  if (NON_GIT_RELEASE_PAYLOAD.test(call)) return true;
  const invokesGit = /["'`]git(?:\.exe)?["'`]|["'`][^"'`]{0,200}\bgit(?:\.exe)?\s+[^"'`]*/i.test(call);
  if (!invokesGit) return false;
  if (GIT_MUTATION_ARGUMENT.test(call)) return true;
  return !GIT_READ_ONLY_ARGUMENT.test(call);
}

/** Resolve child-process imports and detached aliases to balanced invocations. */
function processLaunchCalls(source: string): readonly string[] {
  const executable = stripExecutableComments(source);
  const masked = maskStringLiterals(executable);

  const callables = new Set<string>();
  const namespaces = new Set<string>();
  const modulePattern = String.raw`(?:node:)?child_process`;
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:import|export)\s*\{([^}]*)\}\s*from\s*["']${modulePattern}["']`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (PROCESS_LAUNCH_METHODS.has(imported)) callables.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*["']${modulePattern}["']`, "g"))) {
    namespaces.add(match[1]!);
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (PROCESS_LAUNCH_METHODS.has(imported)) callables.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)`, "g"))) {
    namespaces.add(match[1]!);
  }
  resolveDetachedMethodBindings(executable, namespaces, callables, PROCESS_LAUNCH_METHODS);

  const calls: string[] = [];
  for (const local of callables) {
    calls.push(...matchingExecutableCalls(
      executable,
      masked,
      new RegExp(String.raw`(?<![\w$.])${escapeRegExp(local)}\s*\(`, "g"),
    ));
  }
  for (const namespace of namespaces) {
    calls.push(...matchingExecutableCalls(
      executable,
      masked,
      new RegExp(String.raw`\b${escapeRegExp(namespace)}\s*(?:\?\.|\.)\s*(?:${PROCESS_LAUNCH_METHOD})\s*\(`, "g"),
    ));
  }
  for (const direct of [
    /\bBun\s*\.\s*(?:spawn|spawnSync)\s*\(/g,
    /\b(?:new\s+)?Deno\s*\.\s*Command\s*\(/g,
  ]) {
    calls.push(...matchingExecutableCalls(executable, masked, direct));
  }
  return [...new Set(calls)];
}

/** Resolve child-process imports before inspecting each balanced invocation. */
function invokesReleaseMachinery(
  source: string,
  launchCalls: readonly string[] = processLaunchCalls(source),
): boolean {
  const executable = stripExecutableComments(source);
  if (RELEASE_INVOCATION.test(executable)) return true;
  return launchCalls.some(callCarriesReleasePayload);
}

function invokesSoftwareCertification(
  source: string,
  launchCalls: readonly string[] = processLaunchCalls(source),
): boolean {
  const executable = stripExecutableComments(source);
  return SOFTWARE_CERTIFICATION_INVOCATION.test(executable)
    || launchCalls.some((call) => SOFTWARE_CERTIFICATION_PAYLOAD.test(call));
}

/** Resolve imported Node capabilities, including detached aliases and fs.promises. */
function nodeMethodBindings(executable: string, modulePattern: string, methods: ReadonlySet<string>, shadowed: ReadonlySet<string> = new Set()) {
  const namespaces = new Set<string>();
  const namedMutators = new Set<string>();

  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:import|export)\s*\{([^}]*)\}\s*from\s*["']${modulePattern}["']`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (imported === "promises") namespaces.add(local);
      if (methods.has(imported)) namedMutators.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*["']${modulePattern}["']`, "g"))) {
    namespaces.add(match[1]!);
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)`, "g"))) {
    for (const { imported, local } of parseNamedBindings(match[1] ?? "")) {
      if (imported === "promises") namespaces.add(local);
      if (methods.has(imported)) namedMutators.add(local);
    }
  }
  for (const match of executable.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s*)?(?:require|import)\s*\(\s*["']${modulePattern}["']\s*\)(?:\s*\.\s*promises)?`, "g"))) {
    namespaces.add(match[1]!);
  }

  resolveDetachedMethodBindings(
    executable,
    namespaces,
    namedMutators,
    methods,
    { promisesNamespace: true },
  );

  const callees = [...namedMutators].filter(name => !shadowed.has(name)).map(escapeRegExp);
  for (const namespace of namespaces) {
    if (shadowed.has(namespace)) continue;
    callees.push(String.raw`${escapeRegExp(namespace)}\s*(?:\?\.|\.)\s*(?:promises\s*(?:\?\.|\.)\s*)?(?:${[...methods].map(escapeRegExp).join("|")})`);
  }
  return callees.length ? `(?:${callees.join("|")})` : "(?!)";
}

/** Split expressions at top-level commas, preserving nested calls and literals. */
function expressionParts(source: string): string[] {
  const masked = maskStringLiterals(source);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]!;
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

/** Only exempt destinations derived from the OS temp root, never names like 'tmp'. */
function temporaryPathClassifier(executable: string): (expression: string) => boolean {
  const masked = maskStringLiterals(executable);
  const parameters = [
    ...matchingExecutableCalls(executable, masked, /\b(?:function(?:\s*\*)?(?:\s+[\w$]+)?|catch)\s*\(/g),
    ...[...masked.matchAll(/\(([^()]*)\)\s*(?::[^=;{}]+)?=>|\b([A-Za-z_$][\w$]*)\s*=>/g)].map(match => match[1] ?? match[2]!),
  ];
  // A same-named parameter must not inherit another scope's temporary path.
  const shadowed = new Set(parameters.flatMap(value => maskStringLiterals(value).match(/[A-Za-z_$][\w$]*/g) ?? []));
  const tmpdir = nodeMethodBindings(executable, String.raw`(?:node:)?os`, new Set(["tmpdir"]), shadowed);
  const paths = nodeMethodBindings(executable, String.raw`(?:node:)?path`, new Set(["join", "resolve"]), shadowed);
  const mkdtemp = nodeMethodBindings(executable, String.raw`(?:node:)?fs(?:/promises)?`, new Set(["mkdtemp", "mkdtempSync"]), shadowed);
  const constants = new Map<string, string>();
  const duplicates = new Set<string>();
  const declarations = new Set<string>();
  for (const match of executable.matchAll(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=;\r\n]+)?\s*=\s*([^;\r\n]+)/g)) {
    if (!/^(?:const|let|var)\s/.test(masked.slice(match.index))) continue;
    if (declarations.has(match[2]!)) duplicates.add(match[2]!);
    declarations.add(match[2]!);
    if (match[1] === "const") constants.set(match[2]!, match[3]!.trim());
  }
  const relativeLiteral = (value: string): boolean => {
    const literal = /^(["'`])([^"'`\\]*)\1$/.exec(value)?.[2];
    return literal !== undefined && !literal.includes("${") && !literal.includes(":")
      && !literal.startsWith("/") && !literal.split("/").includes("..");
  };
  const isTemporary = (raw: string, seen = new Set<string>()): boolean => {
    const value = raw.trim().replace(/^await\s+/, "");
    if (new RegExp(`^${tmpdir}\\s*\\(\\s*\\)$`).test(value)) return true;
    if (constants.has(value) && !duplicates.has(value) && !shadowed.has(value) && !seen.has(value)) {
      return isTemporary(constants.get(value)!, new Set([...seen, value]));
    }
    const call = new RegExp(`^(?:${paths}|${mkdtemp})\\s*\\(`).exec(value);
    if (!call) return false;
    const open = call[0].lastIndexOf("(");
    const body = balancedCall(value, open);
    if (open + body.length !== value.length || !body.endsWith(")")) return false;
    const args = expressionParts(body.slice(1, -1));
    return args.length > 0 && isTemporary(args[0]!, seen) && args.slice(1).every(relativeLiteral);
  };
  return expression => isTemporary(expression);
}

function invokesFilesystemMutation(source: string): boolean {
  const executable = stripExecutableComments(source);
  const masked = maskStringLiterals(executable);
  const isTemporary = temporaryPathClassifier(executable);
  const destinationOnly = new Set(["copyFile", "copyFileSync", "cp", "cpSync", "link", "linkSync", "symlink", "symlinkSync"]);
  const moves = new Set(["rename", "renameSync"]);
  const firstPath = new Set([...FILESYSTEM_MUTATION_METHODS].filter(method => !destinationOnly.has(method) && !moves.has(method)));
  // A copy mutates its destination; a move mutates both source and destination.
  for (const { methods, indexes } of [{ methods: destinationOnly, indexes: [1] }, { methods: moves, indexes: [0, 1] }, { methods: firstPath, indexes: [0] }]) {
    const callees = nodeMethodBindings(executable, String.raw`(?:node:)?fs(?:/promises)?`, methods);
    const calls = [...matchingExecutableCalls(executable, masked, new RegExp(`(?<![\\w$.])${callees}\\s*\\(`, "g"))];
    if (methods === firstPath) calls.push(...matchingExecutableCalls(executable, masked, new RegExp(DISTINCTIVE_FILESYSTEM_MUTATION_CALL.source, "g")));
    if (calls.some(call => {
      const args = expressionParts(call.slice(1, -1));
      return indexes.some(index => args[index] === undefined || !isTemporary(args[index]!));
    })) return true;
  }
  return false;
}

/** Make `join(ROOT, "data", "health", "x")` searchable as `data/health/x`. */
function joinedPathLiterals(source: string): string {
  return source.replace(/["'`]\s*,\s*["'`]/g, "/").replace(/\\/g, "/");
}

function resolveLocalModule(
  files: Readonly<Record<string, string>>,
  importer: string,
  reference: string,
): string | null {
  if (!reference.startsWith(".")) return null;
  const clean = reference.split(/[?#]/, 1)[0] ?? reference;
  const base = posix.normalize(posix.join(posix.dirname(importer), clean));
  if (base === ".." || base.startsWith("../")) return null;
  const extension = posix.extname(base);
  const candidates = extension
    ? [
        base,
        ...(extension === ".js" || extension === ".mjs" || extension === ".cjs"
          ? [base.slice(0, -extension.length) + ".ts", base.slice(0, -extension.length) + ".mts", base.slice(0, -extension.length) + ".tsx"]
          : []),
      ]
    : [base, `${base}.ts`, `${base}.mts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.mts`, `${base}/index.tsx`, `${base}/index.js`];
  return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
}

interface ExecutableDependencyNode {
  readonly path: string;
  readonly executable: string;
  readonly launchCalls: readonly string[];
}

interface ExecutableDependencyClosure {
  readonly nodes: readonly ExecutableDependencyNode[];
  readonly problems: readonly string[];
}

const EXECUTABLE_CLOSURE_NODE_LIMIT = 512;

function repositoryLocalExecutableReferences(
  files: Readonly<Record<string, string>>,
  executable: string,
): readonly string[] {
  const references = new Set<string>();
  const searchable = joinedPathLiterals(executable);
  for (const match of searchable.matchAll(
    /(?:^|[^A-Za-z0-9_.-])(?:\.\/)?((?:scripts|lib)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|ps1|sh|cmd|bat))\b/gim,
  )) {
    const requested = (match[1] ?? "").replace(/\\/g, "/");
    const extension = posix.extname(requested);
    const candidates = [
      requested,
      ...(extension === ".js" || extension === ".mjs" || extension === ".cjs"
        ? [
            requested.slice(0, -extension.length) + ".ts",
            requested.slice(0, -extension.length) + ".mts",
            requested.slice(0, -extension.length) + ".tsx",
          ]
        : []),
    ];
    const path = candidates.find((candidate) => Object.hasOwn(files, candidate));
    if (path !== undefined) references.add(path);
  }
  return [...references];
}

function processInvocationProjection(
  source: string,
  launchCalls: readonly string[] = processLaunchCalls(source),
): string {
  return launchCalls
    .map((call) => [...call.matchAll(/["'`]([^"'`]*)["'`]/g)].map((match) => match[1] ?? "").join(" "))
    .join("\n");
}

function executableDependencyClosure(
  files: Readonly<Record<string, string>>,
  entry: string,
  expandExecutable: (path: string) => WorkflowExecutableClosure = (path) =>
    workflowExecutableClosure(files, path),
): ExecutableDependencyClosure {
  const seen = new Set<string>();
  const pending = [entry];
  const nodes: ExecutableDependencyNode[] = [];
  const problems = new Set<string>();
  while (pending.length > 0) {
    if (seen.size >= EXECUTABLE_CLOSURE_NODE_LIMIT) {
      problems.add(`registered executable closure exceeded ${EXECUTABLE_CLOSURE_NODE_LIMIT} files`);
      break;
    }
    const path = pending.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = stripExecutableComments(files[path] ?? "");
    const packageClosure = expandExecutable(path);
    for (const problem of packageClosure.problems) problems.add(problem);
    const launchCalls = processLaunchCalls(packageClosure.executable);
    nodes.push({ path, executable: packageClosure.executable, launchCalls });
    let importSource = source;
    if (/\b(?:import|export)\s+(?:type\b|\{[^}]*\btype\b)/.test(source)) {
      // Runtime Node exposes this API before this repository's @types/node.
      const strip = (nodeModule as typeof nodeModule & { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;
      try { if (strip) importSource = strip(source); } catch { /* fail closed */ }
    }
    const references = importSource.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'`]([^"'`]+)["'`]/g);
    for (const match of references) {
      const dependency = resolveLocalModule(files, path, match[1] ?? "");
      if (
        dependency !== null
        && /\.[cm]?[jt]sx?$/.test(dependency)
        && !seen.has(dependency)
      ) {
        pending.push(dependency);
      }
    }
    const executedText = [
      processInvocationProjection(source, launchCalls),
      ...launchCalls,
      ...packageClosure.packageCommands,
    ].join("\n");
    for (const dependency of repositoryLocalExecutableReferences(files, executedText)) {
      if (!seen.has(dependency)) pending.push(dependency);
    }
  }
  return { nodes, problems: [...problems].sort() };
}

interface WorkflowExecutableClosure {
  readonly executable: string;
  readonly packageCommands: readonly string[];
  readonly problems: readonly string[];
}

const WORKFLOW_CLOSURE_NODE_LIMIT = 256;


function workflowExecutableClosure(
  files: Readonly<Record<string, string>>,
  workflowPath: string,
): WorkflowExecutableClosure {
  let packageScripts: Readonly<Record<string, string>> = {};
  const problems: string[] = [];
  try {
    const parsed = JSON.parse(files["package.json"] ?? "{}") as { readonly scripts?: unknown };
    if (parsed.scripts !== undefined && (typeof parsed.scripts !== "object" || parsed.scripts === null || Array.isArray(parsed.scripts))) {
      problems.push("package.json scripts is not an object");
    } else {
      packageScripts = Object.fromEntries(
        Object.entries((parsed.scripts ?? {}) as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    }
  } catch (error) {
    problems.push(`package.json could not be parsed (${error instanceof Error ? error.name : "error"})`);
  }

  const pending: { readonly id: string; readonly body: string }[] = [{
    id: workflowPath,
    body: (files[workflowPath] ?? "").replace(/^\s*#.*$/gm, ""),
  }];
  const seen = new Set<string>();
  const chunks: string[] = [];
  const packageCommands: string[] = [];
  while (pending.length > 0) {
    if (seen.size >= WORKFLOW_CLOSURE_NODE_LIMIT) {
      problems.push(`workflow executable closure exceeded ${WORKFLOW_CLOSURE_NODE_LIMIT} nodes`);
      break;
    }
    const next = pending.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    chunks.push(next.body);
    if (next.id.startsWith("package-script:")) packageCommands.push(next.body);

    const shellLike = next.id.startsWith("package-script:")
      || /(?:\.ya?ml|\.ps1|\.sh|\.cmd|\.bat)$/i.test(next.id);
    const invocationSurface = `${shellLike ? next.body : ""}\n${processInvocationProjection(next.body)}`;
    for (const [name, command] of Object.entries(packageScripts)) {
      const escaped = escapeRegExp(name);
      const invocation = new RegExp(
        String.raw`\b(?:pnpm(?:\.cmd)?\s+(?:(?:--silent|-s)\s+)*(?:run\s+)?|npm(?:\.cmd)?\s+(?:(?:--silent|-s)\s+)*(?:run|run-script)\s+|yarn(?:\.cmd)?\s+(?:(?:--silent|-s)\s+)*(?:run\s+)?|bun(?:\.exe)?\s+run\s+)["']?${escaped}["']?(?=$|[\s;&|])`,
        "m",
      );
      const id = `package-script:${name}`;
      if (invocation.test(invocationSurface) && !seen.has(id)) pending.push({ id, body: stripExecutableComments(command) });
    }

    for (const match of next.body.matchAll(/\buses\s*:\s*["']?(\.\/[A-Za-z0-9_./\\-]+)["']?/g)) {
      const requested = (match[1] ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
      const normalized = posix.normalize(requested);
      if (normalized === ".." || normalized.startsWith("../")) {
        problems.push(`local action escapes the repository: ${match[1]}`);
        continue;
      }
      const candidates = /\.ya?ml$/i.test(normalized)
        ? [normalized]
        : [`${normalized}/action.yml`, `${normalized}/action.yaml`];
      const actionPath = candidates.find((candidate) => Object.hasOwn(files, candidate));
      if (actionPath === undefined) {
        problems.push(`local action could not be resolved: ${match[1]}`);
        continue;
      }
      if (!seen.has(actionPath)) {
        pending.push({ id: actionPath, body: (files[actionPath] ?? "").replace(/^\s*#.*$/gm, "") });
      }
    }
  }
  return {
    executable: chunks.join("\n"),
    packageCommands,
    problems: [...new Set(problems)].sort(),
  };
}
/** Deterministic architecture audit. Every finding is a fail-closed result. */
export function civicDataFirewall(tree: CivicDataFirewallTree): readonly CivicDataFirewallFinding[] {
  const findings: CivicDataFirewallFinding[] = [];
  const add = (code: string, path: string, detail: string) => findings.push({ code, path, detail });
  const registeredDataCommands = [
    ...tree.contracts.map((contract) => contract.acquisitionAdapter.command[0] ?? ""),
    ...tree.manualContracts.map((contract) => contract.command[0] ?? ""),
  ].filter(Boolean);
  const workflowClosureCache = new Map<string, WorkflowExecutableClosure>();
  const expandExecutable = (path: string): WorkflowExecutableClosure => {
    const cached = workflowClosureCache.get(path);
    if (cached !== undefined) return cached;
    const source = stripExecutableComments(tree.files[path] ?? "");
    const closure = /\b(?:pnpm(?:\.cmd)?|npm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.exe)?)\b|\buses\s*:/i.test(source)
      ? workflowExecutableClosure(tree.files, path)
      : { executable: source, packageCommands: [], problems: [] };
    workflowClosureCache.set(path, closure);
    return closure;
  };

  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^\.github\/workflows\/.*\.ya?ml$/.test(path)) continue;
    const workflowExecutable = source.replace(/^\s*#.*$/gm, "");
    const closure = expandExecutable(path);
    for (const problem of closure.problems) {
      add(
        "WORKFLOW_EXECUTABLE_CLOSURE_UNRESOLVED",
        path,
        `The workflow executable closure could not be classified: ${problem}.`,
      );
    }
    const executable = closure.executable;
    const routineData = ROUTINE_DATA_MARKER.test(executable) || registeredDataCommands.some((command) => executable.includes(command));
    const routineOps = ROUTINE_OPS_MARKER.test(executable);
    if (SCHEDULE.test(workflowExecutable) && routineOps) {
      add("SCHEDULED_ROUTINE_OPS_WORKFLOW", path, "A GitHub schedule can invoke routine runtime observation or operational-state work.");
    }
    if (CONTENTS_WRITE.test(workflowExecutable) && routineData) {
      add("ROUTINE_DATA_CONTENTS_WRITE", path, "A routine data workflow carries contents: write.");
    }
    if (CONTENTS_WRITE.test(workflowExecutable) && routineOps) {
      add("ROUTINE_OPS_CONTENTS_WRITE", path, "A routine runtime/operations workflow carries contents: write.");
    }
    if (WORKFLOW_GIT_WRITE.test(executable) && routineData) {
      add("ROUTINE_DATA_GIT_WRITE", path, "A routine data workflow can add, commit, or push mutable repository state.");
    }
    if (WORKFLOW_GIT_WRITE.test(executable) && routineOps) {
      add("ROUTINE_OPS_GIT_WRITE", path, "A routine runtime/operations workflow can add, commit, or push mutable repository state.");
    }
  }

  for (const [path, source] of Object.entries(tree.files)) {
    if (!/^(?:app|components|lib|scripts)\/.*\.[cm]?[jt]sx?$/.test(path) || path === "lib/civic-data/firewall.ts") continue;
    const executable = stripExecutableComments(source);
    if (!["lib/civic-data/promotion.ts", "lib/civic-data/candidate-lifecycle.ts"].includes(path) && /\bprocessRoutineCandidate\b/.test(executable)) {
      add(
        "UNREGISTERED_PRODUCTION_PROMOTION_DOOR",
        path,
        "Executable production code can reach the generic transition driver instead of an exact routine, meeting-partition, or manual contract door.",
      );
    }
  }

  const ids = new Set<string>();
  const authorityKeys = new Map<string, string>();
  const commands = new Set<string>();
  const routineAdaptersReachingManualDoor = new Set<string>();
  const certificationPaths = new Set<string>();
  const releaseInvocationPaths = new Set<string>();
  const repositoryWriterPaths = new Set<string>();
  const executableClosureProblems = new Set<string>();
  const dataCommandClosureCache = new Map<string, ExecutableDependencyClosure>();
  const inspectedDataCommands = new Set<string>();
  const inspectDataCommandClosure = (
    commandPath: string,
    commandKind: "routine" | "manual",
  ): void => {
    // State contracts vary their arguments, but execute the same saved script.
    // Its immutable closure needs the same capability checks once per kind.
    const inspectionKey = `${commandKind}:${commandPath}`;
    if (inspectedDataCommands.has(inspectionKey)) return;
    inspectedDataCommands.add(inspectionKey);
    let closure = dataCommandClosureCache.get(commandPath);
    if (closure === undefined) {
      closure = executableDependencyClosure(tree.files, commandPath, expandExecutable);
      dataCommandClosureCache.set(commandPath, closure);
    }
    for (const problem of closure.problems) {
      const key = `${commandPath}:${problem}`;
      if (executableClosureProblems.has(key)) continue;
      executableClosureProblems.add(key);
      add(
        "DATA_EXECUTABLE_CLOSURE_UNRESOLVED",
        commandPath,
        `The registered data-command closure could not be classified: ${problem}.`,
      );
    }
    for (const { path, executable: expandedExecutable, launchCalls } of closure.nodes) {
      const executable = SHELL_EXECUTABLE.test(path)
        ? stripShellComments(expandedExecutable, path)
        : stripExecutableComments(expandedExecutable);
      const shellSoftwareCertification = SHELL_EXECUTABLE.test(path)
        && SOFTWARE_CERTIFICATION_PAYLOAD.test(executable);
      if (
        !certificationPaths.has(path)
        && (invokesSoftwareCertification(executable, launchCalls) || shellSoftwareCertification)
      ) {
        certificationPaths.add(path);
        add(
          "DATA_PATH_INVOKES_SOFTWARE_CERTIFICATION",
          path,
          `A source acquisition/promotion path reachable from ${commandPath} invokes an application, browser, build, or software-test certification tier.`,
        );
      }
      const releaseCode = commandKind === "routine"
        ? "ROUTINE_PATH_INVOKES_RELEASE"
        : "MANUAL_DATA_PATH_INVOKES_RELEASE";
      const releaseKey = `${releaseCode}:${path}`;
      const shellRelease = SHELL_EXECUTABLE.test(path) && SHELL_RELEASE_INVOCATION.test(executable);
      if (
        !releaseInvocationPaths.has(releaseKey)
        && (invokesReleaseMachinery(executable, launchCalls) || shellRelease)
      ) {
        releaseInvocationPaths.add(releaseKey);
        add(
          releaseCode,
          path,
          `A source acquisition/promotion path reachable from ${commandPath} invokes Git, GitHub, build, browser, or deploy machinery.`,
        );
      }
      const writerCode = commandKind === "routine"
        ? "ROUTINE_PATH_WRITES_REPOSITORY"
        : "MANUAL_DATA_PATH_WRITES_REPOSITORY";
      const writerKey = `${writerCode}:${path}`;
      const shellWriter = SHELL_EXECUTABLE.test(path) && SHELL_FILESYSTEM_MUTATION.test(executable);
      if (
        !repositoryWriterPaths.has(writerKey)
        && (invokesFilesystemMutation(executable) || shellWriter)
      ) {
        repositoryWriterPaths.add(writerKey);
        add(
          writerCode,
          path,
          `A filesystem writer reachable from ${commandPath} can bypass the canonical production data plane.`,
        );
      }
    }
  };
  for (const contract of tree.contracts) {
    if (ids.has(contract.id)) add("DUPLICATE_CONTRACT_ID", "lib/civic-data/contracts.ts", contract.id);
    ids.add(contract.id);
    const authorityKey = `${contract.recordClass}:${contract.scope}`;
    const priorAuthority = authorityKeys.get(authorityKey);
    if (priorAuthority !== undefined) {
      add(
        "MULTIPLE_AUTHORITATIVE_WRITERS",
        "lib/civic-data/contracts.ts",
        `${authorityKey} is claimed by both ${priorAuthority} and ${contract.id}`,
      );
    } else {
      authorityKeys.set(authorityKey, contract.id);
    }
    const commandPath = contract.acquisitionAdapter.command[0] ?? "";
    const commandSignature = contract.acquisitionAdapter.command.join("\u0000");
    if (!commandPath || !Object.hasOwn(tree.files, commandPath)) {
      add("CONTRACT_ADAPTER_MISSING", commandPath || "lib/civic-data/contracts.ts", contract.id);
      continue;
    }
    if (commands.has(commandSignature)) {
      add("MULTIPLE_ROUTINE_MEMBERSHIPS", commandPath, `The exact acquisition command is registered more than once: ${contract.acquisitionAdapter.command.join(" ")}`);
    }
    commands.add(commandSignature);
    if (/^(?:data|lib\/registry)\//.test(contract.canonicalProductionStore)) {
      add("TRACKED_RUNTIME_CANONICAL_STORE", "lib/civic-data/contracts.ts", `${contract.id}: ${contract.canonicalProductionStore}`);
    }
    // A standing-clock scope has exactly one writer. An adapter that can still
    // reach the owner-invoked manual door would give it a second, clockless one.
    if (!routineAdaptersReachingManualDoor.has(commandPath) &&
        /\bprocessRegisteredManualCandidate\b/.test(stripExecutableComments(tree.files[commandPath] ?? ""))) {
      routineAdaptersReachingManualDoor.add(commandPath);
      add(
        "ROUTINE_ADAPTER_REACHES_MANUAL_DOOR",
        commandPath,
        `${contract.id} is clocked by the standing runner; its adapter may promote only through its registered routine door.`,
      );
    }
    inspectDataCommandClosure(commandPath, "routine");
  }

  const manualCommands = new Set<string>();
  const manualWriteContexts = new Set<string>();
  for (const contract of tree.manualContracts) {
    if (ids.has(contract.id)) add("DUPLICATE_CONTRACT_ID", "lib/civic-data/manual-contracts.ts", contract.id);
    ids.add(contract.id);
    const authorityKey = `${contract.recordClass}:${contract.scope}`;
    const priorAuthority = authorityKeys.get(authorityKey);
    if (priorAuthority !== undefined) {
      add(
        "MULTIPLE_AUTHORITATIVE_WRITERS",
        "lib/civic-data/manual-contracts.ts",
        `${authorityKey} is claimed by both ${priorAuthority} and ${contract.id}`,
      );
    } else {
      authorityKeys.set(authorityKey, contract.id);
    }
    const commandPath = contract.command[0] ?? "";
    const commandSignature = contract.command.join("\u0000");
    if (!commandPath || !Object.hasOwn(tree.files, commandPath)) {
      add("CONTRACT_ADAPTER_MISSING", commandPath || "lib/civic-data/manual-contracts.ts", contract.id);
      continue;
    }
    if (manualCommands.has(commandSignature)) {
      add("MULTIPLE_MANUAL_MEMBERSHIPS", commandPath, `The exact owner-invoked command is registered more than once: ${contract.command.join(" ")}`);
    }
    manualCommands.add(commandSignature);
    if (/^(?:data|lib\/registry)\//.test(contract.canonicalProductionStore)) {
      add("TRACKED_RUNTIME_CANONICAL_STORE", "lib/civic-data/manual-contracts.ts", `${contract.id}: ${contract.canonicalProductionStore}`);
    }
    const adapter = tree.files[commandPath] ?? "";
    const executableAdapter = adapter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (!manualWriteContexts.has(commandPath)) {
      manualWriteContexts.add(commandPath);
      const contextAt = executableAdapter.search(/prepareProductionCivicDataWrite\s*\(/);
      const storeAt = executableAdapter.indexOf("new PostgresRoutineDataStore");
      if (contextAt < 0 || (storeAt >= 0 && contextAt > storeAt)) {
        add(
          "MANUAL_PRODUCTION_WRITE_CONTEXT_MISSING",
          commandPath,
          "A production civic-data command must establish and prove its sanctioned write handle before constructing or using the canonical store.",
        );
      }
    }
    inspectDataCommandClosure(commandPath, "manual");
  }

  const packageJson = tree.files["package.json"] ?? "";
  const packageCommand = (name: string): string =>
    new RegExp(`"${name.replace(":", "\\:")}"\\s*:\\s*"([^"]+)"`).exec(packageJson)?.[1] ?? "";

  for (const name of [
    "pilot:run",
    "routine:civic-data",
    "intake:tripwire",
    "pilot:pause-note",
    "freshness:shadow:pg",
    "owner:publish",
    "readiness:publish",
    "console:publish",
    "acs:population",
    "acs:population:promote",
    "dotgov:fetch",
    "fec:fetch",
    "fec:promote",
    "nh:members:promote",
    "outcomes:ingest",
    "ingest",
  ]) {
    if (packageCommand(name) !== "") {
      add("DIRECT_PRODUCTION_CHILD_COMMAND", "package.json", `${name} restores a direct production child outside the installed authority graph.`);
    }
  }
  return findings.sort((a, b) => `${a.code}:${a.path}:${a.detail}`.localeCompare(`${b.code}:${b.path}:${b.detail}`));
}
