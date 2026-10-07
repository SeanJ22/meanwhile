export interface InstructionDraft {
  readonly text: string;
  readonly chosenBody: string | null;
}

export type InstructionDrafts = Readonly<Record<string, InstructionDraft>>;

const EMPTY_DRAFT: InstructionDraft = { text: "", chosenBody: null };

export function instructionDraftFor(drafts: InstructionDrafts, scopeKey: string): InstructionDraft {
  return Object.hasOwn(drafts, scopeKey) ? drafts[scopeKey]! : EMPTY_DRAFT;
}

export function withInstructionDraft(drafts: InstructionDrafts, scopeKey: string, draft: InstructionDraft): InstructionDrafts {
  return { ...drafts, [scopeKey]: draft };
}
