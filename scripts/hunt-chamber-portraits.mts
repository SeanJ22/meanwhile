/**
 * Door 2 for state legislators (item 6b, 2026-08-14) — the tier the
 * licence-only rule blocked whole.
 *
 * Every legislator in the three covered states carries their own chamber
 * member page in the roster, keyed by the chamber's own stable id (azleg's
 * `legislator=`, njleg's roster number, gc.nh.gov's `pid`/district page).
 * The chamber publishes a portrait on that page precisely to identify the
 * person holding the seat — door 2's exact case.
 *
 * **The identity join is structural, not a name search.** We arrive at the
 * page by the id already in our roster, and the portrait is the one that
 * page publishes. The alt text is then checked to CONFIRM the surname —
 * a second, independent signal, and a mismatch drops the row rather than
 * shipping a face we are not sure of.
 *
 * Output is the staging shape `fetch-official-portraits.mts` ships, so the
 * judgment pass and the manifest write are the same ones the Commons rung
 * uses. Counts are reported against the stated denominator.
 *
 * `pnpm exec tsx scripts/hunt-chamber-portraits.mts <outTargets.json> [--only <id,id,...>]`
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PortraitTarget } from "./fetch-official-portraits.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "we-the-people-civic-app/0.1 (nonpartisan civic information; contact seanj22@gmail.com)";

interface Officeholder {
  id: string;
  name: string;
  officeTitle: string;
  level: string;
  websiteUrl: string | null;
}

/** Surname, for the confirming check. Handles "Smith Jr.", "de la Cruz". */
function surnameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(jr|sr|iii|ii|iv|dr|mr|ms|mrs)$/i.test(w));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every <img> on the page, as (src, alt). Regex over HTML on purpose —
 *  three server-rendered ASP/WordPress/Drupal sites, no DOM available. */
