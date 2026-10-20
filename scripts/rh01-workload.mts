/** Measurement ownership follows real runner launches; an intent alone never covers a job. */
export interface WorkloadJob {
  readonly id: string; readonly script: string; readonly command: readonly string[]; readonly source: string;
  readonly authority?: { readonly capability: string; readonly contract: string | null };
}
export interface WorkloadOffer {
  readonly id: string; readonly ownerId: string | null; readonly aliasOf: string | null;
}
const pilotChildren = new Set(["routine-civic-data-runner", "publish-now-runner", "publish-owner-snapshot", "intake-tripwire", "platform-census-runner", "hunter-lane", "freshness-shadow"]);
export function commandIdentity(command: readonly string[]): string {
  const options = new Set(["--import", "--require", "-r", "--loader", "--experimental-loader", "--env-file"]);
  const start = command.findIndex((word, index) => !options.has(command[index - 1]) && /(?:^|[/\\])scripts[/\\].+[.](?:mts|mjs|ts|js)$/.test(word));
  if (start === -1) return JSON.stringify(command);
  const script = command[start].replaceAll("\\", "/").replace(/^.*?\/?scripts\//, "scripts/");
  return JSON.stringify([script, ...command.slice(start + 1)]);
}
export function workloadOffers(jobs: readonly WorkloadJob[]): readonly WorkloadOffer[] {
  const ids = new Set(jobs.map(job => job.id)), first = new Map<string, string>();
  return jobs.map(job => {
    const key = `${commandIdentity(job.command)}/${JSON.stringify(job.authority ?? null)}`;
    const aliasOf = first.get(key) ?? null;
    if (!aliasOf) first.set(key, job.id);
    let ownerId: string | null = null;
    const runtime = /^runtime:(.+)$/.exec(job.id)?.[1];
    const nativeFreshness = runtime !== "freshness-shadow" || commandIdentity(job.command) === JSON.stringify(["scripts/freshness-shadow.mts", "--provider=postgres"]);
    if (runtime && pilotChildren.has(runtime) && nativeFreshness && ids.has("runtime:pilot-runner")) ownerId = "runtime:pilot-runner";
    else if ((job.source === "standing source contract" || job.source === "production standing national-place obligation" ||
        ["split-federal-people", "publish-meeting-doors"].includes(runtime ?? "")) && ids.has("runtime:routine-civic-data-runner"))
      ownerId = "runtime:routine-civic-data-runner";
    return { id: job.id, ownerId: aliasOf ? null : ownerId, aliasOf };
  });
}
