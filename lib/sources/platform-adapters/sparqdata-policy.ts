/** Decode saved Sparq school-policy responses; no network or model calls. */
import { extractLinks } from '../../control-plane/scheduler/scout-tools.ts';
import { visibleText } from '../../extract/visible-text.ts';
import type {PlatformAdapterGuide} from '../../control-plane/scheduler/scout-adapters.ts';

const HOSTS=['policies.sparqdata.com','policy.azsba.org'];
export const guide:PlatformAdapterGuide={
  summary:'Sparq policy route: /sopapi/document/getdocument/{partner}/{tenant}/{collection}/{code}. Observe the codes in public portal requests; run sparqdata-policy on the saved API artifact, reusing captured bytes.',
  procedure:'For a Sparq /{partner}/browse/{tenant} portal, inspect its public requests for /sopapi/document/getdocument/{partner}/{tenant}/{collection}/{code}. Use observed collection and document codes, then run sparqdata-policy on the saved API artifact. It decodes JSON objects and double-encoded JSON strings, returning policy text, adoption date and source links. Match exact quotes to the captured source.',
  recordClasses:['local-jurisdiction','PUBLIC_COMMENT_RULE'],sourceUrls:HOSTS.map(host=>'https://'+host),
};

export function extract(input: { text: string; sourceUrl: string }) {
  const source = new URL(input.sourceUrl);
  const route = /^\/sopapi\/document\/getdocument\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/?$/i.exec(source.pathname);
  if (!route || !HOSTS.includes(source.hostname) ||
    !['https:', 'http:'].includes(source.protocol)) throw new Error('SPARQ_POLICY_SOURCE_REQUIRED');
  let value: unknown = JSON.parse(input.text);
  // The public API also returns a JSON document encoded inside a JSON string.
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SPARQ_POLICY_DOCUMENT_REQUIRED');
  const document = value as Record<string, unknown>;
  const [partner, , collection, code] = route.slice(1).map(decodeURIComponent);
  if (document.partnerCode !== partner || document.collectionCode !== collection || document.documentCode !== code) {
    throw new Error('SPARQ_POLICY_IDENTITY_MISMATCH');
  }
  if (document.isViewable !== true || document.isPartialDoc === true || document.isEmptyDoc === true ||
    typeof document.html !== 'string' || !document.html.trim() || typeof document.title !== 'string') {
    throw new Error('SPARQ_POLICY_CONTENT_UNAVAILABLE');
  }
  return {
    sourceUrl: source.href,
    policyCode: document.documentCode,
    title: document.title,
    adoptedAt: typeof document.dtAdopted === 'string' ? document.dtAdopted : null,
    text: visibleText(document.html),
    links: extractLinks(document.html, source, Number.MAX_SAFE_INTEGER),
  };
}
