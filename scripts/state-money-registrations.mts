/** Build sourced filing-office leads from the held national directory, one state at a time. */
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { dataPath, notePath, parseCsv } from "../lib/reference/index.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import type { StateCampaignFinanceRegistration } from "../lib/funding/data-plane.ts";

async function* rows(path: string) {
  let header: string[] | null = null, record = "", row = 0;
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    record += `${line}\n`;
    if ((record.match(/"/g)?.length ?? 0) % 2) continue;
    const values = parseCsv(record)[0]; record = "";
    if (!header) { header = values; continue; }
    yield { row: ++row, fields: Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""])) };
  }
  if (record.trim()) throw new Error(`Incomplete quoted CSV record: ${path}`);
}

/** A federal-only reports office never becomes a state filing-office lead. */
export function holdsStateCampaignReports(text: string): boolean {
  const nonFederal = text.replace(/\bFederal\s+Campaign\s+(?:Finance|Financing|Disclosure)(?:\s+Disclosure)?\s+(?:Reports|Records)\b/gi, "");
  return /\bCampaign\s+(?:Finance|Financing|Disclosure)(?:\s+Disclosure)?\s+(?:Reports|Records)\b/i.test(nonFederal);
}

export async function generateStateMoneyRegistrations(root: string, selected: readonly string[], cycle: number): Promise<void> {
  if (!Number.isSafeInteger(cycle) || cycle < 2000) throw new Error("A source registration needs an explicit election cycle.");
  const states = [...new Set(selected.map(state => state.toUpperCase()))];
  const referenceInput = (path: string) => join(root, "data", "reference", basename(path));
  for (const state of states) if (!US_JURISDICTIONS.some(j => j.usps === state)) throw new Error(`Unknown jurisdiction: ${state}`);
  // Names normalize this directory's jurisdiction headings into the existing
  // Census FIPS taxonomy; no government or person is joined by a name.
  const names = new Map<string, string>();
  for await (const { fields } of rows(referenceInput(dataPath("acs5_2024_b01003_state")))) {
    const identity = US_JURISDICTIONS.find(j => j.fips === fields.state_fips);
    if (identity && states.includes(identity.usps)) names.set(identity.usps, fields.name.toUpperCase());
  }
  const dataset = "fec_combined_federal_state_disclosure_directory";
  const path = referenceInput(dataPath(dataset)), note = readFileSync(referenceInput(notePath(dataset)), "utf8");
  const url = /Source document[^\n]*?(https:\/\/\S+)/.exec(note)?.[1];
  const archiveSha256 = /SHA-256[^\n]*?([a-f0-9]{64})/i.exec(note)?.[1];
  if (!url || !archiveSha256) throw new Error("Held FEC source note lacks its document URL or byte identity.");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  for (const state of states) {
    const name = names.get(state), agencies: StateCampaignFinanceRegistration["agencies"][number][] = [];
    if (!name) { console.log(`${state}: directory heading not resolved; existing registration retained`); continue; }
    for await (const { fields, row } of rows(path)) {
      if (fields.jurisdiction !== name || /FEDERAL DISCLOSURE|FEDERAL ELECTION COMMISSION/.test(fields.office) ||
          !holdsStateCampaignReports(fields.records_held) || !/^https?:\/\//.test(fields.url)) continue;
      agencies.push({ name: fields.office, url: fields.url, recordsHeld: fields.records_held, page: Number(fields.directory_page), row });
    }
    if (!agencies.length) { console.log(`${state}: no qualified state campaign-report lead; existing registration retained`); continue; }
    const target = join(root, "data", "states", state.toLowerCase(), "funding", "source-registration.json");
    const prior = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) as Partial<StateCampaignFinanceRegistration> : null;
    const preserve = prior?.jurisdiction === state;
    const id = `${state.toLowerCase()}-campaign-finance`;
    const value: StateCampaignFinanceRegistration = {
      jurisdiction: state, cycle,
      contractId: preserve && prior.contractId ? prior.contractId : id,
      sourceId: preserve && prior.sourceId ? prior.sourceId : id,
      parserVersion: preserve && prior.parserVersion ? prior.parserVersion : "state-money/1",
      scope: `US-${state}:campaign-finance:${cycle}`, agencies,
      source: { url, dataset, sha256, archiveSha256 },
    };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(`${target}.tmp`, target);
    console.log(`${state}: ${agencies.length} sourced filing-office lead(s); ${value.sourceId}`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/state-money-registrations.mts")) {
  const selected = process.argv.find(arg => arg.startsWith("--states="))?.slice(9);
  const cycle = Number(process.argv.find(arg => arg.startsWith("--cycle="))?.slice(8));
  if (!selected) throw new Error("Pass --states=<postal codes>|all and --cycle=<election year>.");
  await generateStateMoneyRegistrations(process.cwd(), selected === "all" ? US_JURISDICTIONS.map(j => j.usps) : selected.split(","), cycle);
}
