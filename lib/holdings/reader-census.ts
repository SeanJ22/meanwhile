// Source import reachability used by structural tests. The release census is retired.

import { createHash } from "node:crypto";

import { existsSync, readFileSync } from "node:fs";

import * as fs from "node:fs";

import { join, posix } from "node:path";

import ts from "typescript";

const unique = (values: readonly string[]) => [...new Set(values)].sort();

export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export interface ImportReachability {
  readonly surfacePath: string;
  readonly consumerPath: string;
  readonly reached: boolean;
  readonly path: readonly string[];
}

function resolveImport(root: string, importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const relative = specifier.startsWith("@/") ? specifier.slice(2) : posix.normalize(posix.join(posix.dirname(importer), specifier));
  return [relative, `${relative}.ts`, `${relative}.tsx`, `${relative}.json`, `${relative}/index.ts`, `${relative}/index.tsx`].find((path) => existsSync(join(root, path))&&fs.statSync(join(root,path)).isFile()) ?? null;
}

function literalPrefix(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return literalPrefix(node.left);
  return null;
}

const edgeCache = new Map<string, readonly string[]>();

const apiRouteCache = new Map<string, string[]>();

function apiRoutePaths(root: string): string[] {
  const prior = apiRouteCache.get(root); if (prior) return prior;
  const { globSync } = fs as typeof fs & { globSync(pattern: string, options: { cwd: string }): string[] };
  const paths = globSync("app/api/**/route.ts", { cwd: root }).map((path) => path.replaceAll("\\", "/"));
  apiRouteCache.set(root, paths); return paths;
}

function sourceEdges(root: string, importer: string, source: string): readonly string[] {
  const key = `${root}:${importer}:${sha256(source)}`;
  const cached = edgeCache.get(key);
  if (cached) return cached;
  const edges: string[] = [];
  const tree = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true, importer.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function walk(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly || Boolean(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.length && node.importClause.namedBindings.elements.every((specifier) => specifier.isTypeOnly) && !node.importClause.name) : node.isTypeOnly;
      if (!typeOnly) { const path = resolveImport(root, importer, node.moduleSpecifier.text); if (path) edges.push(path); }
    }
    if (ts.isCallExpression(node)) {
      const prefix = literalPrefix(node.arguments[0]);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && prefix) { const path = resolveImport(root, importer, prefix); if (path) edges.push(path); }
      if (ts.isIdentifier(node.expression) && node.expression.text === "fetch" && prefix?.startsWith("/api/")) {
        const requested = prefix.split("?")[0];
        const literalRoute = `app${requested.replace(/\/$/, "")}/route.ts`;
        if (existsSync(join(root, literalRoute))) edges.push(literalRoute);
        for (const path of apiRoutePaths(root)) {
          const route = path.replace(/^app/, "").replace(/\/route\.ts$/, "");
          const fixedPrefix = route.split("[")[0];
          if (route.includes("[") ? requested.startsWith(fixedPrefix) : requested === route) edges.push(path);
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  const result = unique(edges);
  edgeCache.set(key, result);
  return result;
}

export function importReachability(root: string, surfacePath: string, consumerPath: string, read = (path: string) => readFileSync(join(root, path), "utf8")): ImportReachability {
  const queue: string[][] = [[surfacePath]];
  const seen = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    if (current === consumerPath) return { surfacePath, consumerPath, reached: true, path };
    if (seen.has(current) || !/\.(?:ts|tsx|js|mjs|mts)$/.test(current)) continue;
    seen.add(current);
    if (!existsSync(join(root, current))) continue;
    const source = read(current);
    for (const next of sourceEdges(root, current, source)) if (!seen.has(next)) queue.push([...path, next]);
  }
  return { surfacePath, consumerPath, reached: false, path: [] };
}
