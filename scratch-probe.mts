import { readFileSync } from "node:fs";

/** A minimal RFC4180 reader — the corpus quotes fields containing commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync("data/reference/openstates_legislators.csv", "utf8"));
const head = rows[0];
const col = (n: string) => head.indexOf(n);
const iName = col("name"), iEmail = col("email"), iJur = col("jurisdiction"), iCh = col("chamber"), iD = col("district"), iEnd = col("role_end_date");
const nh = rows.slice(1).filter((c) => (c[iJur] ?? "").trim().toUpperCase() === "NH");
console.log("NH legislators in the committed corpus:", nh.length);
console.log("  with an email:", nh.filter((c) => (c[iEmail] ?? "").includes("@")).length);
console.log("  sample:", nh[0] ? `${nh[0][iName]} | ${nh[0][iCh]}-${nh[0][iD]} | ${nh[0][iEmail]}` : "none");

const ballot = JSON.parse(readFileSync("data/ballot/nh-merrimack-2026.json", "utf8"));
const cands: any[] = ballot.candidacies ?? [];
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const byName = new Map<string, string[]>();
for (const c of nh) {
  const k = norm(c[iName] ?? "");
  if (k) byName.set(k, c);
  const p = k.split(" ");
  if (p.length > 2) byName.set(`${p[0]} ${p[p.length - 1]}`, c);
}
let hits = 0;
for (const c of cands) {
  const full = norm(`${c.givenName ?? ""} ${c.familyName ?? ""}`);
  const p = full.split(" ");
  const short = p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : full;
  const m = byName.get(full) ?? byName.get(short);
  if (m) { hits++; console.log(`  MATCH ${(`${c.givenName} ${c.familyName}`).padEnd(32)} ${m[iCh]}-${m[iD]}  email=${m[iEmail] || "(none)"}`); }
}
console.log(`\nNH merrimack candidacies matched to a sitting legislator: ${hits} of ${cands.length}`);
