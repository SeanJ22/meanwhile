/** Default reader labels; published reader settings override them without a build. */
export const READER_COPY = {
  "copy.working": "We’re working on getting this info",
  "copy.notFound": "Not found in the sources checked",
  "copy.notPublished": "{item} not posted yet",
  "copy.askMap": "Ask: a meeting?",
  "copy.askSidebar": "Ask about a meeting, a school…",
  "copy.askWgh": "Ask about a meeting, a school…",
  "copy.askAccessible": "Ask about your area — a meeting, your school board, your ballot",
} as const;

export type CopyKey = keyof typeof READER_COPY;
export type CopyValues = Readonly<Record<string, unknown>>;

export function copy(key: CopyKey, values: CopyValues = {}, vars: Readonly<Record<string, string>> = {}): string {
  const value = values[key];
  const text = typeof value === "string" && value.trim() ? value : READER_COPY[key];
  return text.replace(/\{([a-z]+)\}/g, (all, name: string) => vars[name] ?? all);
}
