import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { NOTICE_SUMMARIES, noticeSummaryFor } from "../lib/meetings/notice-summary.ts";
import { findClient, findVenue } from "../lib/sources/legistar/client-registry.ts";
import { findTenant, findTenantVenue } from "../lib/sources/legistar-insite/tenant-registry.ts";

const ROOT = join(import.meta.dirname, "..");
const plan = JSON.parse(readFileSync(join(ROOT, "data/state-holdings/move-plan.json"), "utf8")) as {
  baseSha: string;
  rows: { oldPath: string; newPath: string; sha256: string }[];
};

/** Only the literal data forms present in these three held arrays are accepted. */
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    assert.ok(ts.isNumericLiteral(node.operand));
    return -Number(node.operand.text);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      assert.ok(ts.isPropertyAssignment(property));
      assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name));
      return [property.name.text, literal(property.initializer)];
    }));
  }
  throw new Error(`Nonliteral held value: ${node.getText()}`);
}

function property(object: ts.Expression, name: string): ts.Expression {
  assert.ok(ts.isObjectLiteralExpression(object));
  const found = object.properties.find((item) =>
    ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === name);
  assert.ok(found && ts.isPropertyAssignment(found), `missing ${name}`);
  return found.initializer;
}

function arrayInitializer(source: ts.SourceFile, symbol: string): ts.ArrayLiteralExpression {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === symbol) found = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found && ts.isArrayLiteralExpression(found), `missing literal ${symbol}`);
  return found;
}

function commentary(source: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const comments: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) comments.push(scanner.getTokenText());
  }
  return comments;
}

const cases = [
  { file: "notice-summaries.json", symbol: "NOTICE_SUMMARIES", record: "NOTICE_SUMMARIES", slug: null, count: 1 },
  { file: "legistar-venues.json", symbol: "LEGISTAR_CLIENTS", record: "LEGISTAR_CLIENT_VENUES", slug: "pima", count: 2 },
  { file: "insite-venues.json", symbol: "INSITE_TENANTS", record: "INSITE_TENANT_VENUES", slug: "mesa", count: 1 },
];

for (const entry of cases) {
  test(`${entry.file}: every held row and source comment equals the frozen base`, () => {
    const path = `data/states/az/meetings/${entry.file}`;
    const row = plan.rows.find((candidate) => candidate.newPath === path);
    assert.ok(row, `${path}: missing from the finite move plan`);
    const base = execFileSync("git", ["show", `${plan.baseSha}:${row.oldPath}`], { cwd: ROOT, encoding: "utf8" });
    const parsed = ts.createSourceFile("base.ts", base, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const initializer = arrayInitializer(parsed, entry.symbol);
    let selected: ts.Expression = initializer;
    if (entry.slug) {
      const owner = initializer.elements.find((item) => literal(property(item, "slug")) === entry.slug);
      assert.ok(owner, `${entry.slug}: missing base record`);
      selected = property(owner, "venues");
    }
    const baseRows = literal(selected);
    assert.ok(Array.isArray(baseRows));
    assert.equal(baseRows.length, entry.count);
    const held = JSON.parse(readFileSync(join(ROOT, path), "utf8")) as {
      schemaVersion: number; state: string; source: { baseSha: string; sourceSha256: string };
      commentary: string[]; records: Record<string, unknown>;
    };
    assert.equal(held.schemaVersion, 1);
    assert.equal(held.state, "AZ");
    assert.equal(held.source.baseSha, plan.baseSha);
    assert.equal(held.source.sourceSha256, row.sha256);
    assert.equal(createHash("sha256").update(base).digest("hex"), row.sha256);
    assert.deepEqual(held.commentary, commentary(base));
    assert.deepEqual(held.records, { [entry.record]: entry.slug ? { [entry.slug]: baseRows } : baseRows });
  });
}

test("meeting consumers read held rows and retain version and venue matching", () => {
  assert.equal(NOTICE_SUMMARIES.length, 1);
  const notice = NOTICE_SUMMARIES[0];
  assert.strictEqual(noticeSummaryFor(notice.meetingId, notice.contentHash), notice);
  assert.equal(noticeSummaryFor(notice.meetingId, "changed-document-version"), null);
  const pima = findClient("pima");
  const mesa = findTenant("mesa");
  assert.ok(pima && mesa);
  assert.equal(pima.venues.length, 2);
  assert.equal(mesa.venues.length, 1);
  assert.strictEqual(findTenant("pima")?.venues, pima.venues, "Pima InSite must derive the held Legistar venues");
  for (const venue of pima.venues) assert.strictEqual(findVenue(pima, venue.match.toUpperCase()), venue);
  assert.strictEqual(findTenantVenue(mesa, "COUNCIL CHAMBERS"), mesa.venues[0]);
  assert.equal(findTenantVenue(mesa, "unrecorded room"), undefined);
});
