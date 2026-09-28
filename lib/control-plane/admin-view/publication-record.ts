import { safePublicationDetail } from "./publication-history.ts";

/** A detail read navigates one saved JSON node, never an entire legacy document. */
export const PUBLICATION_RECORD_PAGE_SIZE = 25;
export const PUBLICATION_RECORD_TEXT_SLICE = 6_000;
export const PUBLICATION_PROTECTED_KEY_PATTERN = "^(password|passwd|secret|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key|cookie)$";

export type PublicationRecordKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "missing";
export interface PublicationRecordChild {
  readonly key: string;
  readonly kind: PublicationRecordKind;
  readonly value?: string | number | boolean | null;
  /** Child count for a container, or character count for a string. */
  readonly size?: number;
  readonly protected?: true;
  readonly pathUnavailable?: true;
  readonly boundaryTextWithheld?: true;
}
export interface PublicationRecordNode {
  readonly kind: PublicationRecordKind;
  /** Exact DB-reported child count or string character count; never inferred from a page. */
  readonly total: number;
  readonly children: readonly PublicationRecordChild[];
  readonly text?: string;
  readonly value?: string | number | boolean | null;
  readonly boundaryTextWithheld?: true;
}

const protectedKey = new RegExp(PUBLICATION_PROTECTED_KEY_PATTERN, "i");
const kinds = new Set<PublicationRecordKind>(["object", "array", "string", "number", "boolean", "null", "missing"]);

export function isProtectedPublicationKey(key: string): boolean {
  return protectedKey.test(key);
}

/** JSON-encoded path segments; [] addresses the record root. */
export function parsePublicationRecordPath(serializedJSON: unknown): string[] | null {
  if (typeof serializedJSON !== "string" || serializedJSON.length > 100_000) return null;
  try {
    const parsed: unknown = JSON.parse(serializedJSON);
    if (!Array.isArray(parsed) || parsed.length > 20) return null;
    let total = 0;
    for (const part of parsed) {
      if (typeof part !== "string" || isProtectedPublicationKey(part)) return null;
      const characters = Array.from(part).length;
      if (characters > 300) return null;
      total += characters;
      if (total > 3_000) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function kindOf(value: unknown): value is PublicationRecordKind {
  return typeof value === "string" && kinds.has(value as PublicationRecordKind);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function scalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}
function safeScalar(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== "string") return value;
  const bounded = Array.from(value).slice(0, PUBLICATION_RECORD_TEXT_SLICE).join("");
  return safePublicationDetail(bounded) as string;
}
function suppressBoundaryTokens(value: string, startsMidToken: boolean, endsMidToken: boolean): { text: string; withheld: boolean } {
  if (!startsMidToken && !endsMidToken) return { text: value, withheld: false };
  const leading = startsMidToken ? /^\S*/u.exec(value)?.[0].length ?? 0 : 0;
  const trailing = endsMidToken ? /\S*$/u.exec(value)?.[0].length ?? 0 : 0;
  const end = value.length - trailing;
  const marker = "[boundary text withheld]";
  if (leading >= end) return { text: marker, withheld: true };
  return { text: `${startsMidToken ? marker : ""}${value.slice(leading, end)}${endsMidToken ? marker : ""}`, withheld: true };
}
function flag(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

/** Validate the bounded SQL projection before handing it to an Admin page. */
export function sanitizePublicationRecordNode(raw: unknown): PublicationRecordNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (!kindOf(input.kind) || !count(input.total) || !Array.isArray(input.children)
    || input.children.length > PUBLICATION_RECORD_PAGE_SIZE) return null;
  const children: PublicationRecordChild[] = [];
  for (const childRaw of input.children) {
    if (!childRaw || typeof childRaw !== "object" || Array.isArray(childRaw)) return null;
    const child = childRaw as Record<string, unknown>;
    if (typeof child.key !== "string" || Array.from(child.key).length > 300 || !kindOf(child.kind)
      || !flag(child.pathUnavailable) || !flag(child.endsMidToken)
      || (child.endsMidToken !== undefined && child.kind !== "string")) return null;
    if (isProtectedPublicationKey(child.key)) {
      children.push({ key: child.key, kind: "missing", value: "[redacted]", protected: true });
      continue;
    }
    if (child.size !== undefined && !count(child.size)) return null;
    if (child.value !== undefined && (!scalar(child.value)
      || (typeof child.value === "string" && child.value.length > PUBLICATION_RECORD_TEXT_SLICE * 2))) return null;
    const preview = typeof child.value === "string" && child.kind === "string"
      ? suppressBoundaryTokens(child.value, false, child.endsMidToken === true) : null;
    const projected: PublicationRecordChild = {
      key: child.key,
      kind: child.kind,
      ...(child.size === undefined ? {} : { size: child.size }),
      ...(child.value === undefined ? {} : { value: safeScalar(preview?.text ?? child.value as string | number | boolean | null) }),
      ...(child.pathUnavailable === true ? { pathUnavailable: true as const } : {}),
      ...(preview?.withheld ? { boundaryTextWithheld: true as const } : {}),
    };
    children.push(projected);
  }
  if (!flag(input.startsMidToken) || !flag(input.endsMidToken)
    || ((input.startsMidToken !== undefined || input.endsMidToken !== undefined) && input.kind !== "string")) return null;
  if (input.text !== undefined && (typeof input.text !== "string" || input.text.length > PUBLICATION_RECORD_TEXT_SLICE * 2)) return null;
  if (input.value !== undefined && (!scalar(input.value)
    || (typeof input.value === "string" && input.value.length > PUBLICATION_RECORD_TEXT_SLICE * 2))) return null;
  const text = typeof input.text === "string"
    ? suppressBoundaryTokens(input.text, input.startsMidToken === true, input.endsMidToken === true) : null;
  return {
    kind: input.kind,
    total: input.total,
    children,
    ...(text === null ? {} : { text: safeScalar(text.text) as string }),
    ...(input.value === undefined ? {} : { value: safeScalar(input.value as string | number | boolean | null) }),
    ...(text?.withheld ? { boundaryTextWithheld: true as const } : {}),
  };
}
