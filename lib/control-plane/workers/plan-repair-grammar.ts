import type { RecordExtractionShape, VerificationAuthority } from "./types.ts";

/** The supported extraction language belongs to the finish tool. */
export function planRepairToolDescription(): string {
  const fields = { fieldName: { source: "/fieldName", type: "STRING" as const } };
  // Typed examples keep the model-visible grammar tied to the executor types.
  const examples: RecordExtractionShape[] = [
    { format: "JSON_RECORDS", rowsPointer: "/records", fields },
    { format: "XML_RECORDS", rowTag: "record", fields: { [Object.keys(fields)[0]]: { source: "fieldName", type: "STRING" } } },
    { format: "HTML_TABLE", tableIndex: 0, headerRows: 1, fields: { [Object.keys(fields)[0]]: { source: 0, type: "STRING" }, websiteUrl: { source: 0, type: "STRING", attribute: "href" } } },
    { format: "HTML_PROFILE", fields: { name: { source: "heading:detail-title", type: "STRING" }, office: { source: "detail:Title", type: "STRING" } } },
    { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 1, fields: { [Object.keys(fields)[0]]: { source: 0, type: "STRING" } } },
    { format: "TEXT_BLOCKS", recordStart: "Name:", recordEnd: "End of record", fields: { [Object.keys(fields)[0]]: { source: "Name:", type: "STRING" } } },
  ];
  const authority: VerificationAuthority = { id: "replace-with-register-id", type: "GOVERNMENT_REGISTER", publisher: "replace-with-actual-publisher-quoted-in-evidence",
    sourceId: "replace-with-captured-source-id", canonicalUrls: ["https://replace-with-actual-register.gov/records"], artifactIds: ["replace-with-actual-record-artifact-id"],
    authorityEvidenceArtifactIds: ["replace-with-actual-publisher-evidence-artifact-id"], independenceBasis: "DISTINCT_AUTHORITY",
    independenceExplanation: "Replace with the evidenced reason this distinct government authority independently publishes these records.", extraction: examples[0],
    comparison: { kind: "RECORD_VALUES", keyFields: ["fieldName"], fields: Object.keys(fields) } };
  const grammar = ` Exact extraction descriptor examples: ${JSON.stringify(examples)}. Replace every example locator with one inspected in retained bytes. JSON rowsPointer is an RFC6901 pointer to an array (empty string selects a root array); optional countPointer locates a published count. JSON field source is an RFC6901 pointer relative to each row. XML rowTag and field source are element names. HTML tableIndex and numeric field source are zero-based indexes; headerRows counts excluded headers. An HTML_TABLE field may use attribute:"href" only when the source cell contains one explicit anchor; its URL resolves against the captured page and remains bound to that exact cell span. HTML_PROFILE reads exactly one visible h2.detail-title and ul.detail-list; field sources are heading:detail-title or detail:Label (for example detail:Title), never script text, image alt, or a guessed address. Delimited text accepts only comma or tab. Every fields entry is {source:string|number,type:STRING|NUMBER|BOOLEAN|SCALAR}; map every required and identity field plus all independently supported contact and profile-link fields, at most32. Do not infer emails from an Email button or assign a shared office phone to a person. Exact authority descriptor example: ${JSON.stringify(authority)}. For independently captured official profile records, RECORD_VALUES_SUBSET with keyFields:["name"] and fields:["name","office"] may corroborate only explicitly matched members; all other members remain unverified. Up to16 separately mapped authorities and16 cited artifacts permit a seven-profile council without a four-source ceiling; continue through linked repair successors when a technical slice is incomplete. Examples are grammar only, never evidence or permission to guess values.`;
  const unmapped = ` When the retained bytes are real but no honest mapping exists (a PDF, a scanned agenda, a prose page), propose ${JSON.stringify({ schemaVersion: 1, sourceArtifactId: "<the retained artifact id>", extraction: { format: "UNSUPPORTED", mediaType: "<its media type>" }, authorities: [] })}: the Parser will pull the fields with exact quotes and code will confirm each quote is in the retained text. Cite the retained PDF_TEXT transcription for a PDF. Never combine this form with authorities.`;
  return "A finish candidate may attach contractRepair:{schemaVersion:1,sourceArtifactId,extraction,authorities}. Cite each source and authority in evidenceArtifactIds." + grammar + unmapped;
}
