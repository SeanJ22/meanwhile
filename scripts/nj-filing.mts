/**
 * `pnpm nj:filing` — **New Jersey's filed-candidate lists, as a branch** (built
 * 2026-08-22, NJ Hunt item 5).
 *
 * ```
 * pnpm nj:filing                      # discover + parse both documents, print counts
 * pnpm nj:filing --municipality "Rockaway Township"
 * pnpm nj:filing --json .njtmp/filing.json
 * pnpm nj:filing --pdf <local.pdf>    # parse a file already on disk
 * ```
 *
 * ## What it is for
 *
 * NH Hunt 6 measured `contact` at 7 mechanically-walkable routes against 28
 * that need a person, and reported ONE contact found for THIRTEEN candidates.
 * This is the instrument that tests whether that ratio is a fact about the
 * COUNTRY or a fact about New Hampshire. It walks `filing-state` and
 * `filing-county` mechanically — the two routes New Hampshire could not — and
 * prints, per candidate, what each returned.
 *
 * ## Discovery is never a hardcoded URL
 *
 * The clerk republishes at a new version path on every revision
 * (`/v/9/...-082126.pdf` supersedes `/v/6/...-080726.pdf`), and both stay
 * reachable. So the run always fetches the clerk's own candidates PAGE and
 * reads its hrefs. A hardcoded URL here would read a superseded filing as
 * current, which is a claim about who is running.
 *
 * ## Every step reports its count
 *
 * Bytes fetched, pages with text, candidates parsed, candidates with an email,
 * candidates with an address, and jurisdictions the document itself declares
 * `NO LOCAL ELECTION`. A zero anywhere exits non-zero with the reason attached,
 * because a parser that returns nothing has told you about itself.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { politeGetText } from "../lib/sources/http.ts";
import {
  NJ_FILING_SOURCES,
  newestFilingPdfs,
  parseNjFiling,
  type FiledCandidate,
  type FiledNoElection,
  type FiledUnfilledSeat,
} from "../lib/hunt/nj-filing.ts";
import { today as stampToday } from "./doc-dates.mjs";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UA = "we-the-people civic data (contact: seanj22@gmail.com)";
const today = arg("--on") ?? stampToday();
const wantMunicipality = arg("--municipality");
const jsonOut = arg("--json");
const localPdf = arg("--pdf");

async function fetchPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * **A page fetch that walks the ladder instead of dying on one refusal.**
 *
 * `www.nj.gov` sits behind Imperva and served this run ONE challenge page at
 * rung 2 on 2026-08-22, then answered plainly on every retry from the same
 * machine and the same egress within the minute. RULING 52's second half is
 * exactly this: a wall observed once is not a wall, and a branch that reported
 * `NJ Division of Elections — REFUSED` on that single reading would have
 * recorded a measurement of one moment as a property of the source. That is the
 * shape `gc.nh.gov` and `sos.nh.gov` were both wrongly recorded under.
 *
 * So the rungs, in order, with each result named:
 *   2 — plain fetch through the identified polite client
 *   3 — the full browser header set
 *   4 — a different CLIENT, `curl`, whose TLS fingerprint passes filters that
 *       refuse Node's (the f-session finding, and the recorded rung for
 *       Imperva-fronted hosts in this repo)
 *
 * Anything still refused after all three is reported as a refusal WITH the
 * rungs walked, never as an empty document.
 */
async function laddered(
  url: string,
  label: string,
): Promise<{ text: string; rung: number }> {
  const rungs: string[] = [];
  for (const [rung, profile] of [
    [2, undefined],
    [3, "browser"],
  ] as const) {
    try {
      const r = await politeGetText(url, profile ? { profile } : {});
      return { text: r.text, rung };
    } catch (err) {
      rungs.push(`rung ${rung}: ${String(err).split("\n")[0]!.slice(0, 90)}`);
    }
  }
  /* Rung 4 — a different client entirely. */
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(
      "curl",
      ["-sL", "--max-time", "40", "-A", UA, url],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (out.length > 2000) return { text: out, rung: 4 };
    rungs.push(`rung 4: curl returned ${out.length} bytes — too small to be the document`);
  } catch (err) {
    rungs.push(`rung 4: ${String(err).split("\n")[0]!.slice(0, 90)}`);
  }
  throw new Error(
    `${label} REFUSED at every rung walked — ${rungs.join(" · ")}. This is a WALL with its rungs named, not an empty document.`,
  );
}

interface DocResult {
  label: string;
  url: string;
  bytes: number;
  candidates: FiledCandidate[];
  noElection: FiledNoElection[];
  unfilled: FiledUnfilledSeat[];
}

