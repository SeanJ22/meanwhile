#!/usr/bin/env node
// Claude Code PreToolUse hook: agents never change docs/rulings.md. Exit 2 refuses the tool call.

import { readFileSync } from "node:fs";

const RULINGS = "docs/rulings.md";
const NAMES_RULINGS = /docs\/rulings\.md\b/;

// Shell forms that write, move, delete or restore a named file.
const WRITES = [
  />{1,2}\s*["']?(\.\/)?docs\/rulings\.md\b/,
  /\b(tee|truncate|rm|unlink|mv|cp|install|dd|touch|chmod|chown)\b[^|;&]*docs\/rulings\.md/,
  /\b(sed|perl)\b[^|;&]*\s-[a-zA-Z]*i[^|;&]*docs\/rulings\.md/,
  /\bgit\s+(?:[^\s;&|]+\s+){0,4}?(checkout|restore|rm|mv|apply|am)\b[^|;&]*docs\/rulings\.md/,
  /writeFile(Sync)?\([^)]*docs\/rulings\.md/,
];

export function touchesRulings(input) {
  const tool = input?.tool_name ?? input?.toolName ?? "";
  const args = input?.tool_input ?? input?.toolInput ?? {};
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    const path = String(args.file_path ?? args.notebook_path ?? "").replace(/\\/g, "/");
    return path === RULINGS || path.endsWith("/" + RULINGS);
  }
  const command = String(args.command ?? "");
  return NAMES_RULINGS.test(command) && WRITES.some((re) => re.test(command));
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  if (touchesRulings(input)) {
    process.stderr.write(
      "Refused: docs/rulings.md is Sean's rulebook. Only Sean edits it, and he uploads every change himself. " +
        "Read it; never change, move, delete or restore it.\n",
    );
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("guard-protected-files.mjs")) main();
