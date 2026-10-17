/** Row persistence must finish independently of our read/response deadlines. */
export function statementWritesRows(text: string): boolean {
  const statement = text.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|\$([A-Za-z_]\w*|)\$[\s\S]*?\$\1\$|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,
    " ",
  );
  // Schema/bootstrap and session commands keep their existing readback limits.
  if (/^\s*(?:CREATE|ALTER|DROP|DO|GRANT|REVOKE)\b/i.test(statement)) return false;
  return /(?:^|[;()])\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(statement);
}