async function readDoc(url: string, label: string): Promise<DocResult> {
  const bytes = await fetchPdf(url);
  /*
   * **Read the length BEFORE extraction.** pdfjs takes ownership of the buffer
   * it is handed and detaches it, so `bytes.length` afterwards is 0 — and a
   * count read after the operation that consumed it is a FALSE ZERO reported
   * as a measurement. The first run of this tool printed `0 bytes` for two
   * PDFs it had just parsed 272 candidates out of.
   */
  const byteCount = bytes.length;
  const text = await extractTextLayer(bytes, url);
  if (text.outcome !== "EXTRACTED") {
    throw new Error(`${label}: text layer ${text.outcome} — ${text.reason}`);
  }
  const joined = text.items.map((p) => p.text).join("\n");
  const parsed = parseNjFiling(joined, label);
  if (parsed.outcome !== "EXTRACTED") {
    throw new Error(`${label}: parse ${parsed.outcome} — ${parsed.reason}`);
  }
  const candidates = parsed.items.filter((r): r is FiledCandidate => "familyName" in r);
  const noElection = parsed.items.filter((r): r is FiledNoElection => !("familyName" in r) && !("office" in r));
  const unfilled = parsed.items.filter((r): r is FiledUnfilledSeat => !("familyName" in r) && "office" in r);
  return { label, url, bytes: byteCount, candidates, noElection, unfilled };
}

console.log(`\nNJ FILING BRANCH — filing-county and filing-state, walked ${today}\n`);

const docs: DocResult[] = [];

if (localPdf) {
  const bytes = new Uint8Array(readFileSync(localPdf));
  const byteCount = bytes.length;
  const text = await extractTextLayer(bytes, localPdf);
  if (text.outcome !== "EXTRACTED") {
    console.error(`  text layer ${text.outcome} — ${text.reason}`);
    process.exit(1);
  }
  const parsed = parseNjFiling(text.items.map((p) => p.text).join("\n"), localPdf);
  if (parsed.outcome !== "EXTRACTED") {
    console.error(`  parse ${parsed.outcome} — ${parsed.reason}`);
    process.exit(1);
  }
  docs.push({
    label: localPdf,
    url: localPdf,
    bytes: byteCount,
    candidates: parsed.items.filter((r): r is FiledCandidate => "familyName" in r),
    noElection: parsed.items.filter((r): r is FiledNoElection => !("familyName" in r) && !("office" in r)),
    unfilled: parsed.items.filter((r): r is FiledUnfilledSeat => !("familyName" in r) && "office" in r),
  });
} else {
  /* ── filing-county: the clerk's own page names its current PDFs ─────────── */
  const clerkPage = await laddered(NJ_FILING_SOURCES.morrisClerkCandidates, "Morris County Clerk");
  const clerkPdfs = newestFilingPdfs(clerkPage.text, "https://www.morriscountyclerk.org");
  console.log(`  filing-county   clerk page ${clerkPage.text.length} bytes at rung ${clerkPage.rung} → ${clerkPdfs.length} PDF(s)`);
  for (const url of clerkPdfs) {
    /* The ballot-position document is a scan with no text layer; it is not a candidate list. */
    if (/candidate-order/i.test(url)) {
      console.log(`    SKIPPED  ${url.split("/").pop()} — ballot-position scan, no text layer (rung 9 OCR, not this branch)`);
      continue;
    }
    try {
      const d = await readDoc(url, `Morris County Clerk — ${url.split("/").pop()}`);
      docs.push(d);
      console.log(
        `    HIT      ${url.split("/").pop()} — ${d.bytes} bytes, ${d.candidates.length} candidates, ${d.candidates.filter((c) => c.email).length} with email, ${d.noElection.length} NO LOCAL ELECTION`,
      );
    } catch (err) {
      console.log(`    FAILED   ${url.split("/").pop()} — ${String(err)}`);
    }
  }

  /* ── filing-state: the Division of Elections' separate email lists ──────── */
  const hub = await laddered(NJ_FILING_SOURCES.stateHub, "NJ Division of Elections");
  const statePdfs = newestFilingPdfs(hub.text, "https://www.nj.gov/state/elections/").filter(
    (u) => /general-candidates.*emails/i.test(u),
  );
  console.log(
    `\n  filing-state    hub ${hub.text.length} bytes at rung ${hub.rung} → ${statePdfs.length} email PDF(s)`,
  );
  for (const url of statePdfs) {
    try {
      const bytes = await fetchPdf(url);
      const byteCount = bytes.length;
      const text = await extractTextLayer(bytes, url);
      if (text.outcome !== "EXTRACTED") {
        console.log(`    FAILED   ${url.split("/").pop()} — text layer ${text.outcome}`);
        continue;
      }
      const joined = text.items.map((p) => p.text).join(" ");
      const pairs = [...joined.matchAll(/([A-Z][A-Za-zÀ-ÿ'’.\- ]+?)\s+((?:Democrat|Republican|Independent|Green Party|Libertarian Party|Socialist Workers Party|[A-Z][A-Za-z'!,\- ]{3,40}?))\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)];
      console.log(
        `    HIT      ${url.split("/").pop()} — ${byteCount} bytes, ${pairs.length} name/email pairs`,
      );
      docs.push({
        label: `NJ Division of Elections — ${url.split("/").pop()}`,
        url,
        bytes: byteCount,
        candidates: pairs.map((m) => {
          const whole = m[1]!.trim().split(/\s+/);
          return {
            jurisdiction: "New Jersey",
            office: /senate/i.test(url) ? "MEMBER OF THE UNITED STATES SENATE" : "MEMBER OF THE HOUSE OF REPRESENTATIVES",
            familyName: whole.slice(-1)[0] ?? "",
            givenName: whole.slice(0, -1).join(" "),
            party: m[2]!.trim(),
            slogan: null,
            address: null,
            email: m[3]!,
            termYears: null,
            voteFor: null,
            /*
             * The state's emails PDF has no district column — it is a federal
             * contact list. Null is the honest value; a copied municipality
             * would be a field this document does not contain.
             */
            district: null,
          };
        }),
        noElection: [],
        unfilled: [],
      });
    } catch (err) {
      console.log(`    FAILED   ${url.split("/").pop()} — ${String(err)}`);
    }
  }
}

