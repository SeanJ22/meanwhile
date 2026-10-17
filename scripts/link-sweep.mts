/**
 * Sweep the outbound links in the published reader edge and record how many are dead on each surface.
 *
 * Dry run by default: it reads the edge, looks at the links within the request rules, and prints the counts.
 * `--apply` writes the counts beside door health. Plain code: no AI, no model cost. `--limit=<n>` looks at only
 * the first n hosts' links (a trial); `--rotation=<n>` picks which links a small publisher gets this pass.
 */

import { openControlPlane } from "../lib/control-plane/admin-data.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { resolveReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { collectOutboundLinks, readEdgeForSweep, recordSweep, sweepLinks, type SweepFetch } from "../lib/doors/link-sweep.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";

const FLAGS = new Map<string, string>(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const eq = a.indexOf("=");
    return eq < 0 ? [a.slice(2), ""] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const say = (line: string): void => console.log(`doors:link-sweep · ${line}`);

const store = resolveReaderArtifactStore();
if (store === null) {
  say("REFUSED — this host has no reader artifact store, so there is no published edge to read.");
  process.exit(1);
}
const artifacts = await readEdgeForSweep(store);
let links = collectOutboundLinks(artifacts);
const limit = Number(FLAGS.get("limit") ?? "");
if (Number.isInteger(limit) && limit > 0) {
  const hosts = [...new Set(links.map((l) => new URL(l.url).hostname))].slice(0, limit);
  links = links.filter((l) => hosts.includes(new URL(l.url).hostname));
}
say(`${links.length} links found in ${artifacts.length} published pieces.`);
// Every request counts against the website's one shared hour, so the control plane is opened before any look.
const opened = await openControlPlane();
if (!opened.ok) {
  say(`REFUSED — ${opened.detail}`);
  process.exit(1);
}

const states = [...new Set(links.flatMap((l) => /(?:^|\.)([a-z]{2})\.gov$/i.exec(new URL(l.url).hostname)?.[1]?.toLowerCase() ?? []))];
const fetchFn: SweepFetch = async (url, method) => {
  const response = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": sourceUserAgent() } });
  return { status: response.status, retryAfter: response.headers.get("retry-after") };
};
const results = await sweepLinks(links, {
  fetchFn,
  now: () => Date.now(),
  pacing: opened.repos.websitePacing,
  sizeFor: await websiteSizeFromHoldings(states),
  rotation: Number(FLAGS.get("rotation") ?? Math.floor(Date.now() / 3_600_000)),
});
const looked = results.filter((r) => r.verdict !== "WAITING" && r.verdict !== "LATER").length;
say(floorLine(floored("links looked at", "sweepLinks", results.length, looked, "no links were handed to the sweep")));

if (!FLAGS.has("apply")) {
  const dead = results.filter((r) => r.verdict === "DEAD").length;
  say(`dry run: ${dead} dead of ${looked} looked at. No counts were recorded (the requests still count against each website's hour). Run with --apply to record the counts.`);
  process.exit(0);
}
const summaries = await recordSweep(opened.repos.doors, results, new Date().toISOString());
for (const s of summaries) say(`${s.surface}: ${s.dead} dead, ${s.ok} answering, ${s.later} to retry, ${s.waiting} waiting, of ${s.links}.`);
