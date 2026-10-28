/** The feedback privacy rule, shared by lint and the built-client tests. */
export const PERSONAL_EMAIL = ["seanj22", "gmail.com"].join("@");
// The outbound geocoder User-Agent remains the sole server-only exemption.
const SERVER_ONLY_ALLOWED = new Set(["lib/geo/outbound-agent.ts"]);

function decoded(source: string): string {
  return source.toLowerCase().replace(/\\u([\da-f]{4})|\\x([\da-f]{2})/g, (_, u, x) => String.fromCharCode(parseInt(u ?? x, 16)))
    .replace(/&#(?:x([\da-f]+)|(\d+));/g, (_, x, d) => String.fromCharCode(parseInt(x ?? d, x ? 16 : 10)))
    .replace(/%([\da-f]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16)))
    .replace(/[\s"'`+\\]/g, "");
}

/** Pass source paths or built static chunk paths; no address is printed in a failure. */
export function browserEmailLeaks(files: Iterable<readonly [string, string]>): string[] {
  const hits: string[] = [];
  for (const [file, source] of files) {
    if (!/^(?:app|components|hooks|lib|public|data|netlify|\.next\/static)\//.test(file) || SERVER_ONLY_ALLOWED.has(file)) continue;
    if (!/@|\\[ux]|&#|%[\da-f]{2}/i.test(source)) continue;
    if (decoded(source).includes(PERSONAL_EMAIL)) hits.push(file);
  }
  return hits;
}
