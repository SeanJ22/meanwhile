import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readTranslations } from "./publication.ts";
import { translationRecordIssue, type TextTranslation, type TranslationRecord } from "./records.ts";

export function textTranslationFor(records: readonly TranslationRecord[], input: {
  readonly kind: TextTranslation["kind"]; readonly subjectId: string; readonly ocdId: string;
  readonly sourceUrl?: string; readonly sourceHash?: string;
}): TextTranslation | null {
  const matching = records.filter((row): row is TextTranslation => row.kind === input.kind && row.subjectId === input.subjectId &&
    row.ocdId === input.ocdId && (!input.sourceUrl || row.sourceUrl === input.sourceUrl) &&
    (!input.sourceHash || row.sourceHash === input.sourceHash.replace(/^sha256-/, "")) && !translationRecordIssue(row));
  return matching.length === 1 ? matching[0] : null;
}

/** The general legal class and this body's charter remain separate layers. */
export async function readBodyTranslations(input: { readonly ocdId: string; readonly bodyId: string; readonly classKey: string }, options: PromotedCivicDataReadOptions = {}) {
  const jurisdiction = jurisdictionFromOcdId(input.ocdId);
  if (!jurisdiction) throw new Error("Body translation requires a state-scoped exact division.");
  const stateDivision = `ocd-division/country:us/state:${jurisdiction.usps.toLowerCase()}`;
  const records = await readTranslations([stateDivision, input.ocdId], options);
  return {
    classDefinition: textTranslationFor(records, { kind: "BODY_CLASS", subjectId: `body_class:${jurisdiction.usps}:${input.classKey}`, ocdId: stateDivision }),
    bodyDefinition: textTranslationFor(records, { kind: "BODY", subjectId: `body:${input.bodyId}`, ocdId: input.ocdId }),
  };
}

export async function readOfficeTranslation(input: { readonly state: string; readonly officeKey: string }, options: PromotedCivicDataReadOptions = {}) {
  const ocdId = `ocd-division/country:us/state:${input.state.toLowerCase()}`;
  return textTranslationFor(await readTranslations([ocdId], options), { kind: "OFFICE", subjectId: `office:${input.state.toUpperCase()}:${input.officeKey}`, ocdId });
}

/** Revisions attach only to the exact held meeting document, never by body name. */
export async function readMeetingTranslation(input: {
  readonly kind: "AGENDA" | "MINUTES"; readonly meetingId: string; readonly ocdId: string;
  readonly documentUrl: string; readonly contentHash: string;
}, options: PromotedCivicDataReadOptions = {}) {
  return textTranslationFor(await readTranslations([input.ocdId], options), {
    kind: input.kind, subjectId: `${input.kind.toLowerCase()}:${input.meetingId}`, ocdId: input.ocdId,
    sourceUrl: input.documentUrl, sourceHash: input.contentHash,
  });
}
