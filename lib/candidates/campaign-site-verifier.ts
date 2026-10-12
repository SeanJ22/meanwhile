import { createHash } from "node:crypto";

import { nameForms } from "../identity/name-forms.ts";
import { US_STATES } from "../control-plane/readiness/catalog.ts";
import { accessControlIn } from "../hunt/access-control.ts";
import { researchFetch, type ResearchFetchResult, type ResearchRuntime } from "../hunt/robots-first-fetch.ts";
import type { PermissionVerdict } from "../control-plane/scheduler/robots.ts";

export const CAMPAIGN_SITE_VERIFIER_ID = "campaign-site-verifier/1";

export const CURRENT_CYCLE = 2026;

const CYCLE_WINDOW_CHARS = 100;

export interface CampaignSiteIdentity {
  readonly candidacyId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly officeTitle: string;
  readonly ocdId: string;
  /** Two letters, upper case. */
  readonly stateCode: string;
  readonly cycle: number;
}

export type CampaignSiteLeadOrigin = "SCOUT_FINDING" | "MARGINALIA_POINTER" | "RECORDED_SITE";

export interface CampaignSiteLead {
  readonly url: string;
  readonly origin: CampaignSiteLeadOrigin;
  readonly ref: string;
  readonly title?: string | null;
}

export const CAMPAIGN_SITE_REFUSALS = [
  "LEAD_URL_INVALID",
  "NOT_HTTPS",
  "SOCIAL_PLATFORM",
  "AGGREGATOR",
  "NEWS_OUTLET",
  "GOVERNMENT_SITE",
  "PARTY_OR_ORGANIZATION",
  "WEB_ARCHIVE",
  "SEARCH_ENGINE",
  "NOT_A_PAGE",
  "ROBOTS_REFUSED",
  "ACCESS_CONTROLLED",
  "TRANSPORT_FAILED",
  "HTTP_NOT_OK",
  "NOT_HTML",
  "CANDIDATE_NOT_NAMED",
  "OFFICE_NOT_NAMED",
  "SITE_NOT_CANDIDATE_BRANDED",
  "CYCLE_NOT_EVIDENCED",
  "HISTORICAL_CYCLE",
  "NOT_READ",
] as const;
export type CampaignSiteRefusalCode = (typeof CAMPAIGN_SITE_REFUSALS)[number];

export interface CampaignSiteRefusal {
  readonly code: CampaignSiteRefusalCode;
  readonly detail: string;
}

