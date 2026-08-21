/**
 * **WHAT A CAMPAIGN SITE PUBLISHES ABOUT ITS OWN CANDIDATE** (built 2026-08-21,
 * NH Hunt 2 item 2).
 *
 * ```
 * pnpm probe:site <url> [<url> …] [--json]
 * ```
 *
 * Four of the five Kelly-standard fields are usually sitting on one page and
 * the hunt for them was being done by eye, one candidate at a time, forty-seven
 * times. This reads that page through the ladder (`scripts/ladder-fetch.mts`'s
 * rungs, via the same helpers) and reports exactly what the page publishes:
 *
 * - **Photo** — `og:image`, `twitter:image`, and every `<img>` big enough to be
 *   a portrait, each with its `alt` text so a caller can judge whether it is a
 *   solo portrait or a banner. It reports CANDIDATES for a photo; it never
 *   picks one. The four-door rule and the composition standards are a human
 *   judgement about a named person's face and this makes no part of it.
 * - **Contact** — `mailto:` and `tel:` links, and phone-shaped text in the
 *   page's own prose. Both are reported with the surrounding text so a caller
 *   can tell a campaign office line from a fundraising vendor's.
 * - **In their own words** — `og:description`, `meta[name=description]`, and
 *   the first substantial paragraph. Reported verbatim, never summarised: the
 *   blurb rule says prose about a person is quoted with its source class or it
 *   does not ship, and a paraphrase made here would arrive already unusable.
 * - **The page itself** — final URL after redirects, HTTP status, and the rung
 *   that read it, which is the provenance the citation needs.
 *
 * ## What it does NOT do, and why each is deliberate
 *
 * It does not decide anything. No field is written to any data file by this
 * script. It has no notion of a candidate, and it will happily probe a page
 * belonging to nobody. Every judgement — is this the right person, is this a
 * solo portrait, is this contact reachable, is this quote the campaign's own
 * words — stays with the session, because each of those is a claim about a real
 * person and `CLAUDE.md` does not let a heuristic make one.
 *
 * It does not follow links. A campaign's About page is a different fetch and
 * the caller names it.
 *
 * It does not HEAD-verify an image. `lib/ballot/candidate-cards.ts` records a
 * photo only after a HEAD proves it is an image; doing it here would spend a
 * request on every candidate photo of the wrong person.
 */
import { browserProfileHeaders, challengeIn, sourceUserAgent } from "../lib/sources/http.ts";
import { EGRESS_SPACING_MS, readViaEgress } from "../lib/hunt/egress.ts";

interface Probe {
  url: string;
  finalUrl: string;
  status: number;
  rung: number;
  bytes: number;
  title: string | null;
  ogImage: string | null;
  twitterImage: string | null;
  images: { src: string; alt: string }[];
  emails: string[];
  phones: string[];
  ogDescription: string | null;
  metaDescription: string | null;
  firstParagraph: string | null;
  wall?: string;
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "’")
    .replace(/&#8211;/g, "–");
}

function meta(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
      "i",
    );
    const reversed = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      "i",
    );
    const hit = pattern.exec(html) ?? reversed.exec(html);
    if (hit?.[1]?.trim()) return decode(hit[1].trim());
  }
  return null;
}

