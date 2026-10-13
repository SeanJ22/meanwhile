import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { CommentAccess } from "../registry/comment-access-client.ts";
import { captureProvenance } from "./capture.ts";
import { ensureEntity } from "./entities.ts";
import { readCheckEntity } from "./entity-read.ts";
import { publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";

type CommentField = "commentPeriod" | "commentPeriodDetail" | "signup" | "writtenComment" | "attend" | "timeLimit";
const FIELDS: readonly (readonly [CommentField, string])[] = [["commentPeriodDetail", "comment:detail"], ["signup", "comment:signup"],
  ["writtenComment", "comment:written"], ["attend", "comment:attend"], ["timeLimit", "comment:time_limit"]];
const PERIOD = "comment:period";

interface CommentReading {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly fieldSources?: Readonly<Record<string, { readonly quote?: string }>>;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** How a body takes public comment, one fact per rule; whether it takes comment rests on the page's own words about how. */
export async function publishCommentFacts(db: FactDb & { readonly query: Query }, input: {
  readonly body: { readonly id: string; readonly name: string | null; readonly state: string | null; readonly parentId: string | null };
  readonly capture: WorkerPublicationCapture; readonly reading: CommentReading; readonly producedBy: string;
}, clocks: Clocks, now: Date): Promise<readonly PublishOutcome[]> {
  await ensureEntity(db.query, { id: input.body.id, kind: "body", name: input.body.name ?? input.body.id, state: input.body.state, parentId: input.body.parentId });
  const entity = (await readCheckEntity(db.query, input.body.id))!;
  const copy = await db.transaction(query => saveCaptureCopy(query, input.capture));
  const provenance = captureProvenance(input.capture, entity.hosts);
  const out: PublishOutcome[] = [];
  const claim = (field: string, value: unknown, valueText: string, quote: string) =>
    publishClaim(db, { entity, field, fieldKind: "comment_rule", provenance, value, valueText, quote, copy, producedBy: input.producedBy, costUsd: 0 }, clocks, now);
  const quoteOf = (field: string) => text(input.reading.fieldSources?.[field]?.quote);
  for (const [from, field] of FIELDS) {
    const value = text(input.reading.fields[from]);
    if (value) out.push(await claim(field, value, value, quoteOf(from) ?? value));
  }
  const period = text(input.reading.fields.commentPeriod);
  // Whether a body takes comment is read from the page's own words about how, so that passage is both value text and quote.
  const support = quoteOf("commentPeriod") ?? FIELDS.map(([from]) => quoteOf(from) ?? text(input.reading.fields[from])).find((quote): quote is string => quote !== null);
  if ((period === "YES" || period === "NO") && support) out.push(await claim(PERIOD, period, support, support));
  return out;
}

const COMMENT_SQL = `SELECT f.entity_id, f.field, f.value, f.quote, f.checked_at, s.url, b.parent_id
  FROM fact f JOIN source_copy s ON s.id = f.source_copy_id JOIN entity b ON b.id = f.entity_id
  WHERE f.status = 'live' AND f.field LIKE 'comment:%' AND ($1::text[] IS NULL OR f.entity_id = ANY($1::text[]))
  ORDER BY f.entity_id, f.field`;

const KEYS: Readonly<Record<string, CommentField>> = { [PERIOD]: "commentPeriod", ...Object.fromEntries(FIELDS.map(([from, field]) => [field, from])) };

/** Each body's comment rules as readers see them, composed from live facts; a body is listed once it is known to take comment or not. */
export async function readFactCommentAccess(query: Query, bodyIds: readonly string[] | null = null): Promise<readonly CommentAccess[]> {
  const byBody = new Map<string, CommentAccess>();
  for (const row of await query(COMMENT_SQL, [bodyIds])) {
    const bodyId = String(row.entity_id), field = KEYS[String(row.field)];
    if (!field) continue;
    const at = new Date(row.checked_at as string).toISOString();
    const held = byBody.get(bodyId) ?? { bodyId, ocdId: /^ocd-division\//.test(String(row.parent_id ?? "")) ? String(row.parent_id) : /^(ocd-division\/[^#]+)#/.exec(bodyId)?.[1] ?? null,
      commentPeriod: "UNKNOWN", commentPeriodDetail: null, signup: null, writtenComment: null, attend: null, timeLimit: null,
      sourceUrl: String(row.url), collectedAt: at.slice(0, 10), verifiedAt: at, fieldSources: {} };
    Object.assign(held, { [field]: row.value });
    held.fieldSources![field] = { quote: String(row.quote), sourceUrl: String(row.url), collectedAt: at.slice(0, 10), verifiedAt: at };
    if (at > (held.verifiedAt ?? "")) Object.assign(held, { sourceUrl: String(row.url), collectedAt: at.slice(0, 10), verifiedAt: at });
    byBody.set(bodyId, held);
  }
  return [...byBody.values()].filter(record => record.commentPeriod !== "UNKNOWN");
}
