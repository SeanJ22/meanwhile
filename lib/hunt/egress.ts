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
  const private_ =
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