function absolute(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

/**
 * Read the page, walking 2 → 4 → 5. Rung 3 is skipped deliberately: on every
 * host this project has measured, a wall that refuses rung 2 and admits rung 3
 * has not been seen since 2026-08-14, and the fingerprint walls that matter
 * need rung 4 regardless. The rung that read it is REPORTED either way, so a
 * caller can see the skip rather than infer it.
 */
async function read(url: string): Promise<{ html: string; status: number; rung: number; finalUrl: string }> {
  const plain = await fetch(url, {
    headers: { "User-Agent": sourceUserAgent(), Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (plain?.ok) {
    const html = await plain.text();
    if (!challengeIn(html)) return { html, status: plain.status, rung: 2, finalUrl: plain.url };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(
      "curl",
      [
        "-sSL",
        "--max-time",
        "60",
        "-A",
        sourceUserAgent(),
        "-H",
        `Accept: ${browserProfileHeaders().Accept ?? "text/html,*/*"}`,
        "-w",
        "\n__WTP__%{http_code}__%{url_effective}",
        url,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const cut = stdout.lastIndexOf("\n__WTP__");
    const html = cut < 0 ? stdout : stdout.slice(0, cut);
    const tail = cut < 0 ? "" : stdout.slice(cut + 8);
    const [code, effective] = tail.split("__");
    const status = Number(code) || 0;
    if (status < 400 && !challengeIn(html))
      return { html, status, rung: 4, finalUrl: effective?.trim() || url };
  } catch {
    /* fall through to rung 5 */
  }

  await new Promise((resolve) => setTimeout(resolve, EGRESS_SPACING_MS));
  const relayed = await readViaEgress(url);
  return { html: relayed.text, status: relayed.status, rung: 5, finalUrl: relayed.url };
}

export async function probe(url: string): Promise<Probe> {
  const { html, status, rung, finalUrl } = await read(url);
  const wall = challengeIn(html);

  /*
   * THE LAZY-LOAD PLACEHOLDER, WHICH IS WHAT MOST CAMPAIGN SITES PUT IN `src`.
   *
   * WordPress themes ship a `data:image/svg+xml` spacer of the right aspect
   * ratio in `src` and the real file in `data-src` / `data-lazy-src` /
   * `data-original`. The first run of this printed five identical inline SVGs
   * for a site whose portraits were all present — a probe that reads the
   * placeholder reports "no photo here" about a page full of photographs,
   * which is the false-miss shape the transparency mandate names outright.
   */
  const images = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((m) => m[0])
    .map((tag) => {
      const lazy =
        /data-(?:src|lazy-src|original|lazy)=["']([^"']+)["']/i.exec(tag)?.[1] ??
        /srcset=["']([^"'\s,]+)/i.exec(tag)?.[1] ??
        null;
      const plain = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
      const chosen = /^data:/i.test(plain) && lazy ? lazy : plain;
      return {
        src: absolute(decode(chosen), finalUrl),
        alt: decode(/alt=["']([^"']*)["']/i.exec(tag)?.[1] ?? ""),
      };
    })
    .filter(
      (i) =>
        i.src &&
        !/^data:/i.test(i.src) &&
        !/\.svg($|\?)/i.test(i.src) &&
        !/(logo|icon|sprite|spacer|pixel)/i.test(i.src),
    );

  const emails = [
    ...new Set(
      [...html.matchAll(/mailto:([^"'>\s?]+)/gi)]
        .map((m) => decode(m[1]!).toLowerCase())
        .filter((e) => /@/.test(e)),
    ),
  ];

  /*
   * Two phone shapes, and both are reported rather than merged: a `tel:` link
   * is the site saying "call this", and a phone-shaped run of digits in prose
   * might be the candidate's, a vendor's, or a fax. A caller has to see which
   * one it was, so the distinction survives into the output.
   */
  const telLinks = [...html.matchAll(/tel:([+\d().\- ]{7,})/gi)].map((m) => m[1]!.trim());
  const text = decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
  const prosePhones = [...text.matchAll(/\(?\b\d{3}\)?[.\- ]\d{3}[.\- ]\d{4}\b/g)].map((m) => m[0]);
  const phones = [...new Set([...telLinks, ...prosePhones])];

  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decode(m[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 60);

  return {
    url,
    finalUrl,
    status,
    rung,
    bytes: html.length,
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "") || null,
    ogImage: meta(html, "og:image", "og:image:secure_url")
      ? absolute(meta(html, "og:image", "og:image:secure_url")!, finalUrl)
      : null,
    twitterImage: meta(html, "twitter:image")
      ? absolute(meta(html, "twitter:image")!, finalUrl)
      : null,
    images: images.slice(0, 25),
    emails,
    phones,
    ogDescription: meta(html, "og:description"),
    metaDescription: meta(html, "description"),
    firstParagraph: paragraphs[0] ?? null,
    ...(wall ? { wall } : {}),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urls = args.filter((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  if (!urls.length) {
    console.error("usage: pnpm probe:site <url> [<url> …] [--json]");
    process.exit(2);
  }

  const results: Probe[] = [];
  for (const url of urls) {
    try {
      results.push(await probe(url));
    } catch (error) {
      console.error(`  ${url}\n    NOT READ — ${(error as Error).message}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`\n=== ${r.url}`);
    console.log(`    HTTP ${r.status} via rung ${r.rung}, ${r.bytes} bytes -> ${r.finalUrl}`);
    if (r.wall) console.log(`    WALL: ${r.wall} — this is not the page`);
    if (r.title) console.log(`    title: ${r.title}`);
    if (r.ogImage) console.log(`    og:image: ${r.ogImage}`);
    if (r.twitterImage) console.log(`    twitter:image: ${r.twitterImage}`);
    if (r.emails.length) console.log(`    emails: ${r.emails.join(", ")}`);
    if (r.phones.length) console.log(`    phones: ${r.phones.join(", ")}`);
    if (r.ogDescription) console.log(`    og:description: ${r.ogDescription}`);
    if (r.metaDescription && r.metaDescription !== r.ogDescription)
      console.log(`    description: ${r.metaDescription}`);
    if (r.firstParagraph) console.log(`    first paragraph: ${r.firstParagraph.slice(0, 400)}`);
    if (r.images.length) {
      console.log("    images (candidates only — the door rule is a human judgement):");
      for (const i of r.images.slice(0, 12)) console.log(`      ${i.src}  [alt: ${i.alt}]`);
    }
  }
  console.log("");
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) await main();
