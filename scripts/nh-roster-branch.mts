/**
 * `pnpm nh:roster` — **the General Court's own roster, as an independent
 * BRANCH.** (NH Hunt 3, 2026-08-21. RULING 52.)
 *
 * ## Why this exists
 *
 * `scripts/b14-official-links.mts` resolves a candidate's official page by
 * exact-name join against OUR sitting-officeholder registry. That join is
 * correct and deliberately narrow (the D40 discipline: nothing fuzzy), and it
 * failed for 87 people — after which the record said "there is no official page
 * for us to link." Re-walked 2026-08-21, 10 of 10 sampled were wrong, among
 * them the sitting Governor of Arizona and two sitting members of the New
 * Hampshire General Court.
 *
 * The join failing is a fact about our registry. It is not evidence about their
 * page. RULING 52: take another branch. **This is that branch for New
 * Hampshire** — it goes through the General Court's own publication and does
 * not consult our registry at all, so it fails for entirely different reasons.
 *
 * ## Two chambers, two branches, because the host treats them differently
 *
 * **House — a name index, published as a form control.** `gc.nh.gov/house/
 * members/` answers rung 2 at HTTP 200 and its member-lookup page carries a
 * `<select>` of every member: `<option value="700">Ebel, Karen</option>`. The
 * option VALUE IS the `pid` in `member.aspx?pid=` — confirmed against Gregory
 * Sargent, whose option value 10832 matches the pid already recorded for him.
 * That makes it a complete name-to-page index for the whole chamber, published
 * by the chamber, in one document.
 *
 * **Senate — a path-scoped WAF, so the name index is unreachable and the
 * DISTRICT is the key.** `gc.nh.gov/senate/members/` answers **403** to the
 * same client that gets 200 from the House path one directory over. That is the
 * path-scoped WAF already recorded in `docs/zip-playbook.md` (g19, 2026-08-18),
 * and it means there is no roster document to index. But
 * `senate/members/webpages/district07.aspx` answers 200 — districts 01, 07, 15
 * and 24 all confirmed 2026-08-21 — so the Senate is walked by district number
 * rather than by name. Twenty-four requests cover the chamber.
 *
 * Recording both is the point: a session that met the 403 and stopped would
 * have written down "the Senate roster is walled", which is the sentence this
 * whole ruling exists to stop.
 *
 * ## Manners
 *
 * Serialized, spaced, through the shared client with its identified
 * `User-Agent`. These are public records a public body is obliged to publish;
 * the pacing is engineering manners, not hedging.
 *
 * Run:
 *   pnpm nh:roster                 # index both chambers, report the pair
 *   pnpm nh:roster --name="Ebel"   # resolve one person and print their page
 *   pnpm nh:roster --json
 */
import { politeGetText } from "../lib/sources/http.ts";

const JSON_OUT = process.argv.includes("--json");
const nameArg = process.argv.find((a) => a.startsWith("--name="));
const WANTED = nameArg ? nameArg.slice("--name=".length).toLowerCase() : null;

const HOUSE_ROSTER = "https://gc.nh.gov/house/members/";
const memberPage = (pid: string) => `https://gc.nh.gov/house/members/member.aspx?pid=${pid}`;
const senateDistrict = (n: number) =>
  `https://gc.nh.gov/senate/members/webpages/district${String(n).padStart(2, "0")}.aspx`;

/** New Hampshire has 24 state senate districts. */
const SENATE_DISTRICTS = 24;