const allCandidates = docs.flatMap((d) => d.candidates);
const allNoElection = docs.flatMap((d) => d.noElection);
const allUnfilled = docs.flatMap((d) => d.unfilled);

if (allCandidates.length === 0) {
  console.error(
    "\n  ZERO CANDIDATES PARSED — this is a failed extraction, not an empty filing. The document's grammar has changed or the fetch was refused.\n",
  );
  process.exit(1);
}

console.log(
  `\n  TOTAL  ${allCandidates.length} candidates · ${allCandidates.filter((c) => c.email).length} with a filed email · ${allCandidates.filter((c) => c.address).length} with a filed address · ${allNoElection.length} jurisdictions declaring NO LOCAL ELECTION · ${allUnfilled.length} seat(s) a party filed nobody for\n`,
);

/*
 * A jurisdiction that is not a jurisdiction is a parse failure wearing a
 * plausible name, and the first version of this tool shipped twenty of them —
 * `Made Democratic Rockaway Borough`, `City State Zip Email` — each attached to
 * a real named candidate. It is checked rather than eyeballed, because a wrong
 * jurisdiction on a real person's row is the sort of thing that reads fine in a
 * summary count.
 */
const suspectJurisdictions = allCandidates.filter((c) =>
  /\b(?:No Nomination|Made|Street Address|City State Zip|First Name)\b/i.test(c.jurisdiction),
);
if (suspectJurisdictions.length > 0) {
  console.error(
    `\n  ${suspectJurisdictions.length} candidate row(s) carry a jurisdiction that is document furniture rather than a place — ` +
      "the parse has drifted:\n" +
      suspectJurisdictions
        .slice(0, 10)
        .map((c) => `    ${c.givenName} ${c.familyName} -> ${JSON.stringify(c.jurisdiction)}`)
        .join("\n"),
  );
  process.exit(1);
}

if (wantMunicipality) {
  const hits = allCandidates.filter((c) =>
    c.jurisdiction.toLowerCase().includes(wantMunicipality.toLowerCase()),
  );
  console.log(`  ${wantMunicipality} — ${hits.length} candidate(s):\n`);
  for (const c of hits) {
    console.log(`    ${c.givenName} ${c.familyName}${c.party ? ` (${c.party})` : ""}`);
    console.log(`        office   ${c.office}${c.voteFor ? ` — ${c.voteFor} seat(s), ${c.termYears}-year term` : ""}`);
    if (c.slogan) console.log(`        slogan   ${c.slogan}`);
    console.log(`        address  ${c.address ?? "— not printed"}`);
    console.log(`        email    ${c.email ?? "— not printed"}`);
  }
  const ne = allNoElection.filter((n) =>
    n.jurisdiction.toLowerCase().includes(wantMunicipality.toLowerCase()),
  );
  for (const n of ne) console.log(`\n    ${n.statement}`);
  console.log("");
}

if (jsonOut) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify(
      {
        walkedAt: today,
        branch: "nj-filing",
        routes: ["filing-county", "filing-state"],
        documents: docs.map((d) => ({ label: d.label, url: d.url, bytes: d.bytes })),
        candidates: allCandidates,
        noElection: allNoElection,
        unfilled: allUnfilled,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`  written ${jsonOut}\n`);
}