const SOCIAL_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "x.com", "twitter.com", "linkedin.com", "youtube.com", "youtu.be",
  "tiktok.com", "threads.net", "bsky.app", "reddit.com", "nextdoor.com", "pinterest.com", "flickr.com",
  "linktr.ee", "linkin.bio", "beacons.ai", "mastodon.social", "truthsocial.com", "rumble.com", "gettr.com",
];
const AGGREGATOR_HOSTS = [
  "ballotpedia.org", "vote411.org", "ballotready.org", "goodparty.org", "votesmart.org", "vote-usa.org",
  "wikipedia.org", "wikidata.org", "wikimedia.org", "dbpedia.org", "opensecrets.org", "followthemoney.org",
  "transparencyusa.org", "citizenscount.org", "bluevoterguide.org", "theballotbrief.com", "lykelect.com",
  "electionstats.com", "isidewith.com", "politics1.com", "ourcampaigns.com", "mobilize.us", "eventbrite.com",
  "actblue.com", "winred.com", "givesendgo.com", "gofundme.com", "anedot.com", "podscan.fm", "buzzsprout.com",
  "citizenportal.ai", "libertyblock.com", "civoren.com", "publicnoticeads.com", "whovoted.org", "votersedge.org",
  "ballotopedia.org", "govtrack.us", "congress.gov", "c-span.org", "legiscan.com", "fastdemocracy.com",
  "commoncrawl.org", "iqm2.com", "civicclerk.com", "civicplus.com", "legistar.com", "boardbook.org",
  "revize.com", "thrillshare.com", "hylandcloud.com", "easyvotecampaignfinance.com", "njelecefilesearch.com",
  "ivoterguide.com", "littlesis.org", "billtrack50.com", "ontheissues.org", "iqsaaz.org",
  "influencewatch.org", "muckrack.com", "crunchbase.com", "zoominfo.com", "prabook.com", "legistorm.com",
];
const NEWS_HOSTS = [
  "patch.com", "tapinto.net", "newjerseyhills.com", "morrisfocus.com", "concordmonitor.com", "nhpr.org",
  "nhjournal.com", "indepthnh.org", "newjerseyglobe.com", "insidernj.com", "laconiadailysun.com",
  "ledgertranscript.com", "newhampshirebulletin.com", "spotonnewjersey.com", "spotonnewhampshire.com",
  "morristowngreen.com", "rockawaytimes.com", "thedartmouth.com", "azcentral.com", "tucson.com", "azmirror.com",
  "kjzz.org", "abc15.com", "12news.com", "kold.com", "kgun9.com", "kvoa.com", "azfamily.com", "fox10phoenix.com",
  "nytimes.com", "washingtonpost.com", "politico.com", "thehill.com", "apnews.com", "reuters.com", "nj.com",
  "northjersey.com", "app.com", "dailyrecord.com", "unionleader.com", "wmur.com", "seacoastonline.com",
  "fosters.com", "bostonglobe.com", "nhbr.com", "conwaydailysun.com", "nbcnews.com", "cnn.com", "foxnews.com",
  "npr.org", "axios.com", "newsweek.com", "yahoo.com", "msn.com", "tucsonsentinel.com", "phoenixnewtimes.com",
  "arizonadailystar.com", "eacourier.com", "kawc.org", "signalsaz.com", "thisisrockboro.com", "njspotlightnews.org",
  "whyy.org", "nj1015.com", "tapinto.com", "baristanet.com", "echo-pilot.com", "manchesterinklink.com",
  "azluminaria.org", "azfreenews.com", "ktar.com", "arizonadailyindependent.com", "granitegrok.com", "azpm.org",
  "azpbs.org", "einnews.com", "wonkette.com", "nbcboston.com", "swingstateproject.com", "thepulseofnh.com",
  "californiaglobe.com", "tennesseestar.com", "justthenews.com", "19thnews.org", "bostonmagazine.com",
  "newsaddicts.com", "mediarightnews.com", "cochiseregionalnews.substack.com", "blogforarizona.net",
];
const ARCHIVE_HOSTS = [
  "web.archive.org", "archive.org", "archive.ph", "archive.today", "archive.is", "webcache.googleusercontent.com",
  "r.jina.ai", "api.allorigins.win", "corsproxy.io", "api.codetabs.com",
];
const SEARCH_HOSTS = [
  "google.com", "bing.com", "duckduckgo.com", "search.brave.com", "mojeek.com", "ecosia.org", "stract.com",
  "searx.be", "marginalia.nu", "yandex.com", "search.yahoo.com", "startpage.com", "qwant.com", "kagi.com",
  "search.marcia.com", "news.google.com", "4get.ca",
];
const ORGANIZATION_HOSTS = ["lwvnh.org", "lwv.org", "cnht.org", "hardingcivic.org", "efinstitute.org", "aclink.org"];
/** Party and civic tokens in a site's own label. */
const ORGANIZATION_LABEL_TOKEN = /(gop(?![a-z])|gopcc|dems(?![a-z])|democrats|republicans|republicanclub|democraticclub|republicanwomen|democraticwomen|nhdp|lwv)/;
const ORGANIZATION_TITLE = /\b(democrats|republicans|gop|dems)\b|\bdemocratic (?:party|committee|club|women|organization)\b|\brepublican (?:party|committee|club|women|organization)\b|\bleague of women voters\b/;
/** Official municipal hosts named in the held evidence that are not on a .gov/.us TLD. */
const GOVERNMENT_HOSTS = [
  "easthanovertownship.com", "chestertownship.org", "hardingnj.org", "randolphnj.org", "rockawayborough.org",
  "rockawaytownship.org", "peqtwp.org", "montvillenj.org", "chester-nj.org", "netcong.org", "mendhamtownship.org",
  "boontontownship.com", "hanovertownship.com", "jeffersontownship.net", "chathamtownship.org", "chatham-nj.org",
  "chathamtownship-nj.gov", "springfieldnh.org", "chichesternh.org", "franklinnh.gov", "merrimackcounty.net",
  "cityofbenson.com", "avondale.org", "washtwpsd.org", "sefd911.org", "coronafire.org", "wtps.org", "mhrd.org",
  "rpsnj.org", "mtarlingtonk8.org", "hpreg.org", "morriscountyclerk.org", "atlanticcountyclerk.org",
];
const BUILDER_SUFFIXES = [
  "wixsite.com", "squarespace.com", "weebly.com", "nationbuilder.com", "square.site", "blogspot.com",
  "wordpress.com", "godaddysites.com", "carrd.co", "webflow.io", "business.site", "mystrikingly.com", "jimdosite.com",
];

function onList(host: string, list: readonly string[]): string | null {
  const bare = host.replace(/^www\./, "");
  return list.find((entry) => bare === entry || bare.endsWith(`.${entry}`)) ?? null;
}

export function siteLabel(host: string): string {
  const bare = host.toLowerCase().replace(/^www\./, "");
  const builder = BUILDER_SUFFIXES.find((suffix) => bare.endsWith(`.${suffix}`));
  if (builder !== undefined) return bare.slice(0, -(builder.length + 1)).split(".").at(-1) ?? bare;
  const labels = bare.split(".");
  return labels.length >= 2 ? labels[labels.length - 2]! : bare;
}

export function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The registrable domain of a host: its last two labels (every host this project reads is a US name). */
export function registrableDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
}

