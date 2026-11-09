import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { walkFiles } from "./helpers/walk-files.ts";

function componentFiles(directory: string): string[] {
  return walkFiles(directory, (name) => /\.[jt]sx?$/.test(name));
}

test("only the shared card footer renders Sources, and field components cannot use WorkingOnIt", () => {
  const violations: string[] = [];
  const standaloneGaps = new Set(["components/demand/working-on-it.tsx", "components/ask/ask-box.tsx", "components/ask/ballot-ask.tsx"]);
  for (const file of [...componentFiles("components"), ...componentFiles("app")]) {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === "WorkingOnIt" && !standaloneGaps.has(file)) {
        violations.push(`${file}: WorkingOnIt belongs only on the standalone Ask surfaces`);
      }
      if (file !== "components/ui/card-footer.tsx") {
        if (ts.isJsxAttribute(node) && node.initializer) {
          const literal = ts.isStringLiteral(node.initializer) ? node.initializer.text
            : ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isStringLiteral(node.initializer.expression) ? node.initializer.expression.text : null;
          if (["title", "label", "aria-label"].includes(node.name.getText(source)) && literal === "Sources") {
            violations.push(`${file}: Sources disclosure belongs to the card frame`);
          }
        }
        if (ts.isJsxElement(node) && ["summary", "button"].includes(node.openingElement.tagName.getText(source)) && node.children.some(child => ts.isJsxText(child) && child.text.trim() === "Sources")) {
          violations.push(`${file}: Sources disclosure belongs to the card frame`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual([...new Set(violations)], []);
});
