import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { startCivicReadCacheHost } from "../../lib/db/civic-read-cache-host.ts";

const baselineRssBytes = process.resourceUsage().maxRSS * 1024;
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const utilization = performance.eventLoopUtilization();
const host = await startCivicReadCacheHost();
process.send({ url: process.env.WTP_CIVIC_READ_CACHE_URL, token: process.env.WTP_CIVIC_READ_CACHE_TOKEN });
process.once("message", async () => {
  loop.disable();
  process.send({ baselineRssBytes, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    eventLoopMaxDelayMs: loop.max / 1e6, eventLoopUtilization: performance.eventLoopUtilization(utilization).utilization });
  await host.close();
  process.disconnect();
});
