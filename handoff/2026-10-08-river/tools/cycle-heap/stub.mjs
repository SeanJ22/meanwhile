// Local Anthropic Messages + Message Batches stub, plus Brave/Exa search stubs. Never forwards anywhere.
// Scouts replay a recorded walk (cp_log_scout_results) for their obligation, then finish citing this walk's artifacts.
// Usage: node stub.mjs <port> <plans.json> <log.ndjson>
import { createServer } from "node:http";
import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [port, plansPath, logPath] = process.argv.slice(2);
const plans = JSON.parse(readFileSync(plansPath, "utf8"));
const byObligation = new Map(plans.map(p => [p.obligationId, p]));
const bySubject = new Map(); const byClass = new Map();
for (const p of plans) {
  if (!bySubject.has(p.subjectId)) bySubject.set(p.subjectId, []);
  bySubject.get(p.subjectId).push(p);
  if (!byClass.has(p.recordClass)) byClass.set(p.recordClass, []);
  byClass.get(p.recordClass).push(p);
}
const hopsByQuery = new Map();
for (const p of plans) for (const r of p.rungs) if (r.tool === "search" && Array.isArray(r.hops)) hopsByQuery.set(r.target, r.hops);
const hash = s => createHash("sha256").update(s).digest();
const pick = (list, key) => list[hash(key).readUInt32BE(0) % list.length];
const log = rec => appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n");

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(b => typeof b?.text === "string" ? b.text : typeof b?.content === "string" ? b.content
    : Array.isArray(b?.content) ? textOf(b.content) : "").join("\n");
}
const usageFor = (req, out) => {
  const inTok = Math.ceil(Buffer.byteLength(JSON.stringify(req.messages)) / 4);
  return { input_tokens: Math.min(inTok, 4000), cache_read_input_tokens: Math.max(0, inTok - 4000), cache_creation_input_tokens: 0, output_tokens: out };
};
let seq = 0;
const message = (req, content, stop = "tool_use", out = 400) => ({
  id: `msg_stub_${++seq}`, type: "message", role: "assistant", model: req.model, content,
  stop_reason: stop, stop_sequence: null, usage: usageFor(req, out),
});
const toolUse = (name, input) => ({ type: "tool_use", id: `toolu_stub_${++seq}`, name, input });

