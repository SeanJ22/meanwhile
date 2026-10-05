import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import ts from "typescript";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Records = Record<string, Json[]>;

const ROOT = process.cwd();
const plan = JSON.parse(readFileSync(join(ROOT, "data/state-holdings/move-plan.json"), "utf8")) as {
  baseSha: string;
  rows: { oldPath: string; newPath: string; consumerPath?: string; sha256: string }[];
};

/**
 * These hashes were measured from the immutable session-base exports before
 * extraction. They keep the parity proof active in shallow CI clones, where
 * the original Git object may not exist. A full clone additionally reconstructs
 * the original values through the restricted literal reader below.
 */
const CONTRACTS = [
  {
    path: "data/states/az/officials/cawcd-rosters.json",
    counts: { AZ_CAWCD_ROSTERS: 1 },
    members: 15,
    recordsSha256: "7b2da6ff3c1486cb08cdac21c684811f616fba846ae04f899051f7a3c649111a",
    commentarySha256: "b45a3a3e6e0be35b9b62bf617c5cfe833753f3a110a8d099a81d4d970457d153",
  },
  {
    path: "data/states/az/officials/body-compositions.json",
    counts: { BODY_COMPOSITIONS: 6 },
    recordsSha256: "79a4b1247843b9dfb8ce5ad35f9a554806ca6aa58dcbfc29b8a3394d17343a02",
    commentarySha256: "3208fefb2164e5efdcb8947b143db3ac347684a3d4a18d7f7d8ad15f97d1045e",
  },
  {
    path: "data/states/az/ballot/measure-summaries.json",
    counts: { MEASURE_SUMMARIES: 11 },
    recordsSha256: "b3f42d29406ae21765ab9c484ac2d5680f724f94be059d776321dbab238ee0c0",
    commentarySha256: "088e0e484f96300b409dc88808c3394cda902c8e6d28cbfeb26407d0276587b3",
  },
  {
    path: "data/states/az/reference/body-blurbs.json",
    counts: { BODY_BLURBS: 2, DIVISION_BODY_BLURBS: 1 },
    recordsSha256: "9337ee6a0736d8df30c62d51dc4f080a292296b4fbe922f763744ef61844a27b",
    commentarySha256: "4b2cf31962c74870473e6eb37eff85cda036ce55d9edbf6ebf3178444cda3200",
  },
] as const;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Already-merged source changes are preserved without rewriting the session-base contract. */
const MEASURE_PATH = "data/states/az/ballot/measure-summaries.json";
const MEASURE_INTEGRATION = {
  commit: "eb31f84a7774e8c364c59155eba581ba0fa10b59",
  sourceSha256: "486fa01859ff9150ef1c9b4f14c8fa64f49b4ed6864fb5a0d1a940b94725078b",
  recordsSha256: "1e337a4c97bbaac99a59c33b973e142b45240266295ccd81ddf77ed3f4e4f8d6",
  baseRecordCount: 11,
  addedRecordCount: 4,
  recordCount: 15,
  addedContestIds: [
    "ballot-az-pima:prop-425",
    "ballot-az-pima:prop-423",
    "ballot-az-pima:prop-428",
    "ballot-az-pima:prop-429",
  ],
} as const;

function measureId(record: Json): string {
  assert.ok(record !== null && typeof record === "object" && !Array.isArray(record));
  assert.equal(typeof record.contestId, "string");
  return record.contestId as string;
}

function frozenBaseRecords(path: string, records: Records): Records {
  if (path !== MEASURE_PATH) return records;
  const additions = new Set<string>(MEASURE_INTEGRATION.addedContestIds);
  return {
    MEASURE_SUMMARIES: records.MEASURE_SUMMARIES.filter((record) => !additions.has(measureId(record))),
  };
}