export function sitePathLength(url: string): number {
  try {
    // A web page's path, never a file path.
    const page = new URL(url);
    return page.pathname.replace(/\/+$/, "").length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function campaignSiteHostRefusal(url: string): CampaignSiteRefusal | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { code: "LEAD_URL_INVALID", detail: `${JSON.stringify(url)} is not an absolute URL` };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { code: "LEAD_URL_INVALID", detail: `${parsed.protocol} is not a web page` };
  }
  if (parsed.username || parsed.password) return { code: "LEAD_URL_INVALID", detail: "a URL carrying credentials is never read" };
  const host = parsed.hostname.toLowerCase();
  const hit = (list: readonly string[]) => onList(host, list);
  let entry: string | null;
  if ((entry = hit(ARCHIVE_HOSTS)) !== null) return { code: "WEB_ARCHIVE", detail: `${host} is an archive or proxy (${entry}); an archived copy is not the live site` };
  if ((entry = hit(SEARCH_HOSTS)) !== null) return { code: "SEARCH_ENGINE", detail: `${host} is a search index (${entry}); it points at pages and is never one` };
  if ((entry = hit(SOCIAL_HOSTS)) !== null) return { code: "SOCIAL_PLATFORM", detail: `${host} is a social platform (${entry}); a profile there is not a campaign website` };
  if ((entry = hit(AGGREGATOR_HOSTS)) !== null) return { code: "AGGREGATOR", detail: `${host} is an aggregator, voter guide or platform (${entry}), not the candidate's own site` };
  if ((entry = hit(NEWS_HOSTS)) !== null) return { code: "NEWS_OUTLET", detail: `${host} is a news outlet (${entry}); coverage of a candidate is not their site` };
  if (/\.(gov|mil|edu)$/.test(host) || /\.(state|k12|co|ci|twp|city|town)\.[a-z]{2}\.us$/.test(host) || /\.us$/.test(host) && /\b(state|county|co|ci|city|town|twp|k12)\b/.test(host.replace(/\./g, " "))) {
    return { code: "GOVERNMENT_SITE", detail: `${host} is an official government or public-institution host; an official page is not a campaign site` };
  }
  if ((entry = hit(GOVERNMENT_HOSTS)) !== null) return { code: "GOVERNMENT_SITE", detail: `${host} is an official municipal or public-institution host (${entry})` };
  if ((entry = hit(ORGANIZATION_HOSTS)) !== null || host.endsWith(".gop") || ORGANIZATION_LABEL_TOKEN.test(siteLabel(host))) {
    return { code: "PARTY_OR_ORGANIZATION", detail: `${host} is a party committee or civic organization; a page it publishes about a candidate is not the candidate's own site` };
  }
  const path = parsed.pathname.toLowerCase();
  if (path === "/robots.txt" || /\.(pdf|jpe?g|png|gif|webp|svg|xml|json|txt|ics|csv|docx?|xlsx?)$/.test(path)) {
    return { code: "NOT_A_PAGE", detail: `${parsed.pathname} is a file, not a web page` };
  }
  return null;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', copy: "©", middot: "·", bull: "•", hellip: "...", reg: "®", trade: "™",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeChar(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function safeChar(code: number): string {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  } catch {
    return " ";
  }
}

export function pageVisibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  const content = tag ? /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) : null;
  const value = content ? decodeEntities(content[1] ?? content[2] ?? "").replace(/\s+/g, " ").trim() : "";
  return value === "" ? null : value;
}

export function pageHeadings(html: string): { readonly title: string | null; readonly headings: readonly string[] } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const clean = (value: string | undefined | null) => (value ? decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null : null);
  const t = clean(title);
  return {
    title: t,
    headings: [t, metaContent(html, "og:title"), metaContent(html, "og:site_name"), metaContent(html, "twitter:title"), clean(h1)]
      .filter((value): value is string => value !== null),
  };
}

/**
 * The comparison text, applied to the page and to every form alike: NFC, curly
 * punctuation folded, lower case, periods dropped, hyphens as spaces, and any
 * other punctuation as a space. Apostrophes are kept — `O'Donnell` without its
 * apostrophe is a different surname.
 */
export function comparisonText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/-/g, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordIndex(haystack: string, form: string): number {
  if (form === "") return -1;
  const index = ` ${haystack} `.indexOf(` ${form} `);
  return index;
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  return text.slice(start, Math.min(text.length, index + length + 40)).trim();
}

export type CampaignNameRule = "AS_PUBLISHED" | "NICKNAME_REMOVED" | "NICKNAME_AS_GIVEN" | "NICKNAME_AS_FAMILY" | "SUFFIX_REMOVED" | "MIDDLE_INITIAL_OMITTED" | "MIDDLE_NAME_OMITTED" | "PARENTHESIZED_NICKNAME";

export interface CampaignNameForm {
  readonly form: string;
  readonly rules: readonly CampaignNameRule[];
}

/**
 * Every exact form the filed name may be compared as. `lib/identity/name-forms.ts`
 * supplies the annotation rules (quoted nickname, generational suffix). Two
 * more are named here, each as exact as those:
 *
 * - `PARENTHESIZED_NICKNAME` — a filing that writes `Arthur J. (Art)` marks the
 *   nickname with parentheses where others use quotes; it is read as a quote.
 * - `MIDDLE_INITIAL_OMITTED` — a single-letter middle initial (`Rita C.`) is
 *   dropped. An initial is not a name a campaign is run under, and dropping a
 *   one-letter token cannot turn one person's name into another's.
 *
 * A diminutive (`Alex` for `Alexander`) is never generated.
 */
