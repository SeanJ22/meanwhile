// Extracts public-comment rule facts from the plain-text layer of a board agenda PDF.
// Pure extraction: no network, no parsing of PDF bytes. Input is the retained transcription text.
// Every returned exactQuote is a verbatim substring of the input text.

const RULES = [
  {
    field: 'call_to_public.time_limit',
    re: /Limited\s+to\s+\d+\s+to\s+\d+\s+minutes/i,
    value: (q) => q.replace(/^Limited\s+to\s+/i, '').replace(/\s+/g, ' '),
  },
  {
    field: 'call_to_public.comment_scope',
    re: /Comments\s+should\s+be\s+limited\s+to\s+[^.]*\./i,
    value: (q) => q.replace(/^Comments\s+should\s+be\s+limited\s+to\s+/i, '').replace(/\.$/, '').replace(/\s+/g, ' '),
  },
  {
    field: 'call_to_public.board_action_limit',
    re: /The\s+Board\s+shall\s+not\s+and\s+cannot\s+discuss\s+or\s+take\s+legal\s+action\s+on\s+matters\s+raised\s+during\s+an\s+open\s+call\s+to\s+the\s+public/i,
    value: (q) => q.replace(/\s+/g, ' '),
  },
];

/**
 * @param {{text: string, sourceUrl: string}} input
 * @returns {Array<{field: string, value: string, exactQuote: string, sourceUrl: string}>}
 */
export function extract({ text, sourceUrl } = {}) {
  if (typeof text !== 'string' || typeof sourceUrl !== 'string' || sourceUrl.length === 0) {
    return [];
  }
  const facts = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const exactQuote = m[0];
    // Guard: the quote must be exact retained text, never a joined or rewritten string.
    if (!text.includes(exactQuote)) continue;
    facts.push({
      field: rule.field,
      value: rule.value(exactQuote),
      exactQuote,
      sourceUrl,
    });
  }
  return facts;
}
