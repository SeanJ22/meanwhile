export class EgressRefusal extends Error {}

/** Refuses any URL that is not a public http(s) address, before it is fetched. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressRefusal(`not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new EgressRefusal(`rung 5 carries http(s) only, never ${url.protocol} — ${raw}`);
  }
  if (url.username || url.password) {
    throw new EgressRefusal(
      `rung 5 refuses a URL carrying credentials. Nothing authenticated goes through a relay.`,
    );
  }
  const host = url.hostname.toLowerCase();
  const ipv4=host.split('.').map(Number);
  const ipv6=host.replace(/^\[|\]$/g,'');
  const private_ =
    host === '0.0.0.0' ||
    (ipv4.length===4 && ipv4.every(n=>Number.isInteger(n) && n>=0 && n<=255) && (ipv4[0]===0 || ipv4[0]===169 && ipv4[1]===254 || ipv4[0]===100 && ipv4[1]>=64 && ipv4[1]<=127 || ipv4[0]>=224)) ||
    ipv6==='::' || ipv6==='::1' || /^(?:fc|fd|fe[89ab]|::ffff:)/i.test(ipv6) ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (private_) {
    throw new EgressRefusal(`rung 5 refuses a private host (${host}) — it reaches public records only`);
  }
  return url;
}
