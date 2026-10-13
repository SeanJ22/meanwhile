import { first, hasClass, linkUrl, nodes, parseHtml, textOf, type HtmlNode, type StateRosterRecord } from "./html.ts";

type Chamber = "lower" | "upper";
type Document = { url: string; body: string; retrievedAt?: string };
type Result = { records: StateRosterRecord[]; complete: boolean; chambers: Chamber[] };

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const elementText = (root: HtmlNode, predicate: (node: HtmlNode) => boolean) => { const node = first(root, predicate); return node ? textOf(node) : ""; };
const cells = (row: HtmlNode) => row.children.filter((node): node is HtmlNode => typeof node !== "string" && (node.tag === "td" || node.tag === "th"));
const profile = (root: HtmlNode, pattern: RegExp) => first(root, node => node.tag === "a" && pattern.test(node.attrs.href ?? ""));
const PARTIES: Readonly<Record<string, string>> = { D: "Democratic", Democrat: "Democratic", R: "Republican", I: "Independent", DFL: "Democratic" };
const party = (value: string | null | undefined) => PARTIES[value ?? ""] ?? (value || null);
const isVacancy = (name: string) => /\bvacant\b|\bvacancy\b|pending election/i.test(name);

function orderedName(value: string): string {
  return clean(value).replace(/^\*\s*/, "");
}

function sourceDate(value: string): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2})(?:T|\b)/.exec(value)?.[1];
  if (iso) return iso;
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/.exec(value);
  if (!m) return null;
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

function result(records: StateRosterRecord[], chambers: Chamber[], complete = true): Result {
  if (!records.length) throw new Error("Official legislature source did not contain its observed roster structure");
  const unique = new Map<string, StateRosterRecord>();
  for (const record of records) {
    if (!record.name || !record.district) throw new Error("Official legislature roster row lacks its published name or district");
    unique.set(`${record.chamber}:${record.district}:${record.nativeId ?? record.name}`, record);
  }
  return { records: [...unique.values()], complete, chambers };
}

/** Reconcile explicitly departed publisher rows with their listed successors. */
function currentSeats(records: StateRosterRecord[], departed: Map<string, string | null>): StateRosterRecord[] {
  const held = new Set(records.filter(row => !row.vacant).map(row => `${row.chamber}:${row.district}`));
  return records.filter(row => !row.vacant || !held.has(`${row.chamber}:${row.district}`)).map(row => row.vacant && !row.since
    ? { ...row, since: departed.get(`${row.chamber}:${row.district}`) ?? null } : row);
}

