/**
 * `pnpm morris:portraits` — **`OFF-1` / `NJ13`: portraits for all seven Morris
 * County commissioners.** (2026-08-23, the author's 8/22 walkthrough item 12.)
 *
 * ## What the capture showed, and what the record said about it
 *
 * The Morris County Representation tab, read as an image: seven commissioners,
 * every one carrying a party read from the county clerk's certified results and
 * a source link, and **one portrait between them**. Tayfun Selen has a face.
 * Shaw, Krickus, Cabana, Mastrangelo, Myers and Smith render as initials.
 *
 * `lib/registry/official-photos.json` records why, and reading it is the whole
 * finding. Six of the seven carry:
 *
 * > *door 2, rungs walked 2026-08-15 —
 * > `https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners`:
 * > 0 candidate image(s), none carrying their name;
 * > `…/Board-of-County-Commissioners`: 0 candidate image(s)*
 *
 * **The same URL, twice, for every one of them — the board's INDEX page.** The
 * seventh was walked at `…/Board-of-County-Commissioners/Tayfun-Selen`, his own
 * page, and it returned a portrait immediately.
 *
 * So this is not a wall and never was. It is a hunt that asked the index for a
 * thing that lives on the leaf, recorded two identical attempts as two rungs,
 * and wrote the result down as an absence. RULING 52's exact shape: a defensible
 * rung history behind a route nobody varied.
 *
 * **Every commissioner's own page URL was already sitting in
 * `lib/registry/body-rosters.ts` as `websiteUrl`** — the same field the card
 * renders as their official page. Nothing had to be discovered to walk it.
 *
 * ## The door, and why it is not in doubt
 *
 * `morriscountynj.gov` is a `.gov` host. The photo rule's **door 2** is the
 * portrait a government body publishes to identify its own member, with
 * attribution and remove-on-request; **door 4** is the author's ruling that
 * anything on a `.gov` site is official. Selen's row already shipped through
 * door 2 from this exact host, so the basis is settled and consistent — the six
 * join him rather than arriving under a different rule.
 *
 * The 2026-08-14 Commons rung recorded the host's footer as carrying no reuse
 * grant, which is correct and is a **door 1** finding. It does not reach door 2:
 * a government publishing its own member's face to identify them is what door 2
 * describes, and licence is not the basis it runs on.
 *
 * ## What this writes, and what it does not
 *
 * It writes NOTHING into the photo store. It fetches each page, finds the
 * portrait, records the URL, the source page, the alt text and the byte count,
 * and prints a report. **A photo ships only after it has been eyeballed** — the
 * standards in `CLAUDE.md` are a clean solo portrait or honest initials, and no
 * automated check can see a banner, a group shot or the wrong face. The review
 * row for the author is opened by the session, one row, keyed to the ASSET.
 *
 * Run: `pnpm morris:portraits [--json <out>]`
 */

import { writeFileSync } from "node:fs";

import { imagesIn, nameTokens, pickPortrait } from "../lib/hunt/portrait-pick.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";

interface Commissioner {
  id: string;
  name: string;
  page: string;
}

/** The board the seven sit on. Every member page hangs off it. */
const BOARD = "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners";

/**
 * The roster this hunt is FOR, from `lib/registry/body-rosters.ts`. Restated
 * here rather than imported because that module pulls in the whole registry,
 * and a one-shot hunt should not need it.
 */
const NAMES = [
  { id: "roster:morris#1", name: "Stephen H. Shaw" },
  { id: "roster:morris#2", name: "John Krickus" },
  { id: "roster:morris#3", name: "Douglas R. Cabana" },
  { id: "roster:morris#4", name: "Thomas J. Mastrangelo" },
  { id: "roster:morris#5", name: "Christine Myers" },
  { id: "roster:morris#6", name: "Tayfun Selen" },
  { id: "roster:morris#7", name: "Deborah Smith" },
];

/**
 * **The member pages are DISCOVERED from the board index, never guessed.**
 * (RULING 93 — ask what the tier above publishes about the tier below.)
 *
 * The first run of this script built the URLs from the names and lost three of
 * seven to HTTP 404, because the county keeps the period after a middle
 * initial: `Stephen-H.-Shaw`, not `Stephen-H-Shaw`. Three 404s entirely of the
 * hunt's own making — which is the same shape as the 2026-08-15 run this script
 * exists to correct, one level down. A route that guesses an identifier is a
 * route that reports a body's absence when it got the name wrong.
 *
 * The board publishes a link to each of its members. Reading it costs one fetch
 * and cannot be wrong about a slug.
 */
