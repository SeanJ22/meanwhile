import { canonicalModelId, MODELS, modelRequestFields } from "../models.ts";
import { WORKER_SAFETY_FRAME } from "../control-plane/playbooks.ts";
import type { ModelRequest, ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import { bodyNameKey } from "../civic-data/published-body-name.ts";
import { normalizeText } from "../facts/check.ts";
import type { Query } from "../facts/publish.ts";
import type { PlacementDecision, PlacementQuestion } from "./placement.ts";

/**
 * The placement agent settles what plain code could not prove: which government runs a body, or which of several records is one
 * board. It reads the government's own pages, answers through one tool, and must quote a line of one of those pages that shows
 * the choice. Plain code checks the quote is on the page it names. A model that is unsure, or whose quote is not on the page, is
 * asked once more on the strongest model; after that the case is a tie and goes to a detective.
 */

export interface PlacementPage { readonly url: string; readonly text: string }
interface Candidate { readonly id: string; readonly name: string; readonly kind: "government" | "body"; readonly hosts: readonly string[]; readonly government: string | null }
export interface PlacementCase { readonly question: PlacementQuestion; readonly subject: Candidate; readonly candidates: readonly Candidate[]; readonly pages: readonly PlacementPage[] }

const PLACE_TOOL = { name: "place", description: "Say where the body belongs, quoting the government's own page.",
  input_schema: { type: "object", required: ["action", "url", "quote", "sure"], properties: {
    action: { enum: ["MOVE", "MERGE", "KEEP", "UNSURE"], description: "MOVE: the body is run by the candidate government in `target`. MERGE: it is the same board as the candidate body in `target`. KEEP: it is its own body and stays where it is." },
    target: { type: "string", description: "The id of the candidate government (MOVE) or body (MERGE)." },
    url: { type: "string", description: "The page you quote; one of the supplied pages." },
    quote: { type: "string", description: "One exact line from that page that shows your choice." },
    sure: { type: "boolean" } } } } as const;
const RULES = "Decide where one body belongs from the government's own pages only. Choose a candidate only when a page you were given shows it; otherwise answer UNSURE. Never guess from a name alone.";
const thinking = (model: string) => {
  const fields = modelRequestFields(model, { thinking: "ADAPTIVE", effort: "medium" });
  return { ...(fields.thinking?.type === "adaptive" ? { thinking: fields.thinking } : {}), output_config: { effort: "medium" as const } };
};

/** The parts of a page that mention the case, so a long page still shows what matters. */
export function excerpt(text: string, names: readonly string[], size = 9_000): string {
  if (text.length <= size) return text;
  const lower = text.toLowerCase(), at = names.flatMap(name => { const found = lower.indexOf(name.toLowerCase()); return found < 0 ? [] : [found]; }).sort((a, b) => a - b);
  return (at.length ? at.slice(0, 6).map(index => text.slice(Math.max(0, index - 700), index + 1_500)) : [text.slice(0, size)]).join("\n…\n").slice(0, size);
}

/** The answer when it quotes the page it names and picks one of the candidates; null otherwise. */
function verified(answer: Record<string, unknown> | null, found: PlacementCase): PlacementDecision | null {
  if (!answer || typeof answer.url !== "string" || typeof answer.quote !== "string" || answer.sure !== true || !["MOVE", "MERGE", "KEEP"].includes(String(answer.action))) return null;
  const page = found.pages.find(row => row.url === answer.url), quote = normalizeText(answer.quote).toLowerCase(), target = typeof answer.target === "string" ? answer.target : undefined;
  const names = [found.subject, ...found.candidates.filter(row => row.id === target)].map(row => bodyNameKey(row.name));
  if (!page || quote.length < 8 || !normalizeText(page.text).toLowerCase().includes(quote) || !names.some(name => name && bodyNameKey(quote).includes(name))) return null;
  const action = String(answer.action) as "MOVE" | "MERGE" | "KEEP", kind = found.question.kind === "OWNER" ? "MOVE" : "MERGE";
  if (action !== "KEEP" && (action !== kind || !found.candidates.some(row => row.id === target))) return null;
  return { action, subject: found.subject.id, ...(target ? { target } : {}), url: page.url, quote: answer.quote };
}

export async function decidePlacement(found: PlacementCase, transport: ModelTransport): Promise<PlacementDecision> {
  const view = (row: Candidate) => ({ ...row, hosts: row.hosts.slice(0, 4) });
  const content = JSON.stringify({ question: found.question.kind === "OWNER" ? "Which government runs this body?" : "Is this body the same as one of the candidates, or its own body?",
    body: view(found.subject), candidates: found.candidates.map(view),
    pages: found.pages.map(page => ({ url: page.url, text: excerpt(page.text, [found.subject.name, ...found.candidates.map(row => row.name)]) })) });
  for (const model of [MODELS.sonnet.model, MODELS.opus.model]) {
    const request: ModelRequest = { model, max_tokens: 2048, ...thinking(model), system: [{ type: "text", text: `${WORKER_SAFETY_FRAME}\n\n${RULES}` }],
      tools: [PLACE_TOOL], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] };
    const response = await transport(request);
    const tools = response.content.filter(block => block.type === "tool_use" && (block as { name?: string }).name === PLACE_TOOL.name);
    const decision = response.stop_reason !== "max_tokens" && canonicalModelId(response.model) === canonicalModelId(model) && tools.length === 1
      ? verified((tools[0] as { input?: Record<string, unknown> }).input ?? null, found) : null;
    if (decision) return decision;
  }
  return { action: "TIE", subject: found.subject.id, why: "The government's own pages did not settle it." };
}

