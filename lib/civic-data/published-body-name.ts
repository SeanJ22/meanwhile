export type PublishedBodyLabel = { readonly kind: "body" | "meeting" | "notice" | "test"; readonly name: string | null };

const words = (text: string) => text.replace(/\s+/g, " ").trim();
const bodyNoun = /\b(?:board|council|commission|committee|authority|agency|assembly|court|corporation|commissioners|supervisors|trustees|selectmen|selectboard|jury)\b/i;
const event = /\b(?:meetings?|sessions?|worksession|workshops?|addendum|addenda)\b/i;

/** A calendar's meeting-type selector is not a second government body. Keep the body's printed words. */
export function publishedBodyLabel(raw: string): PublishedBodyLabel {
  const text = words(raw);
  if (/\btest\b/i.test(text)) return { kind: "test", name: null };
  if (/\bnotices?\b/i.test(text)) return { kind: "notice", name: null };
  // These are the legal names of standing bodies, rather than a particular sitting or a test environment.
  if (/^town meeting$/i.test(text) || /\btesting and recruiting committee\b/i.test(text)
    || /\bopen meetings act\b/i.test(text)) return { kind: "body", name: text };
  const leadingSitting=/^(?:(?:regular|special|emergency|joint|annual|monthly|quarterly|called|adjourned|cancelled|canceled|recessed|continued)\s+)*(?:(?:board|work|study)\s+)?(?:meetings?|sessions?|workshops?)\b/i.test(text);
  if (!leadingSitting && !/\b(?:test|notices?)\b/i.test(text)
    && /\b(?:committee|commission|board|council|authority|agency)\b$/i.test(text)) return { kind: "body", name: text };
  const kind = /\btest\b|\btesting\b/i.test(text) ? "test"
    : /\bnotices?\b/i.test(text) ? "notice" : event.test(text) ? "meeting" : "body";
  if (kind === "body") return { kind, name: text };
  if (kind === "test" || kind === "notice") return { kind, name: null };
  let name = text
    .replace(/^(?:(?:regular|special|emergency|joint|annual|monthly|quarterly|called|adjourned|cancelled|canceled|recessed|continued)\s+)*(?:(?:board|work|study)\s+)?(?:meetings?|sessions?|workshops?)\s*(?:[-:]\s*|(?:of|for)\s+(?:the\s+)?)/i, "")
    .replace(/^(?:(?:regular|special|emergency|joint|cancelled|canceled|annual|quarterly)\s+)+/i, "")
    .replace(/\s*\(SAP\)\s*$/i, "");
  // Everything from the sitting description onward belongs to the meeting, including a workshop's subject.
  name = name.replace(/\s*(?:[-–—:(/]\s*)?(?:(?:regular|special|emergency|joint|annual|monthly|quarterly|full|first|second|pre|business|land use|agenda review|strategic planning|planning|budget|executive|closed|work|study|training|listening|organizational|ceremonial|conference|public|board)\s+)*(?:meetings?|sessions?|worksession|workshops?|addendum|addenda)\b[\s\S]*$/i, "")
    .replace(/[\s,:;/(\-–—]+$/g, "").replace(/\s+and$/i, "");
  name = words(name);
  return { kind, name: bodyNoun.test(name) ? name : null };
}

export const bodyNameKey = (text: string): string => text.toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
