/**
 * **THE SLOGAN FIELD AT 07866, RE-DERIVED FROM THE SOURCE RATHER THAN COUNTED.**
 * (Overnight depth hunt, 2026-08-23, item 3. Serves the slogan field, which was
 * recorded as 70 of 272 with 202 OWED. It is not owed; see the finding below.)
 *
 * ## The question this exists to answer, and why counting could not answer it
 *
 * The ballot file holds a slogan for **70 of 272** candidacies. Broken down by
 * level that is **62 of 128** school-board candidacies and **3 of 131**
 * municipal ones — and an extraction that succeeds forty times more often on
 * one class of row than another is the shape RULING 100 was adopted over. A
 * total that reconciles is not a total that is correct.
 *
 * There are exactly two explanations and they demand opposite responses:
 *
 * 1. **The parser drops slogans on municipal rows.** Then 128 fields are owed
 *    and a defect is shipping.
 * 2. **Municipal candidates file no slogan.** Then those fields are not owed at
 *    all — they are `NOT_APPLICABLE`, and hunting them would be hunting for
 *    something the record says does not exist.
 *
 * Only the source document can separate them, so this reads the source.
 *
 * ## WHAT IT FOUND, 2026-08-23 — the second explanation, on all 272 rows
 *
 * **272 of 272 candidacies matched a source record, and the independent reading
 * AGREES with the shipped parser on every one of them**: 70 carry a slogan and
 * **202 have an EMPTY Slogan cell in the county's own column**.
 *
 * So those 202 fields were never owed. New Jersey puts the party designation in
 * the Party column, and a major-party candidate has nothing to put in Slogan;
 * the field belongs to independents, who must have a designation and have no
 * party line, and to non-partisan school-board candidates, who have no Party
 * column at all. That is why the rate looked broken by level — 62 of 128 school
 * against 3 of 131 municipal. It was not a parser failing on municipal rows. It
 * is what a New Jersey ballot looks like.
 *
 * Those 202 are `NOT_APPLICABLE` under RULING 23, carrying this reason and this
 * date. They are **not** `VERIFIED_ABSENT` — nobody failed to find anything.
 * The county published an empty cell, which is a fact about the filing.
 *
 * ## Four wrong readers before this one, and they are in the comments below
 *
 * Every intermediate version of this script produced a total that reconciled to
 * 272 and was wrong — reporting 62 people as having filed no slogan, or reading
 * `P.O. Box` as Cory Booker's ballot slogan, or a ZIP code as a slogan. None of
 * them errored. That is RULING 100's whole point, committed by the instrument
 * written to check for it, and the readings are kept in place rather than
 * tidied away.
 *
 * ## Why the slogan cell can be read EXACTLY, which is what makes this evidence
 *
 * The clerk publishes a table whose header names its own columns:
 *
 *     ... First Name and Middle Initial | Last Name and Suffix | Party |
 *         Slogan | Street Address | City | State | Zip | Email
 *
 * The text layer flattens that to a run, but two of the columns are
 * self-delimiting: **Party** is drawn from a closed list, and **Street Address**
 * begins with a house number or a post-office box. Everything between them IS
 * the slogan cell, and an empty span IS an empty cell. That is not an inference
 * about the candidate — it is reading the column the county published.
 *
 * This is deliberately a SECOND implementation and not a call into
 * `lib/hunt/nj-filing.ts`. Auditing a parser with itself proves only that it is
 * deterministic. RULING 103's duplicate-implementation sweep is about logic
 * that should have been shared; an independent re-derivation written to
 * disagree is the opposite of that, and it is recorded in the baseline with
 * that reason.
 *
 * ## RULING 100, applied to this reader too
 *
 * Neither PDF states how many candidates it contains, so the extracted count is
 * `NOT_ASSERTABLE` against a stated one and says so rather than passing
 * quietly. What CAN be asserted is the cross-check that matters more: every one
 * of the 272 candidacies in the ballot file must be found in the source by its
 * filed email, and a shortfall FAILS.
 *
 *   pnpm nj:slogan-audit
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractTextLayer, type PdfPage } from "../lib/extract/text-layer.ts";
import { notAssertable, assertionLine } from "../lib/extract/count-assertion.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BALLOT = join(ROOT, "data/states/nj/ballot/nj-morris-2026.json");
const CONTACTS = join(ROOT, "data/states/nj/ballot/nj-morris-2026-contacts.json");
const OUT = join(ROOT, "data/hunt/nj-slogan-audit.json");

/** Today, passed in rather than read from a clock. `pnpm stamp` is the source. */
const STAMP = process.env.WTP_STAMP ?? "";

/**
 * The party tokens this county's ballot uses.
 *
 * Closed on purpose. A party list that grew a wildcard would swallow the first
 * word of a slogan, which is the exact failure this script exists to detect.
 */