export function campaignNameForms(identity: Pick<CampaignSiteIdentity, "givenName" | "familyName">): CampaignNameForm[] {
  const given = identity.givenName.replace(/\(([^)]+)\)/g, '"$1"');
  const parenthesized = given !== identity.givenName;
  const family = identity.familyName;
  const out = new Map<string, CampaignNameForm>();
  const add = (form: string, rules: readonly CampaignNameRule[]) => {
    const key = comparisonText(form);
    if (key.split(" ").length < 2) return;
    const held = out.get(key);
    if (held === undefined || held.rules.length > rules.length) out.set(key, { form: key, rules });
  };
  for (const form of nameForms(`${given} ${family}`)) {
    const rules: CampaignNameRule[] = [...(parenthesized ? ["PARENTHESIZED_NICKNAME" as const] : []), ...form.rules];
    add(form.form, rules);
    const tokens = comparisonText(form.form).split(" ");
    if (tokens.length >= 3) {
      const kept = tokens.filter((token, index) => index === 0 || index === tokens.length - 1 || token.length > 1);
      if (kept.length !== tokens.length) add(kept.join(" "), [...rules, "MIDDLE_INITIAL_OMITTED"]);
    }
  }
  const givenTokens = comparisonText(identity.givenName).split(" ");
  if (givenTokens.length > 1 && givenTokens.slice(1).some(token => token.length > 1) && !/["()]/.test(identity.givenName)) {
    // Only given-name middle tokens may be omitted. A multiword family name
    // stays whole, and the chain still requires a unique canonical identity.
    add(`${givenTokens[0]} ${family}`, ["AS_PUBLISHED", "MIDDLE_NAME_OMITTED"]);
  }
  return [...out.values()].sort((a, b) => a.rules.length - b.rules.length || a.form.localeCompare(b.form));
}

export function brandTokens(identity: Pick<CampaignSiteIdentity, "givenName" | "familyName">): string[] {
  const tokens = new Set<string>();
  for (const form of campaignNameForms(identity)) for (const token of form.form.split(" ")) if (token.replace(/'/g, "").length >= 3) tokens.add(token.replace(/'/g, ""));
  return [...tokens];
}

/** Some segment of the title (split on `|`, `-`, `–`, `—`, `:`, `·`) must begin with the name, optionally after elect, re-elect, vote, meet or team, and be the name alone or `<name> for …`. */
export function titleBrandsCandidate(title: string, forms: readonly string[]): string | null {
  const segments = title.split(/\s+[|\-–—:·•]\s+|\s*[|–—·•]\s*/).map(comparisonText).filter((segment) => segment !== "");
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const branded = new RegExp(`^(?:(?:re ?elect|elect|vote(?: for)?|meet|team)\\s+)?${escaped}(?:\\s+(?:for|4)\\b.*)?$`);
    if (segments.some((segment) => branded.test(segment))) return form;
  }
  return null;
}

export function officeForms(officeTitle: string): string[] {
  const core = comparisonText(
    officeTitle
      .replace(/\([^)]*\)/g, " ")
      .replace(/^member of (the )?/i, "")
      .replace(/[,—–-]\s*(unexpired term|at-large|ward \d+).*$/i, "")
      .replace(/\b(unexpired term|at-large)\b/gi, " ")
      .replace(/,.*$/, "")
      .replace(/^(merrimack|morris|pima|maricopa|[a-z]+) county (?=(attorney|commissioner|sheriff|treasurer|register))/i, "county "),
  );
  const forms = new Set<string>([core]);
  const add = (...values: string[]) => values.forEach((value) => forms.add(comparisonText(value)));
  if (/township committee/.test(core)) add("township committee", "town committee", "committeeman", "committeewoman", "committee member");
  if (/\b(township|town|borough|city) council\b/.test(core)) add(core, "council member", "councilmember", "councilman", "councilwoman", "town council", "borough council", "township council");
  if (/board of education/.test(core)) add("board of education", "school board", "board of ed", "boe");
  if (/board of county commissioners/.test(core)) add("county commissioner", "county commissioners", "commissioner");
  if (/county commissioner/.test(core)) add("county commissioner", "commissioner");
  if (/house of representatives|u ?s representative|representative in congress/.test(core)) add("congress", "congressional", "us house", "u s house", "house of representatives", "us representative", "congressman", "congresswoman");
  if (/united states senat|us senat|u s senat/.test(core)) add("us senate", "u s senate", "united states senate", "senate", "senator");
  if (/state senator/.test(core)) add("state senate", "state senator", "senate", "senator");
  if (/state representative/.test(core)) add("state representative", "state house", "state rep", "house of representatives");
  if (/executive councilor/.test(core)) add("executive council", "executive councilor");
  if (/corporation commissioner/.test(core)) add("corporation commission", "corporation commissioner");
  if (/state mine inspector/.test(core)) add("mine inspector");
  if (/superintendent of public instruction/.test(core)) add("superintendent of public instruction", "superintendent");
  if (/treasurer/.test(core)) add("treasurer");
  if (/county attorney/.test(core)) add("county attorney");
  if (/register of (deeds|probate)/.test(core)) add(core.replace(/^county /, ""));
  if (/sheriff/.test(core)) add("sheriff");
  return [...forms].filter((form) => form.length > 0);
}

