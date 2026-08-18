import { readFileSync } from "node:fs";
import { join } from "node:path";

import { positionsFor, positionMatchCount } from "@/lib/corpus/positions";
import type { StatementCorpus } from "@/lib/corpus/types";

/**
 * GET /api/positions/<subject>/<topic> — D35's three answers, served.
 *
 * ## Why this is a route and not an import
 *
 * The statement corpus is ~175 KB of extracted page text. Importing it into
 * the battlecard would ship every candidate's scraped pages to every reader
 * who opens any card, to answer a question most of them will not ask. It
 * stays on the server and the search runs there.
 *
 * ## Why the subject and the topic are PATH segments
 *
 * CLAUDE.md's distinctness rule, learned from production serving one
 * campaign's books for three politicians: *"an HTTP response whose body varies
 * by a request input must carry that input where every cache implementation
 * keys on it — in the path, never only a query string on a `public`
 * response."* Both inputs vary the body completely, so both are in the path,
 * and the response additionally declares `no-store` — the belt to that
 * braces, because a positions answer is a thing a reader asked for rather
 * than a thing worth holding.
 *
 * ## What it will not do
 *
 * It does not summarise, rank by anything but term count, or say what a
 * passage means. It returns the corpus's own words with the URL and the read
 * date attached, or one of the two named gaps. There is no model in this
 * path.
 */

export const runtime = "nodejs";

/** A topic longer than this is not a topic. The cap is stated, not implied. */
const MAX_TOPIC_CHARS = 120;

let cached: StatementCorpus | null = null;
function corpus(): StatementCorpus {
  cached ??= JSON.parse(
    readFileSync(join(process.cwd(), "data", "corpus", "statements.json"), "utf8"),
  ) as StatementCorpus;
  return cached;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ subject: string; topic: string }> },
) {
  const { subject: rawSubject, topic: rawTopic } = await params;
  const subject = decodeURIComponent(rawSubject);
  const topic = decodeURIComponent(rawTopic).slice(0, MAX_TOPIC_CHARS);

  if (!subject || !topic.trim()) {
    return Response.json({ error: "subject and topic are required" }, { status: 400 });
  }

  let answer;
  try {
    answer = positionsFor(subject, topic, corpus());
  } catch {
    // A failed read is reported as a failed read. It is never rendered as an
    // absence — "we have not collected this" would be a claim about a person
    // made because a file would not open.
    return Response.json(
      { error: "the statement corpus could not be read" },
      { status: 503 },
    );
  }

  return Response.json(
    {
      ...answer,
      // Stated N equals rendered rows, and the denominator rides with it.
      totalMatches:
        answer.kind === "MATCHED"
          ? positionMatchCount(subject, topic, corpus())
          : 0,
    },
    {
      status: 200,
      headers: {
        // Varies by two path inputs and is cheap to recompute; nothing here
        // is worth a shared cache getting subtly wrong.
        "Cache-Control": "private, no-store",
      },
    },
  );
}
