import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ROOTS = ["lib", "app", "components", "hooks", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DIVISION_ID_MODULE = "lib/census-geography/division-id.ts";
const CENSUS_DECLARATIONS = new Set([
  "lib/census-geography/contract.ts",
  "lib/census-geography/dataset.ts",
]);
const relativePath = (path: string): string => relative(ROOT, path).replaceAll("\\", "/");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

function censusOcdIdReads(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const violations: string[] = [];
  const censusType = (type: ts.Type): boolean => {
    if (type.isUnionOrIntersection()) return type.types.some(censusType);
    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint && constraint !== type) return censusType(constraint);
    const property = checker.getPropertyOfType(type, "ocdId");
    if (property?.declarations?.some(declaration => CENSUS_DECLARATIONS.has(relativePath(declaration.getSourceFile().fileName)))) return true;
    // Inferred copies and anonymous grouping types retain the Census shape,
    // even when their property declarations no longer point to the contract.
    return ["ocdId", "geoid", "label", "stateFips", "stateAbbr", "memberStates"]
      .every(name => checker.getPropertyOfType(type, name));
  };
  const keyValue = (node: ts.Node): string | undefined => {
    if (ts.isStringLiteralLike(node)) return node.text;
    const type = checker.getTypeAtLocation(node);
    return type.isStringLiteral() ? type.value : undefined;
  };
  const propertyName = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
    return ts.isComputedPropertyName(node) ? keyValue(node.expression) : undefined;
  };
  const report = (node: ts.Node): void => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${relativePath(source.fileName)}:${line + 1}:${character + 1} ${node.getText(source)}`);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isPropertyAccessExpression(node) && node.name.text === "ocdId") ||
        (ts.isElementAccessExpression(node) && keyValue(node.argumentExpression) === "ocdId")) {
      const parent = node.parent;
      const writeOnly = ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      // Copying a raw field into another Census reference is serialization,
      // not a consumer choosing the reader's division identity.
      const rawFieldCopy = ts.isPropertyAssignment(parent) && parent.initializer === node &&
        propertyName(parent.name) === "ocdId" && censusType(checker.getTypeAtLocation(parent.parent));
      if (!writeOnly && !rawFieldCopy && censusType(checker.getTypeAtLocation(node.expression))) report(node);
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) &&
               propertyName(node.propertyName ?? node.name) === "ocdId" && censusType(checker.getTypeAtLocation(node.parent))) {
      report(node);
    } else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
               propertyName(node.name) === "ocdId" && ts.isObjectLiteralExpression(node.parent)) {
      const assignment = node.parent.parent;
      if (ts.isBinaryExpression(assignment) && assignment.left === node.parent &&
          assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && censusType(checker.getTypeAtLocation(assignment.right))) report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

test("Census consumers derive division identities through censusWorkDivision", () => {
  const files = SOURCE_ROOTS.flatMap(directory => sourceFiles(join(ROOT, directory)));
  const config = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const examplePath = join(ROOT, "tests", "census-division-ref.guard-example.ts");
  const example = `
import type { GeographyRef as CensusRef } from "../lib/census-geography/contract.ts";
import type { BuiltGrouping } from "../lib/census-geography/dataset.ts";
import type { Division } from "../lib/registry/types.ts";
declare const ref: CensusRef;
declare const grouping: Omit<BuiltGrouping, "overlaps">;
declare const division: Division;
const alias = ref;
alias.ocdId;
ref["ocdId"];
const field = "ocdId" as const;
ref[field];
const { ocdId: extracted } = ref;
function read({ ocdId }: CensusRef) { return ocdId; }
let assigned: string | null;
({ ocdId: assigned } = ref);
const picked: Pick<CensusRef, "ocdId"> = ref;
picked.ocdId;
grouping.ocdId;
const inferred = { ...ref };
inferred.ocdId;
inferred.ocdId = null;
division.ocdId;
const copied: CensusRef = { ...ref, ocdId: grouping.ocdId };
`;
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === examplePath
    ? ts.createSourceFile(path, example, languageVersion, true)
    : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...files, examplePath], { ...options, incremental: false }, host);
  const checker = program.getTypeChecker();
  const exampleReads = censusOcdIdReads(program.getSourceFile(examplePath)!, checker).map(line => line.split(" ").slice(1).join(" "));
  assert.deepEqual(exampleReads, [
    "alias.ocdId", 'ref["ocdId"]', "ref[field]", "ocdId: extracted", "ocdId",
    "ocdId: assigned", "picked.ocdId", "grouping.ocdId", "inferred.ocdId",
  ], "the guard must recognize aliases, computed keys, destructuring, mapped types, and inferred Census copies without rejecting writes or registry divisions");
  const violations = files.filter(path => relativePath(path) !== DIVISION_ID_MODULE).flatMap(path =>
    censusOcdIdReads(program.getSourceFile(path)!, checker));
  assert.deepEqual(violations, [], "Use censusWorkDivision(ref); a Census district's raw ocdId may be null.");
});