/** Read data expressions; imports, property access, arbitrary calls and statements cannot execute. */
function literalRecords(source: string, symbols: readonly string[]): Records {
  const ast = ts.createSourceFile("baseline.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, ts.Expression>();
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        declarations.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  const resolving = new Set<string>();
  const constants = new Map<string, Json>();

  function read(node: ts.Expression, scope: Record<string, Json> = {}): Json {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return read(node.expression, scope);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => read(element, scope));
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(node.properties.map((property) => {
        assert.ok(ts.isPropertyAssignment(property), "Only literal property assignments are accepted");
        assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name), "Computed keys are not accepted");
        return [property.name.text, read(property.initializer, scope)];
      }));
    }
    if (ts.isIdentifier(node)) {
      if (Object.hasOwn(scope, node.text)) return scope[node.text];
      if (constants.has(node.text)) return constants.get(node.text)!;
      assert.ok(!resolving.has(node.text), "Cyclic data constant");
      const initializer = declarations.get(node.text);
      assert.ok(initializer, `Unknown data constant ${node.text}`);
      resolving.add(node.text);
      const value = read(initializer);
      resolving.delete(node.text);
      constants.set(node.text, value);
      return value;
    }
    if (ts.isTemplateExpression(node)) {
      return node.head.text + node.templateSpans.map((span) => String(read(span.expression, scope)) + span.literal.text).join("");
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = read(node.left, scope);
      const right = read(node.right, scope);
      if (typeof left === "string" || typeof right === "string") return String(left) + String(right);
      assert.ok(typeof left === "number" && typeof right === "number", "Only scalar addition is accepted");
      return left + right;
    }
    // The CAWCD source uses one local, expression-only URL formatter. Read its
    // AST with a local binding; do not call JavaScript or permit other callees.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "page") {
      const formatter = declarations.get("page");
      assert.ok(formatter && ts.isArrowFunction(formatter) && !ts.isBlock(formatter.body));
      assert.equal(formatter.parameters.length, 1);
      assert.equal(node.arguments.length, 1);
      const parameter = formatter.parameters[0].name;
      assert.ok(ts.isIdentifier(parameter));
      return read(formatter.body, { ...scope, [parameter.text]: read(node.arguments[0], scope) });
    }
    assert.fail(`Not a permitted data expression: ${ts.SyntaxKind[node.kind]}`);
  }

  return Object.fromEntries(symbols.map((symbol) => {
    const initializer = declarations.get(symbol);
    assert.ok(initializer, `Missing data export ${symbol}`);
    const value = read(initializer);
    assert.ok(Array.isArray(value));
    return [symbol, value];
  }));
}

