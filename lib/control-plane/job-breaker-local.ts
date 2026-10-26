import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { protectedJob, type JobBreakerSnapshot } from "./job-transfer-breaker.ts";

export const JOB_BREAKER_PATH_ENV = "WTP_JOB_BREAKER_STATE_PATH";
const key = (job: string) => createHash("sha256").update(job).digest("hex");
export function saveBreakerSnapshot(path: string, snapshot: JobBreakerSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot));
  renameSync(temporary, path);
}

/** Hash the job's source and local import closure, independent of an unrelated release's SHA. */
export function jobSourceIdentity(root: string, entry: string): string | null {
  const seen = new Map<string, Buffer>();
  const open = (file: string) => {
    if (seen.has(file)) return;
    const body = readFileSync(file);
    seen.set(file, body);
    const imports = body.toString().matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g);
    for (const match of imports) {
      const specifier = match[1]!;
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const target = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
      const base = target.replace(/\.(?:js|mjs)$/, "");
      const candidates = extname(target) ? [target, `${base}.ts`, `${base}.mts`] : [target+".ts", target+".mts", target+".tsx", join(target,"index.ts")];
      const found = candidates.find(candidate => existsSync(candidate));
      if (found) open(found);
    }
  };
  try {
    const path = resolve(root, entry);
    if (relative(root,path).startsWith("..")) return null;
    open(path);
    const hash = createHash("sha256");
    for (const [file, body] of [...seen].sort(([a],[b])=>a.localeCompare(b))) hash.update(relative(root,file)).update("\0").update(body).update("\0");
    return hash.digest("hex");
  } catch { return null; }
}

export function registeredJobIdentity(path: string, root: string, job: string): string | null {
  let entry: string;
  try { entry = JSON.parse(readFileSync(`${path}.jobs/${key(job)}.json`,"utf8")).entry; }
  catch {
    const aliases: Record<string,string> = { "routine-civic-data":"routine-civic-data-runner", "publish-now":"routine-civic-data-runner",
      "research-cycle":"freshness-shadow", "platform-census":"platform-census-runner", "place-pages":"rebuild-place-pages" };
    entry = `scripts/${aliases[job] ?? job}.mts`;
  }
  return jobSourceIdentity(root,entry);
}

interface Launch { id: string; args: readonly string[]; launchEveryMs?: number }
/** Local files are shared by both supervisors and survive release checkout switches. No launch reads Postgres. */
export function admitJobLaunch(command: Launch, root: string, env: NodeJS.ProcessEnv = process.env, now = Date.now(), reserve = true): boolean {
  const path = env[JOB_BREAKER_PATH_ENV];
  if (!path || protectedJob(command.id)) return true;
  const entry = command.args.find(arg => /\.(?:mts|mjs|tsx?|js)$/.test(arg));
  if (entry) {
    mkdirSync(`${path}.jobs`, { recursive: true });
    const source = isAbsolute(entry) ? relative(root,entry) : entry;
    writeFileSync(`${path}.jobs/${key(command.id)}.json`,JSON.stringify({entry:source}));
  }
  let snapshot: JobBreakerSnapshot;
  try { snapshot = JSON.parse(readFileSync(path,"utf8")); }
  catch { return true; } // Check errors are reported by the parent; no new blanket pause is invented.
  const state = snapshot.states[command.id];
  if (state?.mode === "PAUSED_CODE" || state?.mode === "PAUSED_HOUR") return false;
  if (!state) return true;
  const directory = `${path}.launches`;
  mkdirSync(directory,{recursive:true});
  const file = join(directory,key(command.id)), lock = file+".lock";
  try { mkdirSync(lock); }
  catch { return false; }
  try {
    let last = 0;
    try { last = Number(readFileSync(file,"utf8")); } catch { /* First resumed launch. */ }
    const everyMs = command.launchEveryMs ?? 60_000;
    if (!Number.isFinite(everyMs) || everyMs <= 0) throw new Error("Invalid job launch interval");
    if (now < last + 2*everyMs) return false;
    if (reserve) writeFileSync(file,String(now));
    return true;
  } finally { rmSync(lock,{recursive:true}); }
}