const candidatesOf = async (query: Query, ids: readonly string[]): Promise<Candidate[]> => (await query(`SELECT e.id,e.name,e.kind,
    coalesce((SELECT array_agg(h.host) FROM entity_host h WHERE h.entity_id=coalesce(g.id,e.id)),'{}') AS hosts, g.name AS government
  FROM entity e LEFT JOIN entity g ON g.id=e.parent_id AND g.kind='government' WHERE e.id=ANY($1::text[]) ORDER BY e.id`, [ids]))
  .map(row => ({ id: String(row.id), name: String(row.name), kind: row.kind === "government" ? "government" as const : "body" as const, hosts: row.hosts as string[], government: row.government === null ? null : String(row.government) }));

/**
 * One turn: the questions that are due, each read against the government's own pages, decided, and settled. `pagesFor` fetches
 * only pages on the hosts it is given.
 */
export async function placementTurn(deps: { readonly query: Query; readonly claim: (n: number) => Promise<readonly PlacementQuestion[]>;
  readonly settle: (decision: PlacementDecision, question: PlacementQuestion) => Promise<void>;
  readonly transportFor: (subjectId: string) => ModelTransport; readonly pagesFor: (hosts: readonly string[], sources: readonly string[]) => Promise<readonly PlacementPage[]>;
  readonly log: (line: string) => void; readonly limit?: number }): Promise<number> {
  const questions = await deps.claim(deps.limit ?? 3);
  for (const question of questions) {
    const [subject, ...candidates] = await candidatesOf(deps.query, [question.subject, ...question.candidates.filter(id => id !== question.subject)]);
    if (!subject) continue;
    const governments = question.kind === "OWNER" ? candidates : [subject, ...candidates];
    const sources = await deps.query(`SELECT DISTINCT s.final_url FROM fact f JOIN source_copy s ON s.id=f.source_copy_id WHERE f.entity_id=ANY($1::text[]) AND f.status='live' LIMIT 6`, [[subject.id, ...candidates.map(row => row.id)]]);
    const pages = await deps.pagesFor([...new Set(governments.flatMap(row => row.hosts))], sources.map(row => String(row.final_url)));
    const decision = await decidePlacement({ question, subject, candidates, pages }, deps.transportFor(subject.id));
    deps.log(`placement agent: ${question.subject} -> ${decision.action}${decision.action === "TIE" ? ` (${decision.why})` : ` ${decision.url}`}`);
    await deps.settle(decision, question);
  }
  return questions.length;
}