function images(
  html: string,
  base: string,
): { src: string; alt: string; id: string }[] {
  const out: { src: string; alt: string; id: string }[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const alt = tag.match(/\salt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    // The element's own id. On ASP.NET sites the control name is the
    // page's own statement of what the element is — see MEMBER_IMAGE_IDS.
    const id = tag.match(/\sid\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    try {
      out.push({ src: new URL(src, base).toString(), alt, id });
    } catch {
      // A malformed src is a miss for this image, not for the page.
    }
  }
  return out;
}

/**
 * Element ids by which a chamber's own template declares "this is the
 * member's portrait" (2026-08-15).
 *
 * The New Hampshire House renders every member page from one ASP.NET
 * template, and the portrait is always `<img id="pageBody_imgMember">`. Its
 * file is named with an internal id that appears NOWHERE else on the page —
 * not in the URL, which uses a different `pid`, and not in the alt text,
 * which reads the generic "member picture" for all 386 of them. So neither
 * of the earlier confirmations could reach it, and 27 members with a real
 * published portrait were recorded as misses.
 *
 * The control id is a better signal than either: it is the chamber's own
 * template saying which element on this member's page is that member. We
 * arrive at the page through the id the General Court's member directory
 * gave us, and we take the element that page calls the member's picture.
 */
const MEMBER_IMAGE_IDS = /(^|_)(imgMember|memberPhoto|memberImage)$/i;

/** The publishing body for a member page. */
function publisherFor(url: string): string | null {
  if (/azleg\.gov/i.test(url)) return "Arizona State Legislature";
  if (/njleg\.state\.nj\.us/i.test(url)) return "New Jersey Legislature";
  if (/gc\.nh\.gov/i.test(url)) return "New Hampshire General Court";
  return null; // a personal or campaign site is NOT an official portrait
}

/**
 * The portrait on a member page, or the reason there isn't one.
 *
 * Deliberately conservative: the canonical failure classes (logos, seals,
 * district maps, banners, social icons) are excluded by name and by shape,
 * and the surname must appear in the alt text or the file name.
 */
/**
 * The chamber's own stable ids in a member-page URL.
 *
 * These are the SAME ids the roster already stores, which is why arriving
 * at the portrait through them is a structural join and not a name search.
 * New Hampshire names its portrait files after the member id
 * (`/house/images/memberpics/377093.jpg` for `member.aspx?member=377093`),
 * so the id in the file name IS the identity confirmation — stronger than
 * matching a surname, and the reason the first pass rejected all 410 NH
 * members for an alt text that reads "member picture".
 */
function idsIn(url: string): string[] {
  const ids: string[] = [];
  for (const match of url.matchAll(/[?&](?:member|pid|legislator|id)=(\d+)/gi)) {
    ids.push(match[1]);
  }
  for (const match of url.matchAll(/\/(\d{2,})(?:\/|$)/g)) ids.push(match[1]);
  return [...new Set(ids)];
}

/**
 * The New Hampshire Senate rung (2026-08-15).
 *
 * The Senate keys everything by DISTRICT, not by a member id: the roster
 * links `.../Senate/members/webpages/district23.aspx`, and that page carries
 * exactly one portrait, `.../Senate/images/senators/23.jpg`. Neither the
 * member's name nor a member id appears anywhere in either string, so the
 * generic confirmation rejected all 24 senators — the same shape as the
 * first NH House pass, which read "member picture" alt text and refused 410
 * people.
 *
 * This is still a STRUCTURAL join and not a name search, and it is worth
 * being precise about why: we do not go looking for a district that matches
 * a person. We arrive at `district23.aspx` because the General Court's own
 * member directory says that is Bill Gannon's page, and we accept the image
 * only if the number in its filename is the same district the page is. The
 * portrait is then, by the chamber's own filing, the face of whoever holds
 * district 23 — which their directory says is him.
 *
 * Deliberately narrow: it requires the chamber's own senators image path, so
 * a bare two-digit coincidence somewhere else on the page cannot satisfy it.
 */
function districtPortraitMatch(pageUrl: string, src: string): boolean {
  const district = /\/district0*(\d+)\.aspx/i.exec(pageUrl)?.[1];
  if (!district) return false;
  const image = /\/senators?\/0*(\d+)\.(?:jpe?g|png)$/i.exec(src)?.[1];
  if (!image) return false;
  return Number(district) === Number(image);
}

function portraitOn(
  html: string,
  pageUrl: string,
  name: string,
): { src: string; alt: string } | { reason: string } {
  const tokens = surnameTokens(name).map((t) => t.toLowerCase());
  const pageIds = idsIn(pageUrl);

  /**
   * Whether the image's own FILE PATH — not its alt text — identifies the
   * member. The site's prose can be wrong; its filing is what it filed.
   */
  const structural = (src: string): boolean => {
    const path = decodeURIComponent(src)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    if (tokens.some((t) => path.includes(t))) return true;
    if (districtPortraitMatch(pageUrl, src)) return true;
    return pageIds.some((id) => new RegExp(`(^|[^0-9])${id}([^0-9]|$)`).test(src));
  };

  const JUNK =
    /logo|seal|icon|banner|header|footer|flag|map|district|translate|spacer|blank|print|search|arrow|social|facebook|twitter|instagram|youtube/i;

  const all = images(html, pageUrl);

  // The template's own declaration wins outright, when the image it points
  // at is a real one and not the chamber's placeholder.
  const declared = all.filter(
    (i) =>
      MEMBER_IMAGE_IDS.test(i.id) &&
      !/nophoto|no-photo|placeholder|default/i.test(i.src),
  );
  if (declared.length === 1) return declared[0];
  if (declared.length > 1) {
    return {
      reason: `${declared.length} elements claim to be the member portrait — ambiguous, refusing rather than choosing (${declared
        .map((d) => d.src)
        .join(" | ")})`,
    };
  }
  // A declared portrait that IS the placeholder is an honest absence on the
  // chamber's side, and must be recorded as theirs rather than as our miss.
  const placeholderDeclared = all.find(
    (i) =>
      MEMBER_IMAGE_IDS.test(i.id) &&
      /nophoto|no-photo|placeholder|default/i.test(i.src),
  );
  if (placeholderDeclared) {
    return {
      reason: `the body publishes NO portrait for this member — its member page serves a placeholder (${placeholderDeclared.src}). An absence on their side, recorded as one.`,
    };
  }

  const candidates = all.filter((i) => {
    // A structurally identified image survives the junk filter (2026-08-15).
    // The New Hampshire Senate labels both images on a senator's page
    // `alt="NH State Seal"` — the state seal AND the senator's portrait —
    // so filtering on the alt text threw away two real portraits and the
    // hunt recorded them as "page published no image that could be a
    // portrait". That is the never-assert-absence rule catching a fabricated
    // absence: Daryl Abbas and Sharon Carson both have a published portrait,
    // at the same conventional path as their 22 colleagues, and we said they
    // did not. Their own file names say who they are; the alt text is a
    // copy-paste mistake on a government website and is not evidence.
    if (structural(i.src)) return !JUNK.test(i.src);
    return !JUNK.test(`${i.src} ${i.alt}`);
  });
  if (candidates.length === 0) {
    return { reason: "page published no image that could be a portrait" };
  }
  const confirmed = candidates.filter((i) => {
    const hay = decodeURIComponent(`${i.src} ${i.alt}`)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    // Any one of three signals confirms: the member's own name, the
    // chamber's own stable id for them in the portrait's file name, or —
    // for the NH Senate, which keys by district throughout — the page's
    // district number matching the portrait's.
    if (tokens.some((t) => hay.includes(t))) return true;
    if (districtPortraitMatch(pageUrl, i.src)) return true;
    return pageIds.some((id) =>
      new RegExp(`(^|[^0-9])${id}([^0-9]|$)`).test(i.src),
    );
  });
  if (confirmed.length === 0) {
    // Name the images we saw. The New Hampshire House serves a literal
    // `nophoto.jpg` for members it publishes no portrait of — an honest
    // absence on their side, and the reason has to say so rather than
    // read as our hunt failing.
    const srcs = candidates.map((c) => c.src).join(", ");
    const placeholder = /nophoto|no-photo|placeholder|default/i.test(srcs);
    return {
      reason: placeholder
        ? `the body publishes NO portrait for this member — its member page serves a placeholder (${srcs}). An absence on their side, recorded as one.`
        : `page published ${candidates.length} image(s) (${srcs}), none carrying ${name}'s name or the chamber's id for them (${pageIds.join(", ") || "no id in the page URL"}) — refusing an unconfirmed face`,
    };
  }
  // Tie-or-zero: more than one confirmed candidate means we cannot say
  // which is the member, so we say so rather than pick.
  const unique = [...new Map(confirmed.map((c) => [c.src, c])).values()];
  if (unique.length > 1) {
    return {
      reason: `${unique.length} images name ${name} — ambiguous, refusing rather than choosing (${unique
        .map((u) => u.src)
        .join(" | ")})`,
    };
  }
  return unique[0];
}

const outPath = process.argv[2];
if (!outPath) {
  console.error(
    "usage: hunt-chamber-portraits.mts <outTargets.json> [--only id,id,...]",
  );
  process.exit(1);
}
const onlyArg = process.argv.indexOf("--only");
/*
 * `--only-file` (2026-08-19, g20, D50's scale half).
 *
 * `--only` takes a comma list on the command line, and a re-hunt of the 250
 * members whose portraits were refused before the confirmation rungs existed
 * is 250 UUIDs — about 9,000 characters, which Windows refuses outright with
 * "The command line is too long."
 *
 * A cohort you cannot name is a cohort you cannot re-walk, so the id list
 * gets a file form. One newline- or comma-separated id per entry, blank
 * lines and `#` comments ignored, so a cohort can be checked in and re-run
 * rather than reconstructed from a report.
 */
const onlyFileArg = process.argv.indexOf("--only-file");
const only =
  onlyFileArg > 0
    ? new Set(
        (await readFile(process.argv[onlyFileArg + 1], "utf8"))
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("#")),
      )
    : onlyArg > 0
      ? new Set(process.argv[onlyArg + 1].split(","))
      : null;

const holders: Officeholder[] = [];
for (const file of [
  "officeholders-04.json",
  "officeholders-33.json",
  "officeholders-34.json",
]) {
  const parsed = JSON.parse(
    await readFile(join(ROOT, "lib", "registry", file), "utf8"),
  ) as { officeholders: Officeholder[] };
  holders.push(...parsed.officeholders.filter((o) => o.level === "STATE"));
}

const universe = holders.filter((h) => (only ? only.has(h.id) : true));
console.log(
  `denominator: ${holders.length} state legislators in the roster; attempting ${universe.length}`,
);

const targets: PortraitTarget[] = [];
const misses: { id: string; name: string; reason: string }[] = [];
const pageCache = new Map<string, string | null>();

for (const [index, holder] of universe.entries()) {
  const url = holder.websiteUrl;
  const publisher = url ? publisherFor(url) : null;
  if (!url) {
    misses.push({ id: holder.id, name: holder.name, reason: "roster holds no member-page URL" });
    continue;
  }
  if (!publisher) {
    // A personal or campaign site is not a body publishing its own member's
    // portrait — door 2 does not reach it, and door 1 would need a licence.
    misses.push({
      id: holder.id,
      name: holder.name,
      reason: `roster's site for this member is ${new URL(url).host}, not the chamber's own site — door 2 does not cover a personal or campaign page, and no licence is recorded`,
    });
    continue;
  }
  // New Jersey's member pages are client-rendered — the served HTML is a
  // loading spinner, so the plain-client rung returns no portrait at all.
  // The next rung is the endpoint that page itself calls, found by
  // instrumenting a real browser (2026-08-14): the roster id already in our
  // URL keys `/api/legislatorData/legislatorBio/{id}`, whose `Picture` is
  // the published portrait and whose `PictureText` names the member. Same
  // public record, same body, one rung further down.
  if (/njleg\.state\.nj\.us/i.test(url)) {
    const rosterId = url.match(/legislative-roster\/(\d+)/)?.[1];
    if (!rosterId) {
      misses.push({
        id: holder.id,
        name: holder.name,
        reason: `NJ member URL carries no roster id: ${url}`,
      });
      continue;
    }
    try {
      const api = `https://www.njleg.state.nj.us/api/legislatorData/legislatorBio/${rosterId}`;
      const response = await fetch(api, { headers: { "user-agent": UA } });
      await sleep(350);
      if (!response.ok) {
        misses.push({
          id: holder.id,
          name: holder.name,
          reason: `NJ bio endpoint returned HTTP ${response.status} for roster id ${rosterId}`,
        });
        continue;
      }
      const body = (await response.json()) as unknown;
      const record = (Array.isArray(body) ? body.flat()[0] : body) as
        | { Picture?: string; PictureText?: string; Last_Name?: string }
        | undefined;
      if (!record?.Picture) {
        misses.push({
          id: holder.id,
          name: holder.name,
          reason: `NJ bio record for roster id ${rosterId} publishes no Picture`,
        });
        continue;
      }
      // The confirming signal: the caption the chamber attaches names them.
      const caption = `${record.PictureText ?? ""} ${record.Picture}`.toLowerCase();
      const tokens = surnameTokens(holder.name).map((t) => t.toLowerCase());
      if (!tokens.some((t) => caption.includes(t))) {
        misses.push({
          id: holder.id,
          name: holder.name,
          reason: `NJ bio record for roster id ${rosterId} publishes a portrait whose caption ("${record.PictureText}") does not name ${holder.name} — refusing an unconfirmed face`,
        });
        continue;
      }
      targets.push({
        key: holder.id,
        name: holder.name,
        pageUrl: url,
        imageUrl: new URL(record.Picture, "https://pub.njleg.state.nj.us").toString(),
        publisher,
      });
    } catch (error) {
      misses.push({
        id: holder.id,
        name: holder.name,
        reason: `NJ bio endpoint failed: ${(error as Error).message}`,
      });
    }
    continue;
  }

  try {
    let html = pageCache.get(url) ?? null;
    if (!pageCache.has(url)) {
      const response = await fetch(url, { headers: { "user-agent": UA } });
      html = response.ok ? await response.text() : null;
      pageCache.set(url, html);
      if (!response.ok) {
        misses.push({
          id: holder.id,
          name: holder.name,
          reason: `member page returned HTTP ${response.status}`,
        });
        await sleep(350);
        continue;
      }
      await sleep(350);
    }
    if (!html) {
      misses.push({ id: holder.id, name: holder.name, reason: "member page unreadable" });
      continue;
    }
    const found = portraitOn(html, url, holder.name);
    if ("reason" in found) {
      misses.push({ id: holder.id, name: holder.name, reason: found.reason });
      continue;
    }
    targets.push({
      key: holder.id,
      name: holder.name,
      pageUrl: url,
      imageUrl: found.src,
      publisher,
    });
    if ((index + 1) % 25 === 0) {
      console.log(`  … ${index + 1}/${universe.length} walked, ${targets.length} found`);
    }
  } catch (error) {
    misses.push({
      id: holder.id,
      name: holder.name,
      reason: `member page fetch failed: ${(error as Error).message}`,
    });
  }
}

await writeFile(outPath, `${JSON.stringify(targets, null, 2)}\n`, "utf8");
await writeFile(
  outPath.replace(/\.json$/, "-misses.json"),
  `${JSON.stringify(misses, null, 2)}\n`,
  "utf8",
);

// The counts, stated: found + missed must equal what we attempted.
console.log(
  `\n=== attempted ${universe.length}: portrait URL found for ${targets.length}, ${misses.length} recorded misses ===`,
);
if (targets.length + misses.length !== universe.length) {
  throw new Error(
    `count mismatch: ${targets.length} + ${misses.length} != ${universe.length}`,
  );
}