function sourceCommentary(source: string): string[] {
  const ast = ts.createSourceFile("baseline.ts", source, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    for (const at of [node.pos, node.end]) {
      for (const range of [...(ts.getLeadingCommentRanges(source, at) ?? []), ...(ts.getTrailingCommentRanges(source, at) ?? [])]) {
        ranges.set(range.pos, range);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...ranges.values()].sort((a, b) => a.pos - b.pos).map((range) => source.slice(range.pos, range.end));
}

for (const contract of CONTRACTS) {
  test(`canonical JSON preserves session-base records and commentary: ${contract.path}`, () => {
    const row = plan.rows.find((candidate) => candidate.newPath === contract.path);
    assert.ok(row?.consumerPath, "The extraction and its distinct consumer must be planned");
    assert.equal(existsSync(join(ROOT, row.oldPath)), false, "The old canonical holding path must disappear");
    const data = JSON.parse(readFileSync(join(ROOT, contract.path), "utf8")) as {
      schemaVersion: number;
      state: string;
      source: { baseSha: string; sourceSha256: string; recordsSha256: string };
      records: Records;
      commentary: string[];
    };
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.state, "AZ");
    assert.equal(data.source.baseSha, plan.baseSha);
    assert.equal(data.source.sourceSha256, row.sha256);
    assert.equal(data.source.recordsSha256, contract.recordsSha256);
    const frozenRecords = frozenBaseRecords(contract.path, data.records);
    assert.equal(hash(JSON.stringify(frozenRecords)), contract.recordsSha256);
    assert.equal(hash(JSON.stringify(data.commentary)), contract.commentarySha256);
    assert.deepEqual(Object.keys(data.records), Object.keys(contract.counts));
    for (const [symbol, count] of Object.entries(contract.counts)) assert.equal(frozenRecords[symbol].length, count);
    if ("members" in contract) {
      const rosters = data.records.AZ_CAWCD_ROSTERS as { members: Json[] }[];
      assert.equal(rosters.reduce((sum, roster) => sum + roster.members.length, 0), contract.members);
    }
    const consumer = readFileSync(join(ROOT, row.consumerPath), "utf8");
    if (contract.path === MEASURE_PATH) {
      // CA-24 moves runtime descriptions into source-bound ballot records. The
      // historical extraction remains frozen and every held description survives.
      const seed = JSON.parse(readFileSync(join(ROOT, "data/ballot/measure-records-first-seed.json"), "utf8")) as {
        contestId: string; whatItDoes: string; sourceUrl: string; writtenAt: string; citation?: string;
      }[];
      assert.deepEqual(seed.map(record => ({
        contestId: record.contestId, summary: record.whatItDoes,
        summarizesUrl: record.sourceUrl, writtenAt: record.writtenAt,
        ...(record.citation === "measure-source" ? { citation: record.citation } : {}),
      })), data.records.MEASURE_SUMMARIES);
      assert.match(consumer, /currentMeasureRecords/);
    } else {
      const importPath = relative(dirname(row.consumerPath), contract.path).replaceAll("\\", "/");
      assert.ok(consumer.includes(JSON.stringify(importPath)), "The generic consumer must import the new canonical JSON");
      for (const symbol of Object.keys(contract.counts)) assert.ok(consumer.includes(`HOLDINGS.records.${symbol}`));
    }

    const object = `${plan.baseSha}:${row.oldPath}`;
    const baseAvailable = spawnSync("git", ["cat-file", "-e", object], { cwd: ROOT, stdio: "pipe" }).status === 0;
    if (baseAvailable) {
      const source = execFileSync("git", ["show", object], { cwd: ROOT, encoding: "utf8", maxBuffer: 2_000_000 });
      assert.equal(hash(source), row.sha256);
      assert.deepEqual(frozenRecords, literalRecords(source, Object.keys(contract.counts)));
      assert.deepEqual(data.commentary, sourceCommentary(source));
    }
  });
}

test("upstream measure integration preserves all 15 records and the unchanged frozen 11", () => {
  const row = plan.rows.find((candidate) => candidate.newPath === MEASURE_PATH);
  assert.ok(row);
  const data = JSON.parse(readFileSync(join(ROOT, MEASURE_PATH), "utf8")) as {
    source: { integratedUpdate: typeof MEASURE_INTEGRATION };
    records: Records;
  };
  assert.deepEqual(data.source.integratedUpdate, MEASURE_INTEGRATION);
  assert.deepEqual(Object.keys(data.records), ["MEASURE_SUMMARIES"]);
  assert.equal(hash(JSON.stringify(data.records)), MEASURE_INTEGRATION.recordsSha256);
  assert.equal(data.records.MEASURE_SUMMARIES.length, MEASURE_INTEGRATION.recordCount);
  const contract = CONTRACTS.find((candidate) => candidate.path === MEASURE_PATH)!;
  const frozenRecords = frozenBaseRecords(MEASURE_PATH, data.records);
  assert.equal(frozenRecords.MEASURE_SUMMARIES.length, MEASURE_INTEGRATION.baseRecordCount);
  assert.equal(hash(JSON.stringify(frozenRecords)), contract.recordsSha256);
  const baseIds = new Set(frozenRecords.MEASURE_SUMMARIES.map(measureId));
  const additions = data.records.MEASURE_SUMMARIES.filter((record) => !baseIds.has(measureId(record)));
  assert.equal(additions.length, MEASURE_INTEGRATION.addedRecordCount);
  assert.deepEqual(additions.map(measureId), MEASURE_INTEGRATION.addedContestIds);
  for (const record of additions) {
    assert.ok(record !== null && typeof record === "object" && !Array.isArray(record));
    assert.equal(record.citation, "measure-source");
  }

  const object = `${MEASURE_INTEGRATION.commit}:${row.oldPath}`;
  const source = execFileSync("git", ["show", object], { cwd: ROOT, encoding: "utf8", maxBuffer: 2_000_000 });
  assert.equal(hash(source), MEASURE_INTEGRATION.sourceSha256);
  assert.deepEqual(data.records, literalRecords(source, ["MEASURE_SUMMARIES"]));
});

test("the baseline record reader refuses executable or imported expressions", () => {
  assert.throws(() => literalRecords("export const ROWS = fetch('https://example.invalid');", ["ROWS"]), /Not a permitted data expression/);
  assert.throws(() => literalRecords("export const ROWS = process.env;", ["ROWS"]), /Not a permitted data expression/);
});
