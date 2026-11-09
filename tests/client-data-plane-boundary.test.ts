import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";
import ts from "typescript";
import { walkFiles } from "./helpers/walk-files.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ROOTS = ["app", "components", "hooks", "lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs"]);
const FORBIDDEN_RUNTIME_MODULES = new Set([
  "lib/civic-data/curated-reader-read-model.ts",
  "lib/civic-data/read-model.ts",
  "lib/civic-data/runtime-authority.ts",
  "lib/civic-data/store.ts",
  "lib/registry/body-membership.ts",
  "lib/registry/body-rosters.ts",
  "lib/registry/runtime-data-plane.ts",
  "lib/registry/runtime-read-model.ts",
  "lib/registry/server.ts",
]);

const normalizedRelative = (path: string): string =>
  relative(ROOT, path).replaceAll("\\", "/");

function sourceFilesBelow(directory: string): string[] {
  return walkFiles(directory, (name) => SOURCE_EXTENSIONS.has(extname(name)));
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(importer), specifier)
      : null;
  if (!base) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.mts"),
    join(base, "index.mjs"),
  ];
  return candidates.find((candidate) =>
    existsSync(candidate) && statSync(candidate).isFile()
  ) ?? null;
}

function valueImportSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const onlyNamedTypes = clause && !clause.name &&
        clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly);
      if (!clause?.isTypeOnly && !onlyNamedTypes &&
          ts.isStringLiteral(statement.moduleSpecifier)) {
        imports.push(statement.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const onlyNamedTypes = statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.every((element) => element.isTypeOnly);
      if (!statement.isTypeOnly && !onlyNamedTypes &&
          ts.isStringLiteral(statement.moduleSpecifier)) {
        imports.push(statement.moduleSpecifier.text);
      }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return imports;
}

function isClientModule(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const first = source.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) && first.expression.text === "use client");
}

test("use-client modules cannot value-import the server civic-data graph", () => {
  const allFiles = SOURCE_ROOTS.flatMap((directory) =>
    sourceFilesBelow(join(ROOT, directory))
  );
  const clientRoots = allFiles.filter(isClientModule);
  const violations: string[] = [];

  for (const clientRoot of clientRoots) {
    const queue: string[][] = [[clientRoot]];
    const seen = new Set([clientRoot]);
    while (queue.length > 0) {
      const chain = queue.shift()!;
      const current = chain[chain.length - 1];
      for (const specifier of valueImportSpecifiers(current)) {
        if (specifier.startsWith("node:")) {
          violations.push(
            `${chain.map(normalizedRelative).join(" -> ")} -> ${specifier}`,
          );
          continue;
        }
        const dependency = resolveLocalModule(current, specifier);
        if (!dependency || seen.has(dependency)) continue;
        const next = [...chain, dependency];
        const relativeDependency = normalizedRelative(dependency);
        if (FORBIDDEN_RUNTIME_MODULES.has(relativeDependency)) {
          violations.push(next.map(normalizedRelative).join(" -> "));
          continue;
        }
        seen.add(dependency);
        queue.push(next);
      }
    }
  }

  assert.deepEqual(
    [...new Set(violations)].sort(),
    [],
    "A use-client runtime import crossed into server-only civic-data code",
  );
});

test("the real map client entry bundles without Node runtime builtins", async () => {
  const output = await build({
    absWorkingDir: ROOT,
    entryPoints: ["components/map/map-entry.tsx"],
    bundle: true,
    write: false,
    outfile: ".scratch/map-entry-client-boundary.js",
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    logLevel: "silent",
  });
  assert.ok(output.outputFiles.some((file) => file.path.endsWith(".js")));
});
