import { channel } from "node:diagnostics_channel";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface StageItem { stage: string; item: string; itemBytes: number; liveItems: number }

export function serializedJsonByteLength(value: unknown): number {
  if (typeof value === "string" && !/[\u0000-\u001f"\\\ud800-\udfff]/.test(value)) return Buffer.byteLength(value) + 2;
  if (value === null || typeof value !== "object") return Buffer.byteLength(JSON.stringify(value));
  if (Array.isArray(value)) return 2 + value.reduce((sum, row, index) => sum + Number(index > 0) + serializedJsonByteLength(row), 0);
  let bytes = 2, members = 0;
  for (const key in value) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) bytes += Number(members++ > 0) + Buffer.byteLength(JSON.stringify(key)) + 1 + serializedJsonByteLength(item);
  }
  return bytes;
}

export function measureFederalMoneyMemory(scratchRoot?: string, includeChildren = true) {
  const baseline = process.memoryUsage();
  let peak = baseline.rss, sampledPeakScratchBytes = 0, samples = 0;
  let current: StageItem = { stage: "initialization", item: "runtime", itemBytes: 0, liveItems: 0 };
  let peakSnapshot = { ...baseline, ...current, sampledWorkerTreeRssBytes: baseline.rss, elapsedMs: 0 };
  const started = performance.now();
  const stages: Record<string, { peakRssBytes: number; largestItem: string; largestItemBytes: number; declaredMaxLiveItems: number; peak: typeof peakSnapshot }> = {};
  function scratchBytes(path: string): number {
    try { const stat = statSync(path); return stat.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + scratchBytes(join(path, name)), 0) : stat.size; }
    catch { return 0; }
  }
  function treeRss(pid = process.pid): number {
    try {
      if (pid !== process.pid && readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("federal-money-postgres-server.mts")) return 0;
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const rss = Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? 0) * 1024;
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
      return rss + children.reduce((total, child) => total + treeRss(child), 0);
    } catch { return pid === process.pid ? process.memoryUsage.rss() : 0; }
  }
  function sample() {
    const usage = process.memoryUsage(), rss = includeChildren ? treeRss() : usage.rss;
    const snapshot = { ...usage, ...current, sampledWorkerTreeRssBytes: rss, elapsedMs: performance.now() - started };
    const stage = stages[current.stage] ??= { peakRssBytes: rss, largestItem: current.item, largestItemBytes: current.itemBytes, declaredMaxLiveItems: current.liveItems, peak: snapshot };
    if (rss > stage.peakRssBytes) { stage.peakRssBytes = rss; stage.peak = snapshot; }
    if (current.itemBytes > stage.largestItemBytes) { stage.largestItem = current.item; stage.largestItemBytes = current.itemBytes; }
    stage.declaredMaxLiveItems = Math.max(stage.declaredMaxLiveItems, current.liveItems);
    if (rss > peak) { peak = rss; peakSnapshot = snapshot; }
  }
  function stage(item: StageItem) { current = item; sample(); }
  const diagnostics = channel("federal-money:memory");
  const listener = (message: unknown) => stage(message as StageItem);
  diagnostics.subscribe(listener);
  const timer = setInterval(() => {
    sample();
    if (scratchRoot && ++samples % 10 === 0) sampledPeakScratchBytes = Math.max(sampledPeakScratchBytes, scratchBytes(scratchRoot));
  }, 100);
  timer.unref();
  return { sample, stage, finish() {
    sample(); clearInterval(timer); diagnostics.unsubscribe(listener);
    const processPeakRssBytes = process.resourceUsage().maxRSS * 1024;
    return { baseline, peakSnapshot, stages, processPeakRssBytes, sampledPeakWorkerTreeRssBytes: peak,
      peakRssBytes: Math.max(peak, processPeakRssBytes), sampledPeakScratchBytes,
      method: "Kernel process high-water RSS plus worker-tree sampling every 100ms and stage events; database child excluded. Stage item sizes/counts describe active operations, not a heap-retention census. Baseline is reported without subtraction; no forced GC or heap-size flags." };
  } };
}
