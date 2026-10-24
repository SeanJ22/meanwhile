import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { COMMENT_FIELDS as FIELDS, COMMENT_PERIOD as PERIOD } from "./comment-read.ts";
import { captureProvenance } from "./capture.ts";
import { ensureEntity } from "./entities.ts";
import { readCheckEntity } from "./entity-read.ts";
import { publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";
import { publishBodyNameFromPage } from "./roster-facts.ts";



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
  const bodyId = await ensureEntity(db.query, { id: input.body.id, kind: "body", name: input.body.name ?? input.body.id, state: input.body.state, parentId: input.body.parentId });
  const entity = (await readCheckEntity(db.query, bodyId))!;
  const copy = await db.transaction(query => saveCaptureCopy(query, input.capture));
  const provenance = captureProvenance(input.capture, entity.hosts);
  const out: PublishOutcome[] = [];
  const claim = (field: string, value: unknown, valueText: string, quote: string) =>
    publishClaim(db, { entity, field, fieldKind: "comment_rule", provenance, value, valueText, quote, copy, producedBy: input.producedBy, acquisition: "walker", costUsd: 0 }, clocks, now);
  const quoteOf = (field: string) => text(input.reading.fieldSources?.[field]?.quote);
  for (const [from, field] of FIELDS) {
    const value = text(input.reading.fields[from]);
    if (value) out.push(await claim(field, value, value, quoteOf(from) ?? value));
  }
  const period = text(input.reading.fields.commentPeriod);
  // Whether a body takes comment is read from the page's own words about how, so that passage is both value text and quote.
  const support = quoteOf("commentPeriod") ?? FIELDS.map(([from]) => quoteOf(from) ?? text(input.reading.fields[from])).find((quote): quote is string => quote !== null);
  if ((period === "YES" || period === "NO") && support) out.push(await claim(PERIOD, period, support, support));
  if (out.some(row => "decision" in row && (row.decision === "PUBLISH" || row.decision === "CONFIRM"))) await publishBodyNameFromPage(db, { entity, copy, provenance, producedBy: input.producedBy }, clocks, now);
  return out;
}