export function candidateDisplayName(identity: Pick<CampaignSiteIdentity, "givenName" | "familyName">): string {
  const cap = (word: string) => (word === word.toUpperCase() && /[A-Z]/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word);
  return `${identity.givenName} ${identity.familyName}`.split(/\s+/).map((word) => word.split("-").map(cap).join("-")).join(" ").trim();
}

const STATE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(US_STATES.map(state => [state.code, comparisonText(state.name)]));

export function districtForms(identity: Pick<CampaignSiteIdentity, "ocdId" | "officeTitle" | "stateCode">): string[] {
  const forms = new Set<string>();
  const add = (value: string) => {
    const text = comparisonText(value);
    if (text.length >= 3) forms.add(text);
  };
  const path = identity.ocdId.replace(/^ocd-division\/country:us\//, "");
  const segments = path.split("/");
  const last = segments.at(-1) ?? "";
  const [kind, raw = ""] = last.split(":");
  const words = raw.replace(/_/g, " ");
  if (kind === "state") add(STATE_NAMES[raw] ?? raw);
  if (kind === "county") add(`${words} county`);
  if (kind === "place") {
    add(words);
    if (/ township$/.test(words)) add(words.replace(/ township$/, " twp"));
  }
  if (kind === "school_district") add(words.replace(/ school district$/, " school"));
  if (kind === "cd" && /^\d+$/.test(raw)) {
    const n = Number(raw);
    const ord = `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
    add(`congressional district ${n}`);
    add(`${ord} congressional district`);
    add(`${ord} district`);
    add(`cd ${n}`);
    add(`cd${n}`);
    add(`${identity.stateCode.toLowerCase()} ${n}`);
  }
  if ((kind === "sldl" || kind === "sldu") && /^\d+$/.test(raw) && Number(raw) < 100) {
    add(`legislative district ${Number(raw)}`);
    add(`ld ${Number(raw)}`);
    add(`ld${Number(raw)}`);
    add(`district ${Number(raw)}`);
  }
  for (const m of identity.officeTitle.matchAll(/\b(district|ward)\s+(\d+)\b/gi)) add(`${m[1]} ${m[2]}`);
  const county = /^([A-Z][a-z]+) County\b/.exec(identity.officeTitle)?.[1];
  if (county) add(`${county} county`);
  return [...forms].sort();
}

/**
 * Phrases that make a nearby year an ELECTION year. Checked on the comparison
 * text (lower case, punctuation as spaces). Bare "general" is deliberately
 * absent: "Attorney General 2019" is an office, not an election.
 */
const ELECTION_PHRASE = /\b(elect|elected|electing|election|elections|re ?elect|reelect|vote|votes|voting|ballot|campaign|candidate|candidacy|running for|run for|primary|general election|paid for by|donate|endorse|endorsed|endorsement)\b/g;

export interface CycleEvidence {
  readonly state: "CURRENT" | "HISTORICAL" | "NOT_EVIDENCED";
  readonly span: { readonly year: number; readonly phrase: string; readonly index: number; readonly excerpt: string; readonly where: "TITLE" | "PAGE" | "INDEPENDENT_PROFILE" } | null;
  readonly source?: CampaignSiteSourceReference;
  readonly earlierYears: readonly number[];
}

export function cycleEvidence(text: string, headings: readonly string[], cycle: number): CycleEvidence {
  const years = new Map<number, { index: number; phrase: string }[]>();
  const phrases = [...text.matchAll(ELECTION_PHRASE)].map((m) => ({ index: m.index ?? 0, phrase: m[0] }));
  for (const m of text.matchAll(/\b(19[89]\d|20\d\d)\b/g)) {
    const year = Number(m[1]);
    const index = m.index ?? 0;
    const near = phrases.find((p) => Math.abs(p.index - index) <= CYCLE_WINDOW_CHARS);
    if (near === undefined) continue;
    years.set(year, [...(years.get(year) ?? []), { index, phrase: near.phrase }]);
  }
  for (const heading of headings) {
    const normalized = comparisonText(heading);
    if (new RegExp(`\\b${cycle}\\b`).test(normalized)) {
      return { state: "CURRENT", span: { year: cycle, phrase: "title", index: 0, excerpt: heading, where: "TITLE" }, earlierYears: [] };
    }
  }
  const current = years.get(cycle)?.[0];
  if (current !== undefined) {
    return { state: "CURRENT", span: { year: cycle, phrase: current.phrase, index: current.index, excerpt: excerpt(text, current.index, 4), where: "PAGE" }, earlierYears: [] };
  }
  const earlier = [...years.keys()].filter((year) => year < cycle && year >= cycle - 12).sort((a, b) => b - a);
  return { state: earlier.length > 0 ? "HISTORICAL" : "NOT_EVIDENCED", span: null, earlierYears: earlier };
}

export interface CampaignSitePageRead {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly contentType: string;
  readonly body: string;
  /** sha256 (bare hex) of the exact bytes. */
  readonly sha256: string;
  readonly retrievedAt: string;
  readonly permissions: readonly { readonly origin: string; readonly verdict: PermissionVerdict; readonly detail: string }[];
  readonly redirects: readonly { readonly from: string; readonly status: number; readonly to: string }[];
}

export interface CampaignSiteSourceReference {
  readonly artifactId: string;
  readonly sha256: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly contentType: string;
  readonly readAt: string;
}

export interface CampaignSiteSupportingRead {
  readonly source: CampaignSiteSourceReference;
  readonly page: CampaignSitePageRead;
}

function* offSiteLinks(page: CampaignSitePageRead): Generator<{ url: URL; attributes: string; inner: string }> {
  const html = page.body.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]!);
    if (!href) continue;
    let url: URL;
    try { url = new URL((href[1] ?? href[2] ?? href[3]!).replace(/&amp;/g, "&"), page.finalUrl); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || siteHost(url.href) === siteHost(page.finalUrl)) continue;
    yield { url, attributes: match[1]!, inner: match[2]! };
  }
}

export function linkedSiteHosts(page: CampaignSitePageRead): Set<string> {
  const hosts = new Set<string>();
  for (const { url } of offSiteLinks(page)) {
    const host = siteHost(url.href);
    if (host !== null) hosts.add(host);
  }
  return hosts;
}

export function profileCampaignSiteLeads(page: CampaignSitePageRead, subject: CampaignSiteIdentity, ref: string): CampaignSiteLead[] {
  const headings = pageHeadings(page.body).headings;
  const forms = campaignNameForms(subject).map(form => form.form);
  const words = comparisonText(pageVisibleText(page.body));
  const contains = (form: string) => ` ${words} `.includes(` ${comparisonText(form)} `);
  if (!headings.some(heading => titleBrandsCandidate(heading, forms) !== null) ||
    ![...officeForms(subject.officeTitle), ...districtForms(subject)].some(contains)) return [];
  const links: { url: string; label: string }[] = [];
  for (const { url, attributes, inner } of offSiteLinks(page)) {
    if (campaignSiteHostRefusal(url.href)) continue;
    const accessible = /\b(?:aria-label|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
    links.push({ url: url.href, label: comparisonText(pageVisibleText(inner) + " " + (accessible?.[1] ?? accessible?.[2] ?? "")) });
  }
  const websites = links.filter(link => /^(?:(?:official|candidate|campaign|personal) )*(?:website|web site|campaign site|campaign page)$/.test(link.label));
  const hosts = new Set(websites.map(link => siteHost(link.url)));
  return [...new Set([...websites, ...links.filter(link => hosts.has(siteHost(link.url)) && /^(?:learn more|read more|source|platform|issues)$/.test(link.label))].map(link => link.url))]
    .map(url => ({ url, origin: "SCOUT_FINDING", ref }));
}

export function profileSupportsCampaign(identity: CampaignSiteIdentity, primary: CampaignSitePageRead, supporting: CampaignSiteSupportingRead): boolean {
  const { page, source } = supporting;
  const age = Math.abs(Date.parse(primary.retrievedAt) - Date.parse(page.retrievedAt));
  const words = comparisonText(pageVisibleText(page.body));
  const districts = districtForms(identity);
  const state = STATE_NAMES[identity.stateCode.toLowerCase()] ?? identity.stateCode.toLowerCase();
  const districtNumber = /\/(?:cd|sldl|sldu):(\d+)(?:\/|$)/.exec(identity.ocdId)?.[1];
  const conflictingDistrict = districtNumber !== undefined &&
    [...words.matchAll(/\b(?:(?:congressional|legislative) )?(?:district|ld|cd)\s*(\d+)\b/g)]
      .some(match => Number(match[1]) !== Number(districtNumber));
  // A general office title must not certify the same name in a different
  // district. Numbered districts also need their state, not just "District 2".
  const jurisdiction = firstSpan(words, officeForms(identity.officeTitle)) !== null &&
    (districts.length === 0 || firstSpan(words, districts) !== null) &&
    (!/\/(?:cd|sldl|sldu):/.test(identity.ocdId) || firstSpan(words, [state, comparisonText(identity.stateCode)]) !== null);
  return Number.isFinite(age) && age <= 14 * 24 * 60 * 60 * 1000 &&
    jurisdiction && !conflictingDistrict &&
    source.sha256 === page.sha256 && createHash("sha256").update(page.body, "utf8").digest("hex") === source.sha256 &&
    source.requestedUrl === page.requestedUrl && source.finalUrl === page.finalUrl && source.readAt === page.retrievedAt &&
    source.httpStatus === page.httpStatus && source.contentType === page.contentType &&
    page.httpStatus >= 200 && page.httpStatus < 300 && /html/i.test(page.contentType) &&
    registrableDomain(siteHost(page.finalUrl) ?? "") !== registrableDomain(siteHost(primary.finalUrl) ?? "") &&
    cycleEvidence(comparisonText(pageVisibleText(page.body)), pageHeadings(page.body).headings, identity.cycle).state === "CURRENT" &&
    profileCampaignSiteLeads(page, identity, source.artifactId).some(lead => siteHost(lead.url) === siteHost(primary.finalUrl));
}

export interface CampaignSiteSpan {
  readonly form: string;
  readonly index: number;
  readonly excerpt: string;
}

export interface CampaignSiteMeasurement {
  readonly verifierId: typeof CAMPAIGN_SITE_VERIFIER_ID;
  readonly candidacyId: string;
  readonly lead: CampaignSiteLead;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly contentType: string;
  readonly sha256: string;
  readonly retrievedAt: string;
  readonly title: string | null;
  readonly name: (CampaignSiteSpan & { readonly rules: readonly CampaignNameRule[] }) | null;
  readonly office: CampaignSiteSpan | null;
  readonly district: CampaignSiteSpan | null;
  readonly branding: { readonly by: "HOST" | "TITLE"; readonly evidence: string } | null;
  readonly cycle: CycleEvidence;
  readonly permissions: CampaignSitePageRead["permissions"];
  readonly redirects: CampaignSitePageRead["redirects"];
}

export type CampaignSiteVerdict =
  | {
      readonly verdict: "VERIFIED";
      readonly measurement: CampaignSiteMeasurement;
      readonly verification: string;
    }
  | {
      readonly verdict: "REFUSED";
      readonly lead: CampaignSiteLead;
      readonly candidacyId: string;
      readonly refusals: readonly CampaignSiteRefusal[];
      readonly historical: { readonly years: readonly number[] } | null;
      readonly measurement: CampaignSiteMeasurement | null;
    };

const refusal = (identity: CampaignSiteIdentity, lead: CampaignSiteLead, refusals: readonly CampaignSiteRefusal[], measurement: CampaignSiteMeasurement | null, historical: readonly number[] | null = null): CampaignSiteVerdict => ({
  verdict: "REFUSED",
  lead,
  candidacyId: identity.candidacyId,
  refusals,
  historical: historical === null ? null : { years: historical },
  measurement,
});

function firstSpan(text: string, forms: readonly string[]): CampaignSiteSpan | null {
  for (const form of forms) {
    const index = wordIndex(text, form);
    if (index >= 0) return { form, index, excerpt: excerpt(text, index, form.length) };
  }
  return null;
}

export function verifyCampaignSitePage(identity: CampaignSiteIdentity, lead: CampaignSiteLead, read: CampaignSitePageRead,
  supporting?: CampaignSiteSupportingRead): CampaignSiteVerdict {
  const hostRefused = campaignSiteHostRefusal(read.finalUrl);
  const text = comparisonText(pageVisibleText(read.body));
  const { title, headings } = pageHeadings(read.body);
  const forms = campaignNameForms(identity);
  let name: CampaignSiteMeasurement["name"] = null;
  for (const form of forms) {
    const index = wordIndex(text, form.form);
    if (index >= 0) {
      name = { form: form.form, rules: form.rules, index, excerpt: excerpt(text, index, form.form.length) };
      break;
    }
  }
  const office = firstSpan(text, officeForms(identity.officeTitle));
  const district = firstSpan(text, districtForms(identity));
  const host = siteHost(read.finalUrl) ?? "";
  const label = siteLabel(host).replace(/[^a-z0-9]/g, "");
  const hostToken = brandTokens(identity).find((token) => label.includes(token.replace(/\s+/g, "")));
  const titleForm = headings.map((heading) => titleBrandsCandidate(heading, forms.map((f) => f.form))).find((form) => form !== null) ?? null;
  /*
   * A title alone never brands a page on a host that does not carry the
   * candidate's name: profile, directory and news pages title themselves with
   * a name too. It must also carry the campaign's own disclaimer ("paid for
   * by", "authorized by"), which a candidate's committee publishes and a third
   * party's page does not.
   */
  const disclaimer = /\b(paid for by|authorized by)\b/.test(text);
  const branding: CampaignSiteMeasurement["branding"] = hostToken !== undefined
    ? { by: "HOST", evidence: `${host} carries "${hostToken}"` }
    : titleForm !== null && disclaimer
      ? { by: "TITLE", evidence: `the page calls itself the candidate's ("${titleForm}") and carries a campaign disclaimer` }
      : null;
  let cycle = cycleEvidence(text, headings, identity.cycle);
  if (cycle.state === "NOT_EVIDENCED" && supporting && profileSupportsCampaign(identity, read, supporting)) {
    const supported = cycleEvidence(comparisonText(pageVisibleText(supporting.page.body)), pageHeadings(supporting.page.body).headings, identity.cycle);
    cycle = { ...supported, span: { ...supported.span!, where: "INDEPENDENT_PROFILE" }, source: supporting.source };
  }
  const measurement: CampaignSiteMeasurement = {
    verifierId: CAMPAIGN_SITE_VERIFIER_ID,
    candidacyId: identity.candidacyId,
    lead,
    requestedUrl: read.requestedUrl,
    finalUrl: read.finalUrl,
    httpStatus: read.httpStatus,
    contentType: read.contentType,
    sha256: read.sha256,
    retrievedAt: read.retrievedAt,
    title,
    name,
    office,
    district,
    branding,
    cycle,
    // Robots verdicts are recorded evidence; they refuse nothing.
    permissions: read.permissions,
    redirects: read.redirects,
  };

  const refusals: CampaignSiteRefusal[] = [];
  if (hostRefused !== null) refusals.push(hostRefused);
  if (!read.finalUrl.startsWith("https://")) refusals.push({ code: "NOT_HTTPS", detail: `${read.finalUrl} is not HTTPS; a reader link is HTTPS only` });
  const control = accessControlIn({ status: read.httpStatus, text: read.body });
  if (read.httpStatus < 200 || read.httpStatus >= 300) {
    refusals.push({ code: "HTTP_NOT_OK", detail: `${read.finalUrl} answered HTTP ${read.httpStatus}${control === null ? "" : ` (${control.detail})`}` });
  } else if (control !== null) {
    refusals.push({ code: "ACCESS_CONTROLLED", detail: `${read.finalUrl}: ${control.detail}` });
  }
  if (!/html/i.test(read.contentType)) refusals.push({ code: "NOT_HTML", detail: `${read.finalUrl} is ${read.contentType || "an untyped body"}, not a web page` });
  if (refusals.length > 0) return refusal(identity, lead, refusals, measurement);

  if (title !== null && ORGANIZATION_TITLE.test(comparisonText(title))) {
    refusals.push({ code: "PARTY_OR_ORGANIZATION", detail: `the page calls itself "${title}": a party or organization page, not the candidate's own site` });
  }
  if (name === null) {
    refusals.push({ code: "CANDIDATE_NOT_NAMED", detail: `no exact form of the filed name (${forms.map((f) => `"${f.form}"`).join(", ")}) occurs on the page` });
  }
  if (office === null && district === null) {
    refusals.push({ code: "OFFICE_NOT_NAMED", detail: `the page names neither the office (${officeForms(identity.officeTitle).slice(0, 6).join(", ")}) nor the district (${districtForms(identity).join(", ") || "none derivable"})` });
  }
  if (name !== null && branding === null) {
    refusals.push({ code: "SITE_NOT_CANDIDATE_BRANDED", detail: `${host} does not carry the candidate's name, and the page does not both title itself as theirs and carry a campaign disclaimer; a page about them on someone else's site is not their site` });
  }
  if (cycle.state === "HISTORICAL") {
    refusals.push({ code: "HISTORICAL_CYCLE", detail: `the page's election phrases carry ${cycle.earlierYears.join(", ")} and never ${identity.cycle}: this is a past-cycle site, labelled historical` });
  } else if (cycle.state === "NOT_EVIDENCED") {
    refusals.push({ code: "CYCLE_NOT_EVIDENCED", detail: `no ${identity.cycle} appears in the title or beside an election phrase; a site with no year cannot be told from a past cycle's` });
  }
  if (refusals.length > 0) {
    return refusal(identity, lead, refusals, measurement, cycle.state === "HISTORICAL" && name !== null ? cycle.earlierYears : null);
  }
  const where = office !== null ? `the office ("${office.form}")` : `the district ("${district!.form}")`;
  return {
    verdict: "VERIFIED",
    measurement,
    verification: `Fetched ${read.retrievedAt.slice(0, 10)} (${CAMPAIGN_SITE_VERIFIER_ID}): '${title ?? host}' — names ${candidateDisplayName(identity)}, ${where}${cycle.source
      ? `; ${cycle.source.finalUrl} identifies the ${identity.cycle} election` : `, and the ${identity.cycle} election`}.`
      .replace(/\s+/g, " "),
  };
}

/**
 * Read one lead robots-first, recording the robots verdict. The host is judged before any request, so a
 * social, aggregator, news, government, archive or search host is never asked
 * for anything, robots.txt included.
 */
export async function readCampaignSiteLead(
  lead: CampaignSiteLead,
  runtime: ResearchRuntime,
): Promise<{ readonly ok: true; readonly read: CampaignSitePageRead } | { readonly ok: false; readonly refusal: CampaignSiteRefusal; readonly fetched: ResearchFetchResult | null }> {
  const pre = campaignSiteHostRefusal(lead.url);
  if (pre !== null) return { ok: false, refusal: pre, fetched: null };
  const fetched = await researchFetch(lead.url, runtime);
  if (fetched.outcome === "REFUSED") {
    const code = /recorded wall|waits on the owner/.test(fetched.reason) ? "ACCESS_CONTROLLED" : /redirect|not a public/.test(fetched.reason) ? "LEAD_URL_INVALID" : "TRANSPORT_FAILED";
    return { ok: false, refusal: { code, detail: `${fetched.refusedUrl}: ${fetched.reason}` }, fetched };
  }
  if (fetched.transportError !== null || fetched.status === null || fetched.sha256 === null) {
    return { ok: false, refusal: { code: "TRANSPORT_FAILED", detail: `${fetched.finalUrl}: ${fetched.transportError ?? "no status"}` }, fetched };
  }
  const retrievedAt = new Date(runtime.now()).toISOString();
  return {
    ok: true,
    read: {
      requestedUrl: lead.url,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
      body: new TextDecoder().decode(fetched.body),
      sha256: fetched.sha256,
      retrievedAt,
      permissions: fetched.permissions,
      redirects: fetched.redirects,
    },
  };
}

export function heldPageRead(input: {
  readonly requestedUrl: string;
  readonly finalUrl?: string;
  readonly httpStatus: number;
  readonly contentType: string;
  readonly body: string;
  readonly retrievedAt: string;
  readonly sha256?: string;
}): CampaignSitePageRead {
  return {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl ?? input.requestedUrl,
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    body: input.body,
    sha256: input.sha256 ?? createHash("sha256").update(input.body, "utf8").digest("hex"),
    retrievedAt: input.retrievedAt,
    permissions: [],
    redirects: [],
  };
}