async function memberPages(): Promise<Map<string, string>> {
  const { status, body } = await get(BOARD);
  if (status !== 200) throw new Error(`the board index answered HTTP ${status}`);
  const links = new Set<string>();
  for (const m of body.matchAll(
    /href\s*=\s*"([^"]*Board-of-County-Commissioners\/[^"#?]+)"/gi,
  )) {
    links.add(new URL(m[1], BOARD).toString());
  }
  const byName = new Map<string, string>();
  for (const { name } of NAMES) {
    const want = nameTokens(name);
    const surname = want[want.length - 1];
    const hit = [...links].find((l) => {
      const slug = decodeURIComponent(l.split("/").pop() ?? "").toLowerCase();
      return slug.includes(surname) && want.filter((t) => slug.includes(t)).length >= 2;
    });
    if (hit) byName.set(name, hit);
  }
  console.log(
    `  board index: ${links.size} link(s), ${byName.size} of ${NAMES.length} members matched\n`,
  );
  return byName;
}

const SPACING_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Found {
  id: string;
  name: string;
  page: string;
  status: number | null;
  /** Absolute URL of the best candidate image, or null. */
  imageUrl: string | null;
  alt: string | null;
  bytes: number | null;
  contentType: string | null;
  /** Why this image was chosen, or why none was. */
  reason: string;
}

/*
 * `images`, `tokens` and `pick` moved to `lib/hunt/portrait-pick.ts` on
 * 2026-08-25, unchanged, when a second hunt needed them. RULING 103: the
 * cheapest way to have no duplicate implementation is to move the original
 * rather than write a second one, and this script now calls what it wrote.
 */

async function get(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": sourceUserAgent(), Accept: "text/html,*/*" },
    redirect: "follow",
  });
  return { status: res.status, body: res.status === 200 ? await res.text() : "" };
}

const pages = await memberPages();
const COMMISSIONERS: Commissioner[] = NAMES.map((n) => ({
  ...n,
  page: pages.get(n.name) ?? `${BOARD}/${n.name.replace(/ /g, "-")}`,
}));

const results: Found[] = [];

for (const c of COMMISSIONERS) {
  await sleep(SPACING_MS);
  let status: number | null = null;
  try {
    const page = await get(c.page);
    status = page.status;
    if (page.status !== 200) {
      results.push({
        ...c,
        status,
        imageUrl: null,
        alt: null,
        bytes: null,
        contentType: null,
        reason: `the page answered HTTP ${page.status} — a failed retrieval, never an absence`,
      });
      continue;
    }
    /*
     * A status is not a document. A 200 with a body that is not about this
     * person is the shape `notADocument` exists for, and here the control is
     * the person's own name appearing on the page they were asked for.
     */
    if (!page.body.toLowerCase().includes(nameTokens(c.name)[nameTokens(c.name).length - 1])) {
      results.push({
        ...c,
        status,
        imageUrl: null,
        alt: null,
        bytes: null,
        contentType: null,
        reason: "HTTP 200 and the page does not carry this person's name — not their page",
      });
      continue;
    }

    const all = imagesIn(page.body, c.page);
    const chosen = pickPortrait(c.name, all);
    if (chosen === null) {
      results.push({
        ...c,
        status,
        imageUrl: null,
        alt: null,
        bytes: null,
        contentType: null,
        reason: `${all.length} image(s) on the page, none carrying their name — no candidate, and a largest-image guess would be a wrong face`,
      });
      continue;
    }

    await sleep(SPACING_MS);
    const head = await fetch(chosen.src, {
      method: "GET",
      headers: { "User-Agent": sourceUserAgent() },
    });
    const buf = head.status === 200 ? Buffer.from(await head.arrayBuffer()) : null;
    results.push({
      ...c,
      status,
      imageUrl: chosen.src,
      alt: chosen.alt || null,
      bytes: buf?.byteLength ?? null,
      contentType: head.headers.get("content-type"),
      reason: `${chosen.why}; ${all.length} image(s) on the page`,
    });
  } catch (error) {
    results.push({
      ...c,
      status,
      imageUrl: null,
      alt: null,
      bytes: null,
      contentType: null,
      reason: `the fetch threw: ${String((error as Error).message).slice(0, 160)}`,
    });
  }
}

/* ---------------------------------------------------------------- report --- */

const found = results.filter((r) => r.imageUrl !== null);
console.log("\nOFF-1 · Morris County commissioners — door 2, each on their OWN page\n");
for (const r of results) {
  console.log(`  ${r.imageUrl ? "FOUND " : "  --  "} ${r.name.padEnd(24)} HTTP ${r.status ?? "—"}`);
  console.log(`           page  ${r.page}`);
  if (r.imageUrl) {
    console.log(`           image ${r.imageUrl}`);
    console.log(`           alt   ${JSON.stringify(r.alt)}  ${r.bytes} bytes  ${r.contentType}`);
  }
  console.log(`           why   ${r.reason}`);
  console.log("");
}
console.log(`  ${found.length} of ${results.length} commissioners have a portrait on their own page.`);
console.log(
  "\n  NOTHING has been written to the photo store. A photo ships only after it has\n" +
    "  been eyeballed — a clean solo portrait or honest initials, and no automated\n" +
    "  check can see a banner, a group shot or the wrong face.\n",
);

const out = process.argv.indexOf("--json");
if (out !== -1 && process.argv[out + 1]) {
  writeFileSync(process.argv[out + 1], `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`  written ${process.argv[out + 1]}`);
}