const PARTIES = ["Republican", "Democratic", "Democrat", "Independent", "Nonpartisan"] as const;

/**
 * `Libertarian` and `Green` are deliberately NOT in that list, and the reason is
 * a finding rather than a preference.
 *
 * New Jersey puts only the recognised parties in the Party column. A candidate
 * of any other affiliation is filed **Independent**, and the affiliation they
 * want on the ballot goes in the SLOGAN. `Lana LEGUÍA Independent Libertarian
 * Party P.O. Box 22` is one row of it: Party is *Independent* and the slogan is
 * *Libertarian Party*. A reader that treated `Libertarian` as a party token
 * consumed the first word of the slogan and reported the cell as `Party` — which
 * is what the first version of this script did, and it is exactly the failure
 * the closed list above is meant to prevent, committed by the list itself.
 */
const NOT_PARTY_TOKENS = ["Libertarian", "Green", "Socialist"] as const;

/**
 * Where the Street Address column begins.
 *
 * Every address in both documents starts with a house number, a post-office
 * box, or a unit-first form. Anchored so a slogan ending in a digit cannot be
 * mistaken for the start of an address.
 */
const ADDRESS_START =
  /\b(\d+[A-Za-z]?\s+[A-Za-z]|P\.?\s?O\.?\s+Box\b|Post Office Box\b|One\s+[A-Z]|Two\s+[A-Z])/;

for (const token of NOT_PARTY_TOKENS) {
  if ((PARTIES as readonly string[]).includes(token)) {
    throw new Error(
      `${token} is in PARTIES. New Jersey files these candidates as Independent and puts the ` +
        "affiliation in the SLOGAN, so treating it as a party token eats the slogan's first word.",
    );
  }
}

interface SourceDoc {
  url: string;
  label: string;
  text: string;
  pages: number;
}

