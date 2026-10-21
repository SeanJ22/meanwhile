/** Actual reader routes against an explicitly supplied normal production copy.
 * Run from either checkout with --env-path=/absolute/copy.env and --out=/absolute/results.json.
 * Every state gets a fresh process; no fixture responses or replacement SQL schemas are installed.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const envPath = option("env-path");
if (!envPath) throw new Error("An explicit production-copy environment file is required");
config({ path: envPath, override: true, quiet: true });
const connection = process.env.DATABASE_URL;
if (!connection || process.env.WTP_DB_ROLE !== "local" || process.env.WTP_RUNTIME_MODE !== "staging") throw new Error("A local/staging copy connection is required");
const endpoint = new URL(connection).hostname.replace("-pooler.", ".");
if (endpoint.startsWith("ep-dry-river-") || !endpoint.endsWith(".neon.tech")) throw new Error("The copy endpoint must differ from production");
process.env.WTP_VITAL_SIGNS_REPORT = "1";

interface Holder { id: string; name: string; officeTitle: string; [key: string]: unknown }
interface Measurement { state: string; division: string; importMs: number; coldMs: number; repeatMs: number; stateMs: number; status: number; repeatStatus: number; stateStatus: number; holders: Holder[]; statewide: Holder[]; country: Holder[]; displayed?: Holder[]; representation: unknown; reader: unknown; sourcePeople: unknown; failures: string[] }
const federal = (holder: Holder) => holder.id.startsWith("congress:") || holder.level === "FEDERAL" || /^(?:U\.?S\.?\s+|United States\s+)/i.test(holder.officeTitle);
const childState = option("child");
if (childState) {
  const started = performance.now();
  const [{ GET: representation }, { GET: reader }, { readStatePackage }] = await Promise.all([
    import(pathToFileURL(resolve("app/api/representation/[...division]/route.ts")).href),
    import(pathToFileURL(resolve("app/api/reader/state/route.ts")).href),
    import(pathToFileURL(resolve("lib/reader/state.ts")).href),
  ]);
  const importMs = performance.now() - started;
  const division = `ocd-division/country:us/${childState === "DC" ? "district" : "state"}:${childState.toLowerCase()}`;
  const request = () => new Request(`https://copy.invalid/api/representation/${division}`, { headers: { "x-wtp-synthetic-run": "of-01-copy" } });
  const context = () => ({ params: Promise.resolve({ division: division.split("/") }) });
  const coldStart = performance.now(), response = await representation(request(), context());
  const body = await response.json();
  const coldMs = performance.now() - coldStart;
  const repeatStart = performance.now(), repeatResponse = await representation(request(), context());
  const repeat = await repeatResponse.json(), repeatMs = performance.now() - repeatStart;
  const stateStart = performance.now(), stateResponse = await reader(new Request(`https://copy.invalid/api/reader/state?state=${childState}`));
  const stateBody = await stateResponse.json(), stateMs = performance.now() - stateStart;
  let sourcePeople: unknown = null;
  try {
    const held = await readStatePackage(childState);
    const statewidePeople = (roster: {officeholders: Holder[]; divisions: {officeholderId:string;ocdId:string}[]}|null) => {
      if (!roster) return null;
      const ids = new Set(roster.divisions.filter(link=>link.ocdId===division).map(link=>link.officeholderId));
      return roster.officeholders.filter(holder=>ids.has(holder.id)||holder.level==="STATE"&&!holder.chamber);
    };
    sourcePeople = { people: statewidePeople(held.people), legislativePeople: statewidePeople(held.legislativePeople), registryExecutives: held.registry.statewideExecutives,
      peopleKind: held.peopleRead.kind, registryKind: held.registryRead.kind, registryMetadata: held.registryRead.metadata };
  } catch (error) { sourcePeople = { error: error instanceof Error ? error.message : String(error) }; }
  const holders = (body.holders ?? []) as Holder[], coverage = stateBody.coverage;
  const failures: string[] = [];
  if (response.status !== 200) failures.push(`representation:${response.status}`);
  if (repeatResponse.status !== 200) failures.push(`repeat:${repeatResponse.status}`);
  if (stateResponse.status !== 200) failures.push(`reader:${stateResponse.status}`);
  if (JSON.stringify(body) !== JSON.stringify(repeat)) failures.push("repeat-answer-changed");
  const result: Measurement = { state: childState, division, importMs, coldMs, repeatMs, stateMs, status: response.status,
    repeatStatus: repeatResponse.status, stateStatus: stateResponse.status, holders, statewide: holders.filter(holder => !federal(holder)),
    country: (coverage?.seats ?? []).filter((seat: { ocdId: string }) => seat.ocdId === "ocd-division/country:us").flatMap((seat: { representatives: Holder[] }) => seat.representatives),
    representation: body, reader: stateBody, sourcePeople, failures };
  const displayed = [...holders, ...(coverage?.seats ?? []).flatMap((seat:{representatives:Holder[]})=>seat.representatives),
    ...(coverage?.senators ?? []), ...(coverage?.statewideExecutives ?? []), ...(coverage?.bodies ?? []).flatMap((body:{readerRoster?:{members?:Holder[]}})=>body.readerRoster?.members??[])];
  const fields = ["id","personId","name","officeTitle","email","phone","websiteUrl","contactFormUrl","photoUrl","sourceUrl","partyLabel","termStart","termEnd","birthDate","campaignUrl","social","provenance"];
  result.displayed = [...new Map(displayed.map((holder:Holder)=>[`${holder.id}:${holder.officeTitle}`,Object.fromEntries(fields.filter(key=>holder[key]!==undefined).map(key=>[key,holder[key]])) as Holder])).values()];
  const childOutput = option("child-out");
  if (!childOutput) throw new Error("A child output path is required");
  await writeFile(childOutput, JSON.stringify(result) + "\n");
  console.log(`OF01_RESULT ${childOutput}`);
  process.exit(failures.length ? 1 : 0);
}

const output = resolve(option("out") ?? ".scratch/of-01/results.json");
await mkdir(dirname(output), { recursive: true });
const selected = option("states")?.split(",") ?? ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const results: Measurement[] = [], errors: unknown[] = [];
let saving = Promise.resolve();
const save = () => saving = saving.then(() => writeFile(output, JSON.stringify({ at: new Date().toISOString(), phase: option("phase"), endpoint,
  method: "Fresh source-module process per state; actual representation and state routes; full JSON body; first/repeat; real copied production schema and data", results, errors }, null, 2) + "\n"));
const script = resolve(import.meta.filename), loader = resolve("scripts/register-test-loader.mjs");
async function run(state: string) {
  const childOutput = resolve(dirname(output), `${option("phase") ?? "result"}-${state}.json`);
  const child = spawn(process.execPath, ["--experimental-strip-types", "--import", loader, script, `--child=${state}`, `--env-path=${envPath}`, `--child-out=${childOutput}`], {
    cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const code = await new Promise<number | null>((ready, fail) => { child.on("error", fail); child.on("close", ready); });
  const line = stdout.split("\n").find(value => value.startsWith("OF01_RESULT "));
  if (line) {
    const value = JSON.parse(await readFile(childOutput, "utf8")) as Measurement;
    // Full response bytes stay in their state artifact; the controller carries only the comparison fields.
    results.push({...value,representation:null,reader:null});
    console.log(JSON.stringify({ state, statewide: value.statewide.length, country: value.country.map(holder => holder.officeTitle), coldMs: Math.round(value.coldMs), repeatMs: Math.round(value.repeatMs), stateMs: Math.round(value.stateMs), failures: value.failures }));
  } else { errors.push({ state, code, stderr: stderr.split(connection!).join("[copy connection]").slice(-6000), stdout: stdout.slice(-1000) }); console.error(JSON.stringify({state,code,error:"No route result"})); }
  await save();
}
let next = 0;
await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => { while (next < selected.length) await run(selected[next++]!); }));
results.sort((a,b)=>a.state.localeCompare(b.state));
await save();
const baselinePath = option("baseline");
if (baselinePath) {
  const baseline = JSON.parse(await readFile(baselinePath,"utf8")) as { results: Measurement[] };
  const missing: string[] = [];
  for (const before of baseline.results.filter(value => selected.includes(value.state))) {
    const after = results.find(value => value.state === before.state);
    if (!after) { missing.push(`${before.state}:state-result`); continue; }
    for (const holder of before.displayed ?? before.holders) {
      const current = (after.displayed ?? after.holders).find(value => value.id === holder.id && value.officeTitle === holder.officeTitle);
      if (!current) { missing.push(`${before.state}:official:${holder.id}`); continue; }
      for (const key of ["name","officeTitle","email","phone","websiteUrl","contactFormUrl","photoUrl","sourceUrl","partyLabel","termStart","termEnd","birthDate","campaignUrl","social"]) {
        const value = holder[key];
        if (value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length)) {
          if (JSON.stringify(current[key]) !== JSON.stringify(value)) missing.push(`${before.state}:field:${holder.id}:${key}`);
        }
      }
    }
  }
  await writeFile(output.replace(/\.json$/, "-comparison.json"), JSON.stringify({baseline:baselinePath,missing,
    counts:results.map(after=>({state:after.state,before:baseline.results.find(before=>before.state===after.state)?.statewide.length??null,after:after.statewide.length,coldMs:after.coldMs,repeatMs:after.repeatMs,stateMs:after.stateMs}))},null,2)+"\n");
  assert.deepEqual(missing,[],"No currently shown official or populated contact/source field may disappear or change on unchanged copy data");
}
assert.equal(results.length,selected.length);
assert.deepEqual(errors,[]);
assert.deepEqual(results.flatMap(value=>value.failures),[]);
