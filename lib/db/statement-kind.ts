interface Token { readonly word: string; readonly at: number }
/** SQL tokens outside comments and quoted values. Classification never treats
 * a quoted data value or a comment as a writer or transaction control. */
function scan(sql: string): readonly Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < sql.length;) {
    const tail = sql.slice(at);
    if (/\s/.test(sql[at])) { at++; continue; }
    if (tail.startsWith("--")) { const end = sql.indexOf("\n", at + 2); at = end < 0 ? sql.length : end + 1; continue; }
    if (tail.startsWith("/*")) {
      let depth = 1; at += 2;
      while (at < sql.length && depth) {
        if (sql.startsWith("/*", at)) { depth++; at += 2; }
        else if (sql.startsWith("*/", at)) { depth--; at += 2; }
        else at++;
      }
      continue;
    }
    if (sql[at] === "'" || sql[at] === '"') {
      const quotedAt = at, quote = sql[at++];
      const escaped = quote === "'" && /(?:^|[^A-Za-z_0-9$])E$/i.test(sql.slice(0, quotedAt));
      while (at < sql.length) {
        if (sql[at] === quote) { at++; if (sql[at] !== quote) break; }
        else if (sql[at] === "\\" && escaped) at++;
        at++;
      }
      continue;
    }
    const dollar = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(tail)?.[0];
    if (dollar) { const end = sql.indexOf(dollar, at + dollar.length); at = end < 0 ? sql.length : end + dollar.length; continue; }
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(tail)?.[0];
    if (word) { tokens.push({ word: word.toUpperCase(), at }); at += word.length; continue; }
    tokens.push({ word: sql[at], at }); at++;
  }
  return tokens;
}

/** Strip a terminal delimiter without interpreting semicolons in quoted SQL. */
export function singleStatementText(sql: string): string {
  const tokens = scan(sql), last = tokens.at(-1);
  return (last?.word === ";" ? sql.slice(0, last.at) + sql.slice(last.at + 1) : sql).trim();
}

function mainIndex(tokens: readonly Token[]): number {
  if (tokens[0]?.word !== "WITH") return 0;
  let at = tokens[1]?.word === "RECURSIVE" ? 2 : 1;
  for (;;) {
    let depth = 0;
    // A CTE's name and optional column list precede AS at the outer depth.
    for (; at < tokens.length; at++) {
      const word = tokens[at].word;
      if (word === "(" ) depth++;
      else if (word === ")") depth--;
      else if (depth === 0 && word === "AS") break;
    }
    if (at === tokens.length) return 0;
    at++;
    if (tokens[at]?.word === "NOT") at++;
    if (tokens[at]?.word === "MATERIALIZED") at++;
    if (tokens[at]?.word !== "(") return 0;
    depth = 1; at++;
    while (at < tokens.length && depth) {
      if (tokens[at].word === "(") depth++;
      else if (tokens[at].word === ")") depth--;
      at++;
    }
    if (tokens[at]?.word !== ",") return at;
    at++;
  }
}

/** Keep data-modifying CTEs at PostgreSQL's required top level while the final
 * SELECT participates in the same statement's version comparison. */
export function versionedStatementParts(sql: string): { readonly prefix: string; readonly query: string } {
  let statement = singleStatementText(sql), tokens = scan(statement);
  while (tokens[0]?.word === "(") {
    let depth = 1, at = 1;
    for (; at < tokens.length && depth; at++) {
      if (tokens[at].word === "(") depth++;
      else if (tokens[at].word === ")") depth--;
    }
    if (depth || at !== tokens.length) break;
    statement = statement.slice(tokens[0].at + 1, tokens[at - 1].at).trim();
    tokens = scan(statement);
  }
  const main = mainIndex(tokens);
  if (tokens[0]?.word === "WITH" && main > 0 && ["SELECT", "TABLE", "VALUES"].includes(tokens[main]?.word ?? "")) {
    return { prefix: statement.slice(0, tokens[main].at), query: statement.slice(tokens[main].at) };
  }
  return { prefix: "", query: statement };
}
function isRead(tokens: readonly Token[]): boolean {
  if (tokens[0]?.word === "(") {
    let depth = 1, at = 1;
    for (; at < tokens.length && depth; at++) {
      if (tokens[at].word === "(") depth++;
      else if (tokens[at].word === ")") depth--;
    }
    if (isRead(tokens.slice(1, at - 1))) return true;
    const tail = tokens.slice(at);
    if (["UNION", "INTERSECT", "EXCEPT"].includes(tail[0]?.word ?? "")) {
      return isRead(tail.slice(["ALL", "DISTINCT"].includes(tail[1]?.word ?? "") ? 2 : 1));
    }
    return false;
  }
  const main = mainIndex(tokens), selected = tokens.slice(main).map(token => token.word), first = selected[0];
  if (tokens[0]?.word === "WITH" && (main === 0 || !["SELECT", "TABLE", "VALUES", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(first ?? ""))) return true;
  if (!["SELECT", "TABLE", "VALUES"].includes(first ?? "")) return false;
  let depth = 0;
  for (let at = 1; at < selected.length; at++) {
    const word = selected[at], previous = selected[at - 1];
    if (word === "(") depth++;
    else if (word === ")") depth--;
    else if (first === "SELECT" && depth === 0 && word === "INTO" && at > 1
      && !["AS", ".", ",", "COLLATE"].includes(previous)) return false;
  }
  return true;
}

function assertSupportedExecution(tokens: readonly Token[]): void {
  const first = tokens[0]?.word;
  // These result protocols cannot embed a version comparison. Cursors and
  // prepared SQL must not create another route for stored bodies to return.
  if (["FETCH", "DECLARE", "EXECUTE", "CALL"].includes(first ?? "")) {
    throw new Error(`Database ${first} cannot confirm row versions; use an ordinary query`);
  }
  if (first !== "COPY") return;
  let depth = 0;
  for (const token of tokens.slice(1)) {
    if (token.word === "(") depth++;
    else if (token.word === ")") depth--;
    else if (depth === 0 && token.word === "TO") {
      throw new Error("Database COPY TO cannot confirm row versions; use an ordinary query");
    }
  }
}

/** Writers return their own new values. Control statements do not read stored
 * row bodies. Every read inside a writer transaction uses the same protocol. */
export function readsStoredRows(sql: string): boolean {
  const tokens = [...scan(sql)];
  if (tokens.at(-1)?.word === ";") tokens.pop();
  if (!tokens.some(token => token.word === ";")) {
    assertSupportedExecution(tokens);
    return isRead(tokens);
  }
  const statements: Token[][] = [[]];
  for (const token of tokens) { if (token.word === ";") statements.push([]); else statements.at(-1)!.push(token); }
  statements.forEach(assertSupportedExecution);
  if (statements.some(isRead)) throw new Error("A database row read must contain one SQL statement; use a transaction for multiple statements");
  return false;
}