function california(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const assembly = nodes(root, node => hasClass(node, "members-list__member"));
  const senate = nodes(root, node => hasClass(node, "page-members__member"));
  const boxes = assembly.length ? assembly : senate;
  const chamber = assembly.length ? "lower" : senate.length ? "upper" : defaultChamber;
  if (!chamber || !boxes.length) return result([], []);
  const records = boxes.map(box => {
    const name = assembly.length ? box.attrs["data-name"]! : elementText(box, node => hasClass(node, "member__name"));
    const anchor = profile(box, assembly.length ? /\/assemblymembers\/\d+/ : /\.senate\.ca\.gov\//);
    return { name: orderedName(name), district: String(Number(box.attrs["data-district"])), chamber, sourceUrl: anchor ? linkUrl(anchor, document.url) : document.url, party: party(box.attrs["data-party"]), vacant: isVacancy(name) };
  });
  return result(records, [chamber]);
}

function colorado(document: Document, root: HtmlNode): Result {
  const rows = nodes(root, node => node.tag === "tr" && !!first(node, child => child.attrs["data-label"] === "District"));
  const records: StateRosterRecord[] = [];
  const departed = new Map<string, string | null>();
  for (const row of rows) {
    const value = (label: string) => elementText(row, node => node.attrs["data-label"] === label);
    const title = value("Title");
    if (!/^(Senator|Representative)$/.test(title)) throw new Error("Colorado official district row has an unrecognized holder title");
    const chamber = title === "Senator" ? "upper" : "lower";
    const district = value("District");
    const nameCell = first(row, node => node.attrs["data-label"] === "Name")!;
    const anchor = profile(nameCell, /\/legislators\//);
    const name = anchor ? textOf(anchor) : textOf(nameCell);
    const left = /\bresigned\b|\bdeceased\b/i.test(textOf(nameCell));
    const since = left ? sourceDate(textOf(nameCell)) : null;
    if (left) departed.set(`${chamber}:${district}`, since);
    records.push({ name: left ? "Vacant" : orderedName(name), district, chamber, sourceUrl: document.url, nativeId: anchor && !left ? linkUrl(anchor, document.url) : undefined, party: left ? null : party(value("Party")), vacant: left || isVacancy(name), since });
  }
  return result(currentSeats(records, departed), ["lower", "upper"]);
}

function florida(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const boxes = nodes(root, node => hasClass(node, "team-box"));
  if (boxes.length) {
    const records: StateRosterRecord[] = [];
    const departed = new Map<string, string | null>();
    for (const box of boxes) {
      const full = textOf(box);
      const district = /\bDistrict:\s*(\d+)/i.exec(full)?.[1];
      if (!district) throw new Error("Florida official member box lacks its published district");
      const anchor = profile(box, /\/details\.aspx\?MemberId=/i);
      const name = elementText(box, node => node.tag === "h5") || "Vacant";
      const left = /\((Resigned|Deceased)\)/i.test(full);
      const vacant = !anchor || left || isVacancy(name);
      const end = /\d{1,2}\/\d{1,2}\/\d{2,4}\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(full)?.[1];
      const since = left && end ? sourceDate(end) : null;
      if (left) { departed.set(`lower:${district}`, since); continue; }
      records.push({ name: vacant ? "Vacant" : orderedName(name), district, chamber: "lower", sourceUrl: vacant ? document.url : linkUrl(anchor!, document.url), nativeId: anchor ? /MemberId=(\d+)/i.exec(anchor.attrs.href ?? "")?.[1] : undefined, party: vacant ? null : party(/\b(Republican|Democrat)\b/.exec(full)?.[1]), vacant });
    }
    // A vacancy is explicit on the publisher roster; former holders are used only for its date.
    return result(currentSeats(records, departed), ["lower"]);
  }
  const rows = nodes(root, node => node.tag === "tr" && !!first(node, child => hasClass(child, "senatorLink")));
  const records = rows.map(row => {
    const anchor = first(row, node => hasClass(node, "senatorLink"))!;
    const columns = cells(row);
    const name = textOf(anchor);
    return { name: orderedName(name), district: textOf(columns[1]!), chamber: "upper" as const, sourceUrl: isVacancy(name) ? document.url : linkUrl(anchor, document.url), party: party(textOf(columns[2]!)), vacant: isVacancy(name) };
  });
  return result(records, [defaultChamber ?? "upper"]);
}

function iowa(document: Document, root: HtmlNode): Result {
  const rows = nodes(root, node => node.tag === "tr" && !!profile(node, /\/legislators\/legislator\?/));
  const departed = new Map<string, string | null>();
  const records = rows.map(row => {
    const columns = cells(row);
    const anchor = profile(row, /\/legislators\/legislator\?/)!;
    const chamber = /^Senate$/i.test(textOf(columns[0]!)) ? "upper" as const : "lower" as const;
    const district = textOf(columns[2]!);
    const ended = /\(\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\)/.exec(textOf(anchor));
    const since = ended ? sourceDate(ended[1]!) : null;
    if (ended) departed.set(`${chamber}:${district}`, since);
    return { name: ended ? "Vacant" : textOf(anchor), district, chamber, sourceUrl: ended ? document.url : linkUrl(anchor, document.url), nativeId: anchor.attrs["data-pid"], party: ended ? null : party(textOf(columns[3]!)), vacant: !!ended, since };
  });
  return result(currentSeats(records, departed), [...new Set(records.map(record => record.chamber))]);
}

function idaho(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const rows = nodes(root, node => node.tag === "p" && !!profile(node, /\/legislators\/membership\/?\?/));
  const chamber = defaultChamber ?? (/\/house\//.test(document.url) ? "lower" : "upper");
  const records = rows.map(row => {
    const anchor = profile(row, /\/legislators\/membership\/?\?/)!;
    const district = /\bDistrict\s*(\d+)/.exec(textOf(anchor))?.[1] ?? "";
    const seat = /\bHouse Seat\s*([AB])/i.exec(textOf(row))?.[1];
    const name = elementText(row, node => node.tag === "strong");
    return { name, district, chamber, sourceUrl: document.url, seat, seatBound: true, party: party(/\(\s*([DRI])\s*\)/.exec(textOf(row))?.[1]) };
  });
  return result(records, [chamber]);
}

function kentucky(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const rows = nodes(root, node => node.tag === "a" && hasClass(node, "Legislator-Card"));
  const chamber = defaultChamber ?? (/house-of-representatives/.test(document.url) ? "lower" : "upper");
  return result(rows.map(row => {
    const name = elementText(row, node => node.tag === "h3");
    return { name, district: /\bDistrict:\s*(\d+)/.exec(textOf(row))?.[1] ?? "", chamber, sourceUrl: linkUrl(row, document.url), party: party(elementText(row, node => node.tag === "small")), vacant: isVacancy(name) };
  }), [chamber]);
}

function louisiana(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const rows = nodes(root, node => hasClass(node, "card-body") && !!first(node, child => hasClass(child, "legnamelink")));
  const chamber = defaultChamber ?? (/house\./.test(document.url) ? "lower" : "upper");
  return result(rows.map(row => {
    const anchor = first(row, node => hasClass(node, "legnamelink"))!;
    const name = textOf(anchor);
    const district = /\bDistrict\s*(\d+)/.exec(textOf(row))?.[1] ?? "";
    return { name: orderedName(name), district, chamber, sourceUrl: isVacancy(name) ? document.url : linkUrl(anchor, document.url), nativeId: /ID=(\d+)/i.exec(anchor.attrs.href ?? "")?.[1], party: party(/\b(Republican|Democrat|Independent)\b/.exec(textOf(row))?.[1]), vacant: isVacancy(name) };
  }), [chamber]);
}

function massachusetts(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const rows = nodes(root, node => node.tag === "tr" && (!!profile(node, /\/Legislators\/Profile\//) || !!first(node, child => hasClass(child, "vacantStarPlaceholder"))));
  const chamber = defaultChamber ?? (/\/House/i.test(document.url) ? "lower" : "upper");
  return result(rows.map(row => {
    const columns = cells(row);
    const vacant = textOf(columns[2]!) === "Vacant";
    const name = vacant ? "Vacant" : `${textOf(columns[2]!)} ${textOf(columns[3]!)}`.trim();
    const anchor = profile(row, /\/Legislators\/Profile\//);
    return { name, district: textOf(columns[vacant ? 3 : 4]!), chamber, sourceUrl: vacant ? document.url : linkUrl(anchor!, document.url), party: vacant ? null : party(textOf(columns[5]!)), vacant };
  }), [chamber]);
}

function maryland(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const rows = nodes(root, node => hasClass(node, "member-index-cell"));
  const chamber = defaultChamber ?? (/\/Index\/house/i.test(document.url) ? "lower" : "upper");
  return result(rows.map(row => {
    const anchors = nodes(row, node => node.tag === "a" && /\/Members\/Details\//.test(node.attrs.href ?? "") && !!textOf(node));
    const anchor = anchors.find(node => !first(node, child => child.tag === "img")) ?? anchors[0];
    if (!anchor) throw new Error("Maryland official roster row lacks its member profile");
    const name = textOf(anchor);
    return { name: orderedName(name), district: /\bDistrict\s*(\d+[A-C]?)/i.exec(textOf(row))?.[1] ?? "", chamber, sourceUrl: linkUrl(anchor, document.url), nativeId: (anchor.attrs.href ?? "").split("/").at(-1), party: party(/\b(Republican|Democrat|Independent)\b/.exec(textOf(row))?.[1]), vacant: isVacancy(name) };
  }), [chamber]);
}

function maine(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  if (defaultChamber === "lower" || /\/house\//.test(document.url)) {
    // The publisher separately identifies tribal representatives, with no territorial district.
    const allRows = nodes(root, node => node.tag === "tr" && !!profile(node, /\/MemberProfiles\/Details\//));
    const rows = allRows.filter(row => !/\bTribal Representative\b/.test(textOf(row)));
    const records = rows.map(row => {
      const anchor = profile(row, /\/MemberProfiles\/Details\//)!;
      const columns = cells(row);
      const left = /\b(?:Resigned|Deceased)\b/.test(textOf(columns[1]!));
      return { name: left ? "Vacant" : orderedName(textOf(anchor)), district: textOf(columns[3]!), chamber: "lower" as const, sourceUrl: left ? document.url : linkUrl(anchor, document.url), party: left ? null : party(textOf(columns[2]!)), vacant: left };
    });
    return result(currentSeats(records, new Map()), ["lower"], rows.length === allRows.length);
  }
  const anchors = nodes(root, node => node.tag === "a" && /^\/District-?\d+$/i.test(node.attrs.href ?? ""));
  return result(anchors.map(anchor => ({ name: textOf(anchor), district: /\d+/.exec(anchor.attrs.href ?? "")![0], chamber: "upper", sourceUrl: linkUrl(anchor, document.url), party: party(/\(([DRI])-/.exec(textOf(anchor.parent!))?.[1]) })), ["upper"]);
}

function minnesota(document: Document, root: HtmlNode): Result {
  if (document.body.trimStart().startsWith("{")) {
    const data = JSON.parse(document.body) as { members?: { preferred_full_name: string; dist: string; mem_id: number; party?: string }[] };
    if (!Array.isArray(data.members)) return result([], []);
    return result(data.members.map(row => ({ name: row.preferred_full_name, district: String(row.dist), chamber: "upper", sourceUrl: `https://www.senate.mn/members/member_bio.html?mem_id=${row.mem_id}`, nativeId: String(row.mem_id), party: party(row.party), vacant: isVacancy(row.preferred_full_name) })), ["upper"]);
  }
  const alpha = first(root, node => node.attrs.id === "Alpha") ?? root;
  const rows = nodes(alpha, node => hasClass(node, "media") && hasClass(node, "my-3"));
  return result(rows.map(row => {
    const heading = first(row, node => node.tag === "h5")!;
    const anchor = profile(heading, /\/members\/profile\//)!;
    const match = /^(.+?)\s*\((\d+[AB]),\s*([^)]+)\)/i.exec(textOf(anchor));
    if (!match) throw new Error("Minnesota House source row lacks its published district");
    return { name: match[1]!, district: match[2]!, chamber: "lower", sourceUrl: linkUrl(anchor, document.url), nativeId: /profile\/(\d+)/.exec(anchor.attrs.href ?? "")?.[1], party: party(match[3]) };
  }), ["lower"]);
}

function missouri(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  if (defaultChamber === "lower" || /house\.mo/.test(document.url)) return result([], []);
  const anchors = nodes(root, node => node.tag === "a" && /\/Senators\/(?:Member\?id=|VacantSenator\?district=)/i.test(node.attrs.href ?? ""));
  return result(anchors.map(anchor => {
    const full = textOf(anchor);
    const name = /^(?:Senator\s+)?(.+?)\s+District\s+\d+$/i.exec(full)?.[1] ?? "";
    return { name: isVacancy(name) ? "Vacant" : name, district: /\bDistrict\s*(\d+)/.exec(full)?.[1] ?? "", chamber: "upper", sourceUrl: isVacancy(name) ? document.url : linkUrl(anchor, document.url), nativeId: /Member\?id=(\d+)/i.exec(anchor.attrs.href ?? "")?.[1], vacant: isVacancy(name) };
  }), ["upper"]);
}

function georgia(document: Document): Result {
  const rows = JSON.parse(document.body) as { id: number; fullName: string; district: { number: number; chamberType: number }; party: number; dateVacated: string | null; sessionId: number }[];
  if (!Array.isArray(rows)) return result([], []);
  const records: StateRosterRecord[] = [];
  const departed = new Map<string, string | null>();
  for (const row of rows) {
    if (![1, 2].includes(row.district?.chamberType) || !Number.isInteger(row.district?.number) || row.district.number < 1 || typeof row.fullName !== "string") throw new Error("Georgia official roster row lacks a published chamber, district, or name");
    const chamber = row.district.chamberType === 1 ? "lower" : "upper";
    const district = String(row.district.number);
    if (row.dateVacated) departed.set(`${chamber}:${district}`, sourceDate(row.dateVacated));
    records.push({ name: row.dateVacated ? "Vacant" : row.fullName, district, chamber, sourceUrl: row.dateVacated ? document.url : `https://www.legis.ga.gov/members/${chamber === "lower" ? "house" : "senate"}/${row.id}?session=${row.sessionId}`, nativeId: String(row.id), party: row.dateVacated ? null : row.party === 0 ? "Democratic" : "Republican", vacant: !!row.dateVacated, since: sourceDate(row.dateVacated ?? "") });
  }
  return result(currentSeats(records, departed), ["lower", "upper"]);
}

function delaware(document: Document): Result {
  const data = JSON.parse(document.body) as { Data?: { PersonFullName: string | null; PersonId: number | null; DistrictNumber: number; ChamberId: number; PartyCode: string | null }[] };
  if (!Array.isArray(data.Data)) return result([], []);
  const records = data.Data.map(row => {
    if (row.ChamberId !== 1 && row.ChamberId !== 2) throw new Error("Delaware official roster row has an unrecognized chamber");
    if (!Number.isInteger(row.DistrictNumber) || row.DistrictNumber < 1 || (typeof row.PersonFullName !== "string" && row.PersonFullName !== null)) throw new Error("Delaware official roster row lacks a published district or holder disposition");
    return { name: row.PersonFullName ? clean(row.PersonFullName) : "Vacant", district: String(row.DistrictNumber), chamber: row.ChamberId === 1 ? "upper" as const : "lower" as const, sourceUrl: document.url, nativeId: row.PersonId == null ? undefined : String(row.PersonId), party: party(row.PartyCode), vacant: row.PersonFullName === null || isVacancy(row.PersonFullName ?? "") };
  });
  return result(records, [...new Set(records.map(row => row.chamber))]);
}

function kansas(document: Document, root: HtmlNode, defaultChamber?: Chamber): Result {
  const rows = nodes(root, node => node.tag === "tr" && /\/legislators\//.test(node.attrs["data-href"] ?? ""));
  const chamber = defaultChamber ?? (/\/house\//.test(document.url) ? "lower" : "upper");
  const records = rows.map(row => {
    const nameCell = first(row, node => hasClass(node, "col-primary"))!;
    const name = clean(nameCell.children.filter((child): child is string => typeof child === "string").join(" "));
    return { name, district: elementText(row, node => node.attrs["data-label"] === "District"), chamber, sourceUrl: document.url, nativeId: new URL(row.attrs["data-href"]!, document.url).href, party: party(elementText(row, node => node.attrs["data-label"] === "Party")), vacant: isVacancy(name) };
  });
  // The source paginates by default; a rendered Next link means this is only a page of the roster.
  const paginated = !!first(root, node => node.tag === "a" && /\bpage=\d+/.test(node.attrs.href ?? "") && /^(Next|Last)$/.test(textOf(node)));
  return result(records, [chamber], !paginated);
}

/** Adapters reflect committed, unmodified official roster documents, never navigation guesses. */
export function parseResearchedLegislature(state: string, document: Document, defaultChamber?: Chamber): Result | null {
  const handled = new Set(["ca", "co", "de", "fl", "ga", "ia", "id", "ks", "ky", "la", "ma", "md", "me", "mn", "mo"]);
  if (!handled.has(state.toLowerCase())) return null;
  if (document.body.trimStart().startsWith("<") && !/<\/html\s*>/i.test(document.body)) throw new Error("Official roster HTML document is truncated");
  const root = parseHtml(document.body);
  let parsed: Result;
  switch (state.toLowerCase()) {
    case "ca": parsed = california(document, root, defaultChamber); break;
    case "co": parsed = colorado(document, root); break;
    case "de": parsed = delaware(document); break;
    case "fl": parsed = florida(document, root, defaultChamber); break;
    case "ga": parsed = georgia(document); break;
    case "ia": parsed = iowa(document, root); break;
    case "id": parsed = idaho(document, root, defaultChamber); break;
    case "ks": parsed = kansas(document, root, defaultChamber); break;
    case "ky": parsed = kentucky(document, root, defaultChamber); break;
    case "la": parsed = louisiana(document, root, defaultChamber); break;
    case "ma": parsed = massachusetts(document, root, defaultChamber); break;
    case "md": parsed = maryland(document, root, defaultChamber); break;
    case "me": parsed = maine(document, root, defaultChamber); break;
    case "mn": parsed = minnesota(document, root); break;
    case "mo": parsed = missouri(document, root, defaultChamber); break;
    default: return null;
  }
  // Partial pages can publish verified rows, but cannot imply that an absent holder left.
  const territorialSeats: Record<string, Partial<Record<Chamber, number>>> = {
    ca: { lower: 80, upper: 40 }, co: { lower: 65, upper: 35 }, de: { lower: 41, upper: 21 },
    fl: { lower: 120, upper: 40 }, ga: { lower: 180, upper: 56 }, ia: { lower: 100, upper: 50 },
    id: { lower: 70, upper: 35 }, ks: { lower: 125, upper: 40 }, ky: { lower: 100, upper: 38 },
    la: { lower: 105, upper: 39 }, ma: { lower: 160, upper: 40 }, md: { lower: 141, upper: 47 },
    me: { lower: 151, upper: 35 }, mn: { lower: 134, upper: 67 }, mo: { lower: 163, upper: 34 },
  };
  return { ...parsed, complete: parsed.complete && parsed.chambers.every(chamber => parsed.records.filter(record => record.chamber === chamber).length === territorialSeats[state.toLowerCase()]?.[chamber]) };
}
