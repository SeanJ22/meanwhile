/**
 * **THE NEW HAMPSHIRE GENERAL COURT, WHICH IS NO LONGER A WALL** (built
 * 2026-08-21, NH Hunt 2 item 2).
 *
 * ```
 * pnpm nh:legislator "Ebel"                # both chambers
 * pnpm nh:legislator "Innis" --chamber senate
 * pnpm nh:legislator --list house          # the whole roster, name and pid
 * ```
 *
 * ## Why this exists, and it is a correction to our own record
 *
 * `CLAUDE.md` and `data/states/nh/ballot/nh-merrimack-2026.json` both record that
 * *"the General Court's own site (gc.nh.gov) refuses every client this project
 * has, browsers included"*. That was true when it was written on 2026-08-14.
 * **It is not true now.** Both `gc.nh.gov` and `gencourt.state.nh.us` answer a
 * plain rung-2 fetch at HTTP 200, and have for at least as long as anybody
 * bothered to check — which is the point: nobody bothered, because the wall was
 * written down and a written-down wall reads as a fact rather than as a
 * measurement with a date on it.
 *
 * That is the whole argument for the `HUNT03` re-walk discipline, demonstrated
 * on our own constitution: **a previous session's failure is not evidence.**
 *
 * ## What it reaches, per member
 *
 * The General Court publishes, for every sitting House member and Senator: an
 * official portrait, a district, a mailing address, a `@gc.nh.gov` email, a
 * phone, committee seats, and — for Senators — a biography the member wrote
 * themselves. That is four of the five Kelly-standard fields from one host,
 * with the fifth (a campaign site) the only one still owed.
 *
 * The portrait is **photo door 2** — the portrait a government body publishes
 * to identify its own member — and it ships with attribution to the General
 * Court and remove-on-request, like every other door-2 photo in this product.
 * The composition standards are not a door and are not waived here: every image
 * this prints is still looked at before it ships.
 *
 * ## What it does not do
 *
 * It does not write anything. It reads the roster, resolves a name to a member
 * page, and prints what that page publishes, with the URLs to cite. Deciding
 * that this Karen Ebel is that Karen Ebel is a claim about a person and stays
 * with the caller — which is why the match is printed with its district and
 * town rather than resolved silently.
 *
 * A name that matches nothing is reported as NO MATCH IN THE ROSTER, which is a
 * fact about the roster on the date read. It is never reported as the person
 * not existing, and it does not mean they never served: this reads the CURRENT
 * roster, and a former member is a different hunt — the archive, or the
 * chamber's own historical journals.
 */
import { writeFileSync } from "node:fs";

const HOST = "https://www.gencourt.state.nh.us";
const UA = "we-the-people/1.0 (civic data; seanj22@gmail.com)";

export interface Legislator {
  chamber: "house" | "senate";
  name: string;
  pid?: string;
  district?: string;
  pageUrl: string;
  portraitUrl: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  bio: string | null;
}

async function get(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim())
    throw new Error(`${url} -> HTTP ${response.status} and ZERO BYTES — a failed read, not an empty page`);
  return text;
}