async function readDoc(url: string, label: string): Promise<SourceDoc> {
  const res = await fetch(url, { headers: { "user-agent": sourceUserAgent() } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const layer = await extractTextLayer(bytes, url);
  // RULING 100 / the zero-row rule: a reader that came back with nothing has
  // told you about itself, not about the document. `ExtractResult` makes that
  // a state a caller has to handle rather than a falsy value it can drop.
  if (layer.outcome !== "EXTRACTED") {
    throw new Error(
      `${label} (${url}): text layer ${layer.outcome} — ${layer.reason ?? "no reason given"}. ` +
        "That is a FAILED extraction, never an empty document.",
    );
  }
  const pages = layer.items as PdfPage[];
  const text = pages
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ");
  return { url, label, text, pages: pages.length };
}

/**
 * Where the Street Address column begins, searching only AFTER a known offset.
 *
 * The offset is what makes this correct, and getting there took three wrong
 * readers, each of which is worth stating because each looked reasonable:
 *
 * - **First match in the record.** Non-partisan rows carry `<term> <voteFor>`
 *   as loose digits before the name — `... EDUCATION 3 3 Town Brianna ...` —
 *   and `3 Town` satisfies the house-number pattern exactly, so the record was
 *   cut off before the candidate and 62 people were read as having filed no
 *   slogan when the county had printed one for each.
 * - **Last match in the record.** Lands past the address on the `NJ` of the
 *   trailing `<City> NJ <ZIP>`, and reports the ZIP code as the slogan.
 * - **Last match still followed by `<ST> <ZIP>`.** Splits a post-office box:
 *   in `P.O. Box 999 Edison NJ 08818` both `P.O. Box` and `999 Edison`
 *   qualify, so `P.O. Box` was read as Cory Booker's ballot slogan.
 *
 * Anchoring on the name first removes all three, because the address is then
 * simply the FIRST candidate start after the columns that precede it.
 */
function addressStartAfter(record: string, from: number): number {
  const re = new RegExp(ADDRESS_START.source, "g");
  re.lastIndex = Math.max(0, from);
  const m = re.exec(record);
  return m ? m.index : -1;
}

/** The last word-bounded occurrence of `needle` in `hay`, case-insensitively. */
function lastIndexOfWord(hay: string, needle: string, leadingBoundary = true): number {
  if (needle.length === 0) return -1;
  // Spaces inside a filed surname are OPTIONAL in the text layer: the county
  // files `Mc CABE` and the PDF draws `McCABE`. An exact match reported that
  // candidate's real, printed slogan as unfound.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const lead = leadingBoundary ? "(?<![A-Za-zÀ-ÿ])" : "";
  const re = new RegExp(`${lead}${escaped}(?![A-Za-zÀ-ÿ])`, "gi");
  let at = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) at = m.index + m[0].length;
  return at;
}

interface Derived {
  email: string;
  /** The literal span between the Party column and the Street Address column. */
  sloganCell: string | null;
  /** Whether the candidate's own surname was found to anchor the read. */
  anchored: boolean;
  /** The window the cell was read out of, kept so a human can check the call. */
  window: string;
}

/**
 * Read the Slogan cell for every record in a document.
 *
 * The record boundary is the EMAIL, which is what `lib/hunt/nj-filing.ts`
 * already established is reliable here: an address carries capitals and a
 * slogan carries title case, but only one token per row is an email address.
 *
 * **The candidate's own surname is the anchor**, taken from the county's `Last
 * Name and Suffix` column as it was already parsed into the contact ledger.
 * That is not circular — the surname and the slogan are DIFFERENT columns, and
 * using a known-good value from one to locate the boundary of another is what
 * lets this read the slogan cell exactly rather than guessing where it starts.
 * Every reader here that tried to find the boundary from shape alone got it
 * wrong in a different way; see `addressStartAfter`.
 */
function deriveSlogans(doc: SourceDoc, surnameByEmail: Map<string, string>): Derived[] {
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const hits = [...doc.text.matchAll(emailRe)];
  const out: Derived[] = [];

  let cursor = 0;
  for (const hit of hits) {
    const start = cursor;
    const end = hit.index ?? 0;
    const record = doc.text.slice(start, end);
    cursor = end + hit[0].length;

    const email = hit[0].toLowerCase();
    const surname = surnameByEmail.get(email) ?? "";

    // The surname first, then a bare-surname fallback for a filed name that
    // carries a suffix (`DAWKINS, JR.`) which the text layer may space
    // differently from the parsed field.
    let nameEnd = lastIndexOfWord(record, surname);
    if (nameEnd < 0 && surname.includes(",")) {
      nameEnd = lastIndexOfWord(record, surname.split(",")[0].trim());
    }
    if (nameEnd < 0) {
      // A surname whose PREFIX landed in the given-name column: the county files
      // `William Mc` + `CABE` and the PDF draws `McCABE`, so the letter before
      // the surname is a letter and the leading word boundary cannot hold.
      nameEnd = lastIndexOfWord(record, surname, false);
    }
    if (nameEnd < 0) {
      // No anchor. NOT_ASSERTABLE for this row rather than a silent absence —
      // a reader that cannot find the name has told you about itself.
      out.push({ email: hit[0], sloganCell: null, anchored: false, window: record.slice(-140) });
      continue;
    }

    // The Party column sits between the name and the slogan when it is filled.
    // School races here are non-partisan and leave it empty, in which case the
    // slogan begins at the name.
    let from = nameEnd;
    for (const p of PARTIES) {
      const re = new RegExp(`(?<![A-Za-z])${p}(?![A-Za-z])`, "g");
      re.lastIndex = nameEnd;
      const m = re.exec(record);
      if (m) from = Math.max(from, m.index + m[0].length);
    }

    const addrAt = addressStartAfter(record, from);
    const span = (addrAt >= 0 ? record.slice(from, addrAt) : record.slice(from)).trim();
    out.push({
      email: hit[0],
      sloganCell: span.length > 0 ? span.replace(/\s+/g, " ") : null,
      anchored: true,
      window: record.slice(Math.max(0, nameEnd - 45), nameEnd + 130).trim(),
    });
  }
  return out;
}

async function main(): Promise<void> {
  if (STAMP === "") {
    throw new Error(
      "WTP_STAMP is unset. Every date entering a document comes from `pnpm stamp`; " +
        "a plausible date is a fabrication (CLAUDE.md, the date rule).",
    );
  }

  const ballot = JSON.parse(readFileSync(BALLOT, "utf8")) as {
    candidacies: { id: string; givenName: string; familyName: string; slogan: string | null }[];
  };
  const contacts = JSON.parse(readFileSync(CONTACTS, "utf8")) as {
    contacts: { candidacyId: string; email: string; sourceUrl: string }[];
  };

  const sourceUrls = [...new Set(contacts.contacts.map((c) => c.sourceUrl))];
  console.log(`source documents named by the contact ledger: ${sourceUrls.length}`);
  for (const u of sourceUrls) console.log(`  ${u}`);

  // The surname anchor, taken from the county Last Name column as already parsed.
  const surnameByEmail = new Map<string, string>();
  for (const c of contacts.contacts) {
    const cand = ballot.candidacies.find((x) => x.id === c.candidacyId);
    if (cand) surnameByEmail.set(c.email.toLowerCase(), cand.familyName);
  }

  const docs: SourceDoc[] = [];
  for (const [i, u] of sourceUrls.entries()) {
    const d = await readDoc(u, `doc${i + 1}`);
    console.log(`  read ${d.label}: ${d.pages} page(s), ${d.text.length} chars of text layer`);
    docs.push(d);
  }

  const derived = new Map<string, Derived>();
  for (const d of docs) {
    for (const row of deriveSlogans(d, surnameByEmail)) {
      // Email is the join key and it is lower-cased on both sides: the clerk
      // types `Marie.devenezia@gmail.com` in one column and the address is
      // case-carrying, so a case-sensitive join would drop real rows silently.
      derived.set(row.email.toLowerCase(), row);
    }
  }
  console.log(`\nrecords read out of the source documents: ${derived.size}`);

  const stated = notAssertable(
    derived.size,
    "neither clerk PDF states how many candidates it contains",
  );
  console.log(`  ${assertionLine(stated)}`);

  // The cross-check that CAN be asserted: every candidacy must be found.
  const byId = new Map(ballot.candidacies.map((c) => [c.id, c]));
  let matched = 0;
  const unmatched: string[] = [];
  const rows: {
    candidacyId: string;
    name: string;
    email: string;
    ballotSlogan: string | null;
    sourceSlogan: string | null;
    verdict: "AGREE_PRESENT" | "AGREE_ABSENT" | "PARSER_DROPPED" | "PARSER_INVENTED" | "DIFFERENT";
    window: string;
  }[] = [];

  for (const contact of contacts.contacts) {
    const cand = byId.get(contact.candidacyId);
    if (!cand) continue;
    const d = derived.get(contact.email.toLowerCase());
    if (!d) {
      unmatched.push(`${contact.candidacyId} <${contact.email}>`);
      continue;
    }
    matched += 1;
    const b = cand.slogan?.trim() || null;
    const s = d.sloganCell?.trim() || null;
    const norm = (v: string | null): string | null => v?.toLowerCase().replace(/\s+/g, " ") ?? null;
    const verdict =
      b && s && norm(b) === norm(s)
        ? "AGREE_PRESENT"
        : !b && !s
          ? "AGREE_ABSENT"
          : !b && s
            ? "PARSER_DROPPED"
            : b && !s
              ? "PARSER_INVENTED"
              : "DIFFERENT";
    rows.push({
      candidacyId: cand.id,
      name: `${cand.givenName} ${cand.familyName}`,
      email: contact.email,
      ballotSlogan: b,
      sourceSlogan: s,
      verdict,
      window: d.window,
    });
  }

  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);

  console.log(`\ncandidacies matched to a source record: ${matched} of ${contacts.contacts.length}`);
  if (unmatched.length > 0) {
    console.log(`  UNMATCHED ${unmatched.length}:`);
    for (const u of unmatched.slice(0, 20)) console.log(`    ${u}`);
  }

  console.log("\nverdicts:");
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${String(v).padStart(4)} of ${rows.length}`);
  }

  const dropped = rows.filter((r) => r.verdict === "PARSER_DROPPED");
  const invented = rows.filter((r) => r.verdict === "PARSER_INVENTED");
  const different = rows.filter((r) => r.verdict === "DIFFERENT");

  for (const [label, set] of [
    ["PARSER_DROPPED — the county filed a slogan and the ballot file holds none", dropped],
    ["PARSER_INVENTED — the ballot file holds a slogan the source column does not", invented],
    ["DIFFERENT — both hold one and they disagree", different],
  ] as const) {
    if (set.length === 0) continue;
    console.log(`\n${label} (${set.length}):`);
    for (const r of set.slice(0, 40)) {
      console.log(`  ${r.name}`);
      console.log(`    ballot: ${r.ballotSlogan ?? "(none)"}`);
      console.log(`    source: ${r.sourceSlogan ?? "(none)"}`);
      console.log(`    window: ${r.window.slice(0, 110)}`);
    }
    if (set.length > 40) console.log(`  … and ${set.length - 40} more, all in ${OUT}`);
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        note:
          "The slogan field at 07866, re-derived from the clerk's own Slogan column rather than " +
          "counted. Written by scripts/audit-nj-slogan-field.mts. AGREE_ABSENT means the county " +
          "published an EMPTY slogan cell for that candidate — the field is not owed, it is filed " +
          "empty, and the party label is that candidate's ballot designation.",
        walkedAt: STAMP,
        route: "filing-county",
        tier: "A",
        sourceUrls,
        countAssertion: stated,
        matched,
        ofTotal: contacts.contacts.length,
        unmatched,
        tally: Object.fromEntries(tally),
        rows,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\nwrote ${OUT}`);

  if (matched !== contacts.contacts.length) {
    console.error(
      `\nFAIL — ${contacts.contacts.length - matched} candidacy(ies) were not found in the source. ` +
        "A partial that reconciles is still a wrong answer (RULING 100).",
    );
    process.exit(1);
  }
}

await main();