const ALLOWED_TOOLS = new Set(["fetch_public", "read_permission", "search"]);
function scoutTurn(req) {
  const brief = textOf(req.messages[0]?.content);
  const obligationId = /obligation id: (\S+)/.exec(brief)?.[1] ?? "";
  const subjectId = /subject: (\S+)/.exec(brief)?.[1] ?? "";
  const recordClass = /record class: (\S+)/.exec(brief)?.[1] ?? "";
  const plan = byObligation.get(obligationId) ?? (bySubject.get(subjectId) ? pick(bySubject.get(subjectId), obligationId) : null)
    ?? (byClass.get(recordClass) ? pick(byClass.get(recordClass), obligationId) : pick(plans, obligationId));
  const offered = new Set((req.tools ?? []).map(t => t.name));
  const steps = plan.rungs.filter(r => (r.tool === "browse" ? offered.has("fetch_public") : offered.has(r.tool)) && ALLOWED_TOOLS.has(r.tool === "browse" ? "fetch_public" : r.tool)).slice(0, 14);
  // What this conversation already did.
  const uses = []; const results = [];
  for (const m of req.messages) if (Array.isArray(m.content)) for (const b of m.content) {
    if (m.role === "assistant" && b.type === "tool_use") uses.push(b);
    if (m.role === "user" && b.type === "tool_result") results.push({ id: b.tool_use_id, text: textOf(b.content ?? ""), isError: b.is_error === true });
  }
  const all = results.map(r => r.text).join("\n");
  const restartRungs = [...all.matchAll(/\[rung (\d+):/g)].length;
  const finishes = uses.filter(u => u.name === "finish");
  const lastFinishRefused = finishes.length > 0 && results.at(-1)?.text.startsWith("REFUSED");
  const walked = uses.filter(u => u.name !== "finish" && u.name !== "record_rung").length;
  const bound = /BOUND REACHED/.test(results.at(-1)?.text ?? "");
  const artifacts = [...all.matchAll(/ARTIFACT (\S+) \| url (\S+)(?: \| final (\S+))? \| HTTP (\S+) \|[^\n]*?\| retrieved (\S+) \| permission (\S+)/g)]
    .map(m => ({ id: m[1], url: m[2], final: m[3] ?? m[2], status: m[4], retrieved: m[5], permission: m[6] }));
  const rungIdx = [...all.matchAll(/\[rung (\d+): ([^\s]+) → ([^\s]+)/g)].map(m => ({ index: Number(m[1]) }));
  if (finishes.length >= 2 && lastFinishRefused) return { content: [{ type: "text", text: "I cannot finish further." }], stop: "end_turn" };
  if (!bound && !lastFinishRefused && walked < steps.length) {
    const r = steps[walked];
    const why = (r.why ?? "Advance the owed question.").slice(0, 300);
    if (r.tool === "search") return { content: [{ type: "text", text: "Searching." }, toolUse("search", { query: r.target, rung: r.rung, why })] };
    return { content: [toolUse(r.tool === "browse" ? "fetch_public" : r.tool, { url: r.target, rung: r.rung, why })] };
  }
  const rungsWalked = [...new Map(rungIdx.map(r => [r.index, r])).values()].map(r => ({ index: r.index, note: plan.rungs[r.index]?.note ?? "walked" }));
  const good = artifacts.filter(a => a.status === "200");
  const wantsCandidates = !lastFinishRefused && (plan.outcome === "ROUTE_CANDIDATE" || plan.outcome === "EVIDENCE_FOUND") && plan.candidates.length > 0 && good.length > 0;
  const candidates = wantsCandidates ? plan.candidates.slice(0, 3).map(c => {
    const a = good.find(g => g.url === c.url || g.final === c.url) ?? good[0];
    return { routeId: c.routeId, title: c.title, url: a.url, procedure: c.procedure, relevance: c.relevance, permission: a.permission,
      permissionReading: `robots verdict ${a.permission} on the envelope`, evidenceArtifactIds: [a.id], observedOn: a.retrieved.slice(0, 10),
      recordClass, deterministic: c.deterministic === true, unverified: Array.isArray(c.unverified) ? c.unverified : [] };
  }) : [];
  const outcome = candidates.length > 0 ? "ROUTE_CANDIDATE" : "NO_PROGRESS";
  return { content: [{ type: "text", text: "Finishing." }, toolUse("finish", { outcome, rungsWalked, candidates, findings: [],
    nextRungs: plan.nextRungs ?? [], unverified: [], narrative: (plan.narrative ?? "Walked the recorded ladder.").slice(0, 1500) })] };
}

function answer(req) {
  const names = (req.tools ?? []).map(t => t.name);
  if (names.includes("finish") && (names.includes("fetch_public") || names.includes("read_permission"))) {
    const turn = scoutTurn(req);
    return { kind: "scout", body: message(req, turn.content, turn.stop ?? "tool_use") };
  }
  // Pre-warm / anything else: a short text answer.
  return { kind: names.length ? `tools:${names.slice(0, 6).join(",")}` : "text", body: message(req, [{ type: "text", text: "{}" }], "end_turn", 20) };
}

const batches = new Map();
const read = req => new Promise((res, rej) => { const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => res(Buffer.concat(chunks).toString("utf8"))); req.on("error", rej); });
const send = (res, status, obj, type = "application/json") => { res.writeHead(status, { "content-type": type, "anthropic-ratelimit-requests-limit": "4000", "anthropic-ratelimit-requests-remaining": "3999" }); res.end(typeof obj === "string" ? obj : JSON.stringify(obj)); };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://stub");
    const raw = req.method === "POST" ? await read(req) : "";
    if (url.pathname === "/brave/res/v1/web/search") {
      const q = url.searchParams.get("q") ?? "";
      const hops = hopsByQuery.get(q) ?? [];
      log({ kind: "brave", q: q.slice(0, 120), hits: hops.length });
      return send(res, 200, { web: { results: hops.slice(0, 8).map((u, i) => ({ title: `Result ${i + 1}`, url: u, description: `Recorded pointer for ${q}` })) } });
    }
    if (url.pathname === "/exa/search") {
      log({ kind: "exa" });
      return send(res, 200, { results: [] });
    }
    if (url.pathname === "/v1/messages" && req.method === "POST") {
      const body = JSON.parse(raw);
      const out = answer(body);
      log({ kind: out.kind, model: body.model, bytes: raw.length, messages: body.messages.length, stop: out.body.stop_reason,
        tools: out.body.content.filter(b => b.type === "tool_use").map(b => b.name) });
      return send(res, 200, out.body);
    }
    if (url.pathname === "/v1/messages/batches" && req.method === "POST") {
      const body = JSON.parse(raw);
      const id = `msgbatch_stub_${++seq}`;
      const results = body.requests.map(r => { const out = answer(r.params); return { custom_id: r.custom_id, result: { type: "succeeded", message: out.body } }; });
      batches.set(id, results);
      log({ kind: "batch", count: body.requests.length, bytes: raw.length });
      return send(res, 200, { id, type: "message_batch", processing_status: "ended", created_at: new Date().toISOString(), results_url: `https://api.anthropic.com/v1/messages/batches/${id}/results`, request_counts: { succeeded: results.length } });
    }
    let m = /^\/v1\/messages\/batches\/([^/]+)\/results$/.exec(url.pathname);
    if (m) return send(res, 200, (batches.get(m[1]) ?? []).map(r => JSON.stringify(r)).join("\n"), "application/x-jsonl");
    m = /^\/v1\/messages\/batches\/([^/]+)$/.exec(url.pathname);
    if (m) return send(res, 200, { id: m[1], type: "message_batch", processing_status: "ended", results_url: `https://api.anthropic.com/v1/messages/batches/${m[1]}/results` });
    if (url.pathname === "/v1/messages/batches") return send(res, 200, { data: [], has_more: false, last_id: null });
    log({ kind: "unknown", method: req.method, path: url.pathname });
    send(res, 404, { type: "error", error: { type: "not_found_error", message: "stub" } });
  } catch (error) {
    log({ kind: "stub-error", error: String(error).slice(0, 300) });
    send(res, 500, { type: "error", error: { type: "api_error", message: "stub failure" } });
  }
}).listen(Number(port), "127.0.0.1", () => console.log(`stub on ${port}`));
