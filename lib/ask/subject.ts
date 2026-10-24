import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";

export type AskSubjectKind =
  | "BODY"
  | "PERSON"
  | "OFFICE"
  | "CONTEST"
  | "MEASURE";

export interface AskSubjectRef {
  id?: string | null;
  name: string;
  kind?: AskSubjectKind | null;
  focused?: boolean;
}

export function readSubjectRefs(raw: unknown, max = 60): AskSubjectRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AskSubjectRef[] = [];
  for (const entry of raw.slice(0, max)) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ name: entry.trim().slice(0, 160) });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
    if (!name && !id) continue;
    out.push({
      id: id ? id.slice(0, 240) : null,
      name: (name || id || "").slice(0, 160),
      kind: SUBJECT_KINDS.includes(value.kind as AskSubjectKind)
        ? (value.kind as AskSubjectKind)
        : null,
      focused: value.focused === true,
    });
  }
  return out;
}

export const SUBJECT_KINDS: AskSubjectKind[] = [
  "BODY",
  "PERSON",
  "OFFICE",
  "CONTEST",
  "MEASURE",
];

type EvidenceSubjectKind = "BODY" | "PERSON" | "MEASURE" | "CONTEST" | "OFFICE";

const SUBJECT_KIND_OF: Readonly<Record<EvidenceSubjectKind, AskSubjectKind>> = {
  BODY: "BODY",
  PERSON: "PERSON",
  MEASURE: "MEASURE",
  CONTEST: "CONTEST",
  OFFICE: "OFFICE",
};

export function subjectKindOf(kind: EvidenceSubjectKind): AskSubjectKind {
  return SUBJECT_KIND_OF[kind];
}

export function resolveSubjectRef(
  ref: AskSubjectRef,
  entities: readonly BindableEntity[],
): BindableEntity | null {
  if (ref.id) {
    const matches = entities.filter((e) => e.id === ref.id || e.aliases?.includes(ref.id!));
    return new Set(matches.map(entity => entity.id)).size === 1 ? matches[0] : null;
  }
  if (!ref.name) return null;
  const binding = bindNamedEntity(ref.name, entities);
  return binding.kind === "BOUND" ? binding.entity : null;
}

export function resolveSubjectRefs(
  refs: readonly AskSubjectRef[],
  entities: readonly BindableEntity[],
): { ref: AskSubjectRef; entity: BindableEntity }[] {
  const seen = new Set<string>();
  const out: { ref: AskSubjectRef; entity: BindableEntity }[] = [];
  for (const ref of refs) {
    const entity = resolveSubjectRef(ref, entities);
    if (!entity || seen.has(entity.id)) continue;
    seen.add(entity.id);
    out.push({ ref, entity });
  }
  return out;
}
