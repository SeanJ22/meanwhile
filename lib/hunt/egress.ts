/**
 * **RUNG 5, MADE AVAILABLE TO A HUNT** — a different EGRESS for a page this
 * network is refused. (Built 2026-08-21, NH Hunt 2. RETIRED 2026-09-25: see
 * `readViaEgress` below. `assertPublicUrl` is the part every fetcher still
 * uses.)
 *
 * ## The wall this exists for, and the two walls it does not
 *
 * `CLAUDE.md`'s rung 5 is g3's finding stated as a rule: a rung is
 * `(client, headers, URL, egress)`, and a refusal aimed at where the request
 * COMES FROM is not a header problem. Two of those refusals were standing open
 * in this repo when this was written, both with rung 5 recorded as owed and
 * nothing that could walk it:
 *
 * - `kearsarge.org` (tracker `NH01`) — a Cloudflare managed challenge that
 *   rung 6 loads and never clears: *"Incompatible browser extension or network
 *   configuration."* Nine school-board members were being served to readers off
 *   a read that could not be refreshed.
 * - `hopkinton-nh.gov` and its vendor host `hopkintonnh.pt7.civic-cms.com` —
 *   the same challenge, on a town whose own `/people/<name>` page is the
 *   specific verified page a candidate hunt needs.
 *
 * Both fall to this in one call. Neither fell to rungs 2, 3, 4 or 6.
 *
 * ## What this is NOT, stated plainly because the line matters
 *
 * It is **not residential-proxy spoofing**, which `CLAUDE.md` prohibits
 * outright and which this may never become. It is a public, identified reader
 * service fetching a public URL from its own datacentre address and returning
 * the page as text. Nothing pretends to be a person's home connection.
 *
 * It **authenticates nothing** and **circumvents no access control**. There is
 * no login, no paywall, no clickwrap. A bot-management challenge on a public
 * record is the friction `CLAUDE.md`'s public-records rule names as structural
 * and deliberate — rung 6 exists in this product precisely to clear one by
 * executing the JavaScript it asks for, and this is the same act from a
 * different address.
 *
 * It sends **only a public URL**. No user data, no credentials, no cookies, no
 * headers of ours travel with it. `assertPublicUrl` refuses anything else
 * rather than trusting a caller.
 *
 * ## The provenance cost, stated rather than buried
 *
 * What comes back is the reader service's MARKDOWN RENDERING of the page, not
 * the bytes the origin sent. That is a real difference and it is why every
 * result carries `viaEgress: true` and the reader's URL alongside the origin
 * URL. A fact read this way is cited to the ORIGIN — that is the document that
 * exists — and the retrieval note says which route reached it, so a later
 * session can tell a first-hand read from a relayed one. It is therefore the
 * wrong rung for anything where the exact bytes are the evidence: a
 * `contentHash`, an `.ics` feed, a PDF. Those stop at rung 4 or go to rung 11.
 */

const READER = "https://r.jina.ai/";

/** How long to wait between calls, so a hunt cannot become a load test. */
export const EGRESS_SPACING_MS = 2_000;

export interface EgressResult {
  /** The URL the fact should be cited to — the origin, always. */
  url: string;
  /** The route that actually reached it, recorded so a relay is never read as a first-hand fetch. */
  readerUrl: string;
  status: number;
  text: string;
  bytes: number;
  /** Always true. It exists so a consumer cannot forget which route this came from. */
  viaEgress: true;
}

export class EgressRefusal extends Error {}

/**
 * A public `http(s)` URL, and nothing else, ever.
 *
 * The refusals are deliberately blunt. Credentials in a URL, a non-web scheme,
 * or a loopback/private host are each a way for something that is not a public
 * record to be handed to a third party, and a hunt calling this in a loop is
 * exactly where that would go unnoticed.
 */
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

/**
 * **RETIRED 2026-09-25: a different egress to get past a refusal is bypassing an
 * access control.**
 *
 * This rung sent a public URL to a third-party reader service so the page was
 * fetched from that service's addresses instead of ours. It was built for hosts
 * that answer this project with a bot-management challenge (`kearsarge.org`,
 * `hopkinton-nh.gov`), and it worked because the challenge was aimed at where
 * the request came from. Sean's decision of 2026-09-25 authorizes reading
 * public pages whatever robots.txt says and "does not extend to bypassing
 * authentication or other access controls": a bot challenge and an IP-based
 * refusal are access controls, and fetching from someone else's address to
 * clear one is bypassing it. So every call now refuses, before any request,
 * and names why; the signature stays so a script that still calls it reports
 * the rung as refused instead of failing to build. A walled host is pursued by
 * other public routes (`lib/hunt/access-control.ts`).
 */
export async function readViaEgress(
  rawUrl: string,
  _options: { signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EgressResult> {
  const url = assertPublicUrl(rawUrl);
  throw new EgressRefusal(
    `rung 5 is retired (2026-09-25): relaying ${url} through ${READER} to get past a refusal aimed at this client ` +
      "would bypass an access control. Nothing was requested; pursue another public route.",
  );
}