function plain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Every current House member, as the roster's own select options give them. */
export async function houseRoster(): Promise<{ name: string; pid: string }[]> {
  const html = await get(`${HOST}/house/members/`);
  const rows = [...html.matchAll(/<option\s+value="(\d+)"\s*>([^<]+)<\/option>/gi)].map((m) => ({
    pid: m[1]!,
    name: m[2]!.replace(/&#39;/g, "'").trim(),
  }));
  if (!rows.length)
    throw new Error(
      "the House roster page produced ZERO members. A zero-row extraction is a failed " +
        "extraction — the page shape has changed, or this is not the page.",
    );
  return rows;
}

export async function houseMember(pid: string): Promise<Legislator> {
  const pageUrl = `${HOST}/house/members/member.aspx?pid=${pid}`;
  const html = await get(pageUrl);
  const portrait = /src=['"]([^'"]*memberpics[^'"]+)['"]/i.exec(html)?.[1] ?? null;

  /*
   * The name and district come from the page's OWN `<h1>` and `<h3>`, and the
   * contact block from the `card-text` paragraph beside the portrait — not from
   * the flattened page text. The first version read the flattened text and
   * returned the site's `<title>` as the member's name and three lines of
   * navigation chrome as their address, which is the shape of a parser
   * reporting about the template rather than about the person.
   */
  const name = plain(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "") || null;
  const district =
    plain(/<h3[^>]*class="text-center"[^>]*>([\s\S]*?)<\/h3>/i.exec(html)?.[1] ?? "") || undefined;
  const contactBlock = plain(
    /<p[^>]*class="card-text"[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "",
  );
  const lines = contactBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!name)
    throw new Error(
      `${pageUrl} produced no member name. The page shape has changed — this is a failed ` +
        "extraction, not a member with no name.",
    );

  return {
    chamber: "house",
    pid,
    name,
    district,
    pageUrl,
    /*
     * `nophoto.jpg` is the chamber's OWN placeholder and it is not a portrait.
     * Returning it would ship a grey silhouette under the words "official New
     * Hampshire House portrait" — a render default manufacturing a claim, and
     * the reader would have no way to tell it from a real face. A member the
     * House publishes no picture of is a MISS, recorded as one.
     */
    portraitUrl:
      portrait && !/nophoto/i.test(portrait) ? new URL(portrait, HOST).toString() : null,
    email: /([A-Za-z0-9._%+-]+@gc\.nh\.gov)/i.exec(contactBlock)?.[1] ?? null,
    phone: /\b(\d{3}[.\- ]\d{3}[.\- ]\d{4})\b/.exec(contactBlock)?.[1] ?? null,
    /*
     * The address is every contact line that is not the email, the phone or the
     * seat number. The phone test is anchored on the WHOLE phone shape: a test
     * for "three digits and a separator" ate the street number off `209 Squires
     * Ln` and reported a representative whose address begins at their town.
     */
    address:
      lines
        .filter(
          (l) =>
            !/@gc\.nh\.gov/i.test(l) &&
            !/^\d{3}[.\- ]\d{3}[.\- ]\d{4}$/.test(l.trim()) &&
            !/^Seat #/i.test(l),
        )
        .join(", ") || null,
    bio: null,
  };
}

/**
 * The Senate roster is ONE page carrying all twenty-four, so it is parsed as a
 * whole rather than fetched per member. Each card gives room, address, phone,
 * staff, portrait and email; the biography lives on the district page and is
 * fetched only when a caller asks for that member.
 */
export async function senateRoster(): Promise<Legislator[]> {
  const html = await get(`${HOST}/senate/members/senate_roster.aspx`);
  const cards = html.split(/<div class="card">/i).slice(1);
  const out: Legislator[] = [];
  for (const card of cards) {
    const heading = /<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(card)?.[1];
    if (!heading) continue;
    const label = plain(heading);
    const district = /District\s*(\d+)/i.exec(label)?.[1];
    const name = label.replace(/^District\s*\d+\s*-\s*Senator\s*/i, "").trim();
    if (!district || !name) continue;
    const portrait = /src=['"]([^'"]*senators\/\d+\.jpg)['"]/i.exec(card)?.[1] ?? null;
    const text = plain(card);
    out.push({
      chamber: "senate",
      name,
      district,
      pageUrl: `${HOST}/senate/members/webpages/district${district}.aspx`,
      portraitUrl: portrait ? new URL(portrait, HOST).toString() : null,
      email:
        [...card.matchAll(/mailto:([A-Za-z0-9._%+-]+@gc\.nh\.gov)/gi)]
          .map((m) => m[1]!)
          .find((e) => {
            const surname = name.split(/\s+/).pop()!.toLowerCase();
            return e.toLowerCase().includes(surname);
          }) ?? null,
      phone: /\b(\d{3}[.\- ]\d{3}[.\- ]\d{4})\b/.exec(text)?.[1] ?? null,
      address:
        /State House\s*\n?\s*Room\s*(\d+)\s*\n?\s*([^\n]+)/i.exec(text)?.[0]?.replace(/\n/g, ", ") ??
        null,
      bio: null,
    });
  }
  if (!out.length)
    throw new Error(
      "the Senate roster page produced ZERO senators. A zero-row extraction is a failed " +
        "extraction — the page shape has changed, or this is not the page.",
    );
  return out;
}

/** The senator's own biography prose, from their district page. */
export async function senateBio(district: string): Promise<string | null> {
  const html = await get(`${HOST}/senate/members/webpages/district${district}.aspx`);
  const text = plain(html);
  const start = text.search(/Years Served in the Senate:/i);
  if (start < 0) return null;
  /*
   * Cut at the first footer landmark AFTER the bio starts. Searching the whole
   * document found "Executive Council" in the site footer at offset 20-something
   * thousand and returned the entire page including the nav — a slice that ends
   * at a landmark before its own start is not a slice, it is the page.
   */
  const rest = text.slice(start);
  const end = rest.search(
    /Committee Assignments|Bills Sponsored|Current Voting Record|HELPFUL LINKS|Accessibility Policy|OTHER RESOURCES/i,
  );
  return rest.slice(0, end > 0 ? end : 1500).trim();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const listIndex = args.indexOf("--list");
  const chamberIndex = args.indexOf("--chamber");
  const chamber = chamberIndex >= 0 ? args[chamberIndex + 1] : undefined;
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;

  if (listIndex >= 0) {
    const which = args[listIndex + 1] ?? "house";
    if (which === "senate") {
      const roster = await senateRoster();
      for (const s of roster) console.log(`  district ${s.district}  ${s.name}  ${s.email ?? ""}`);
      console.log(`\n  ${roster.length} senators, read ${HOST}/senate/members/senate_roster.aspx\n`);
    } else {
      const roster = await houseRoster();
      for (const r of roster) console.log(`  ${r.pid}\t${r.name}`);
      console.log(`\n  ${roster.length} House members, read ${HOST}/house/members/\n`);
    }
    return;
  }

  /*
   * The positional argument is whatever is not a flag and not a flag's VALUE.
   * The first version compared against `args[listIndex + 1]` with `listIndex`
   * at -1, which is `args[0]` — the query itself — so every single-argument
   * invocation printed the usage line and exited 2.
   */
  const consumed = new Set<number>();
  for (const flag of ["--chamber", "--out", "--list"]) {
    const at = args.indexOf(flag);
    if (at >= 0) {
      consumed.add(at);
      consumed.add(at + 1);
    }
  }
  const query = args.find((a, i) => !a.startsWith("--") && !consumed.has(i));
  if (!query) {
    console.error('usage: pnpm nh:legislator "<name>" [--chamber house|senate] [--out <file>]');
    process.exit(2);
  }

  const found: Legislator[] = [];

  if (chamber !== "senate") {
    const roster = await houseRoster();
    for (const row of roster.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))) {
      found.push(await houseMember(row.pid));
    }
  }
  if (chamber !== "house") {
    for (const s of (await senateRoster()).filter((s) =>
      s.name.toLowerCase().includes(query.toLowerCase()),
    )) {
      found.push({ ...s, bio: await senateBio(s.district!) });
    }
  }

  if (!found.length) {
    console.log(
      `\n  NO MATCH IN THE ROSTER for "${query}".\n\n` +
        "  That is a fact about the CURRENT roster on the date this ran. It is not a\n" +
        "  finding that the person never served — a former member is the archive's\n" +
        "  hunt, or the chamber's own journals, and both are still owed.\n",
    );
    return;
  }

  for (const m of found) {
    console.log(`\n=== ${m.name}  (${m.chamber}${m.district ? `, district ${m.district}` : ""})`);
    console.log(`    page:     ${m.pageUrl}`);
    if (m.portraitUrl) console.log(`    portrait: ${m.portraitUrl}   [door 2 — look at it before it ships]`);
    if (m.email) console.log(`    email:    ${m.email}`);
    if (m.phone) console.log(`    phone:    ${m.phone}`);
    if (m.address) console.log(`    address:  ${m.address.replace(/\n/g, ", ")}`);
    if (m.bio) console.log(`    their own words:\n      ${m.bio.replace(/\n/g, "\n      ").slice(0, 1600)}`);
  }
  console.log("");

  if (out) {
    writeFileSync(out, JSON.stringify(found, null, 2) + "\n", "utf8");
    console.log(`  written  ${out}\n`);
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) await main();
