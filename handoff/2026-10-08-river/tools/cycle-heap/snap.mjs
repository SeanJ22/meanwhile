// Take a heap snapshot of a running node process through its inspector. Usage: node snap.mjs <pid> <out.heapsnapshot> [port]
import { createWriteStream } from "node:fs";
const [pid, out, port = "9229"] = process.argv.slice(2);
process.kill(Number(pid), "SIGUSR1");
let list;
for (let i = 0; i < 50; i++) {
  try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); }
}
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
const file = createWriteStream(out);
let id = 0; const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === "HeapProfiler.addHeapSnapshotChunk") file.write(m.params.chunk);
  else if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise(r => { ws.onopen = r; });
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const t0 = Date.now();
await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false });
await new Promise(r => file.end(r));
console.log(`snapshot written in ${Date.now() - t0} ms`);
ws.close();
process.exit(0);