export interface RosterMember {
  name: string;
  chamber: "House" | "Senate";
  /** The page the General Court publishes for this member. */
  url: string;
  district: string | null;
  email: string | null;
  phone: string | null;
  /** Which branch reached them, recorded so the record can name it. */
  branch: string;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** `Ebel, Karen` → `karen ebel`, so a roster entry meets a ballot name. */
export function rosterNameToNatural(entry: string): string {
  const [last, first] = entry.split(",").map((p) => p.trim());
  return norm(first ? `${first} ${last}` : (last ?? ""));
}

/** Every `<option value="PID">Last, First</option>` in a roster document. */
export function parseRosterOptions(html: string): { pid: string; entry: string }[] {
  const out: { pid: string; entry: string }[] = [];
  for (const m of html.matchAll(/<option\s+value="(\d+)"\s*>([^<]+)<\/option>/gi)) {
    const entry = m[2]!.trim();
    // The control carries a prompt row; a member entry is `Last, First`.
    if (!entry.includes(",")) continue;
    out.push({ pid: m[1]!, entry });
  }
  return out;
}

const EMAIL = /[A-Za-z0-9._%+-]+@gc\.nh\.gov/;
const PHONE = /\(?\b603\)?[.\s-]?\d{3}[.\s-]?\d{4}\b/;
const DISTRICT = /((?:Merrimack|Hillsborough|Rockingham|Strafford|Belknap|Carroll|Cheshire|Coos|Grafton|Sullivan|District)[^<\n]{0,28})/;

/** Read a member page for the Kelly fields it publishes. */
function fieldsFrom(html: string): Pick<RosterMember, "district" | "email" | "phone"> {
  const email = EMAIL.exec(html)?.[0] ?? null;
  return {
    district: DISTRICT.exec(html)?.[1]?.trim() ?? null,
    // `help@gc.nh.gov` is the site's own support address on every page and is
    // not a member's contact. Recording it would be a wrong number under a real
    // person's name, which is worse than an honest gap.
    email: email && !/^help@/i.test(email) ? email : null,
    phone: PHONE.exec(html)?.[0] ?? null,
  };
}

const nameIn = (html: string): string | null =>
  /(?:Representative|Senator)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)+)/.exec(html)?.[1] ?? null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const members: RosterMember[] = [];
  const walls: string[] = [];

  /* ── Branch 1: the House roster's own name index ───────────────────────── */
  let options: { pid: string; entry: string }[] = [];
  try {
    const roster = await politeGetText(HOUSE_ROSTER, {
      profile: "browser",
      expect: { label: "the House roster", marker: "<option" },
    });
    options = parseRosterOptions(roster.text);
  } catch (error) {
    walls.push(`House roster (${HOUSE_ROSTER}): ${(error as Error).message.slice(0, 120)}`);
  }

  // An operation that can return nothing must be asked what it returned. A
  // roster that parsed to zero members is a broken parse, not an empty chamber
  // — New Hampshire's House has 400 seats and is the largest in the country.
  if (options.length > 0 && options.length < 100) {
    console.error(
      `REFUSED: the House roster parsed to ${options.length} member(s). The NH House ` +
        "has 400 seats; this is a failed parse, not a small chamber.",
    );
    process.exit(1);
  }

  const wanted = WANTED
    ? options.filter((o) => rosterNameToNatural(o.entry).includes(WANTED) ||
        norm(o.entry).includes(WANTED))
    : options;

  for (const o of wanted) {
    const url = memberPage(o.pid);
    if (!WANTED) {
      // The index alone is the answer when nobody asked for detail: 400 member
      // fetches to print a count would be a rate this repo does not ask for.
      members.push({
        name: rosterNameToNatural(o.entry),
        chamber: "House",
        url,
        district: null,
        email: null,
        phone: null,
        branch: "the House's own member index (a <select> whose option value IS the pid)",
      });
      continue;
    }
    try {
      const page = await politeGetText(url, { profile: "browser" });
      members.push({
        name: nameIn(page.text) ?? rosterNameToNatural(o.entry),
        chamber: "House",
        url,
        ...fieldsFrom(page.text),
        branch: "the House's own member index (a <select> whose option value IS the pid)",
      });
    } catch (error) {
      walls.push(`${o.entry} (${url}): ${(error as Error).message.slice(0, 100)}`);
    }
    await sleep(400);
  }

  /* ── Branch 2: the Senate, by district, because the roster path is walled ─ */
  if (WANTED) {
    for (let d = 1; d <= SENATE_DISTRICTS; d++) {
      const url = senateDistrict(d);
      try {
        const page = await politeGetText(url, { profile: "browser" });
        const found = nameIn(page.text);
        if (!found || !norm(found).includes(WANTED)) continue;
        members.push({
          name: found,
          chamber: "Senate",
          url,
          ...fieldsFrom(page.text),
          /*
           * The district is KNOWN — it is the loop variable and it is what the
           * URL asked for. Parsing it back out of the page was both unnecessary
           * and wrong: the first version harvested "District Maps" from the
           * site navigation and would have written a menu item into a senator's
           * record. `docs/zip-playbook.md` records exactly this lesson ("strip
           * the navigation before harvesting anything") and it still caught me.
           * Where a value is already known, never re-derive it from prose.
           */
          district: `Senate District ${d}`,
          branch: "the Senate's district pages (the roster path answers 403; districts answer 200)",
        });
      } catch (error) {
        walls.push(`Senate district ${d} (${url}): ${(error as Error).message.slice(0, 100)}`);
      }
      await sleep(400);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ members, walls, indexed: options.length }, null, 1));
    return;
  }

  console.log(`\nnh:roster — the General Court's own publication, walked 2026-08-21\n`);
  // The PAIR, always.
  console.log(`  House member index:  ${options.length} member(s) of 400 seats`);
  console.log(`  resolved this run:   ${members.length}`);
  for (const m of members) {
    console.log(`\n  ${m.name} — ${m.chamber}${m.district ? ` · ${m.district}` : ""}`);
    console.log(`    ${m.url}`);
    if (m.email) console.log(`    email  ${m.email}`);
    if (m.phone) console.log(`    phone  ${m.phone}`);
    console.log(`    branch ${m.branch}`);
  }
  if (walls.length > 0) {
    // A wall is a measurement with a date, never a standing property.
    console.log(`\n  WALLS MET on 2026-08-21 (${walls.length}) — re-test in 14 days per RULING 53:`);
    for (const w of walls) console.log(`    ${w}`);
  }
  console.log("");
}

await main();
