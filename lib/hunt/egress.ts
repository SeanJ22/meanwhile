/**
 * **RUNG 5, MADE AVAILABLE TO A HUNT** — a different EGRESS for a page this
 * network is refused. (Built 2026-08-21, NH Hunt 2.)
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
 * Read one public page through the different-egress rung.
 *
 * Throws on anything but a 2xx, because a rung that returns an empty string on
 * a refusal is the zero-row shape `CLAUDE.md` spent six sightings learning to
 * refuse: a wall would render as a document with nothing in it.
 */
export async function readViaEgress(
  rawUrl: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<EgressResult> {
  const url = assertPublicUrl(rawUrl);
  const readerUrl = READER + url.toString();
  const impl = options.fetchImpl ?? fetch;

  const controller = options.signal ? undefined : new AbortController();
  const timer = controller
    ? setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000)
    : undefined;
  try {
    const response = await impl(readerUrl, {
      signal: options.signal ?? controller?.signal,
      headers: { Accept: "text/plain, text/markdown, */*" },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new EgressRefusal(
        `rung 5 refused ${url} with HTTP ${response.status} — this is a WALL at the ` +
          `egress rung, not an empty document (${text.slice(0, 200)})`,
      );
    }
    if (!text.trim()) {
      throw new EgressRefusal(
        `rung 5 returned 200 and ZERO BYTES for ${url}. A zero-row extraction is a ` +
          "failed extraction, never an empty document — the next rung is owed.",
      );
    }
    /*
     * **THE RELAY'S 200 IS THE RELAY'S, NOT THE ORIGIN'S.**
     *
     * The reader service answers HTTP 200 for a page the origin refused, and
     * puts the origin's status in the BODY: `Warning: Target URL returned
     * error 404: Not Found`. The first version of this returned that as a
     * successful read, and `pnpm probe:site` duly printed "HTTP 200 via rung 5"
     * for a New Hampshire Executive Council page that does not exist.
     *
     * That is the exact shape `CLAUDE.md` forbids twice over — a wall rendering
     * as an emptiness, and a failed retrieval reported as a success — arriving
     * through a rung built to defeat walls. So the origin's own status is read
     * out of the relay's annotation and a 4xx/5xx is raised as the refusal it
     * is, naming the origin status rather than the relay's.
     */
    const relayed = /^Warning:\s*Target URL returned error\s*(\d{3})\s*:?\s*(.*)$/im.exec(text);
    if (relayed) {
      throw new EgressRefusal(
        `rung 5 relayed ${url} and the ORIGIN answered HTTP ${relayed[1]} ${(relayed[2] ?? "").trim()}. ` +
          "The relay's own 200 is not the document — this is a failed read at the origin.",
      );
    }
    return {
      url: url.toString(),
      readerUrl,
      status: response.status,
      text,
      bytes: text.length,
      viaEgress: true,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
