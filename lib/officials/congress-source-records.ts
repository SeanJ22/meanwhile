import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parse } from "yaml";
import { congressLegislatorIsComplete, currentCongressTerm } from "./congress-normalize.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";

export const CONGRESS_SOURCE_FILES = ["legislators-current", "legislators-social-media", "legislators-district-offices", "committee-membership-current", "committees-current"] as const;
export type CongressSourceName = typeof CONGRESS_SOURCE_FILES[number];

/** A source has one top-level member or committee per YAML block. No country-sized YAML document or AST is constructed. */
export async function* readCongressYamlBlocks(path: string, mapping = false): AsyncGenerator<unknown> {
  const lines = createInterface({ input: createReadStream(path, { highWaterMark: 64 * 1024 }), crlfDelay: Infinity });
  let held = "", started = false;
  const decode = (text: string) => parse(text, { maxAliasCount: 0, uniqueKeys: true });
  try {
    for await (const line of lines) {
      if (!started && (!line.trim() || line.startsWith("#") || line === "---")) continue;
      if (!started && line.trimStart().startsWith("<")) throw new Error("CONGRESS_HTML_RESPONSE");
      const boundary = mapping ? /^[A-Za-z0-9]+:\s*(?:#.*)?$/.test(line) : /^-(?:\s|$)/.test(line);
      if (boundary && started) { yield decode(held); held = ""; }
      if (!started && !boundary) throw new Error("CONGRESS_FILE_SHAPE_INVALID");
      started = true;
      held += line + "\n";
    }
    if (held) yield decode(held);
  } finally { lines.close(); }
}

export interface CongressStateSource {
  readonly value: unknown;
  readonly complete?: boolean;
}

/** Retain the state's people and only their joined optional records, while validating every source row as it passes. */
export async function readCongressStateSource(input: {
  readonly path: string; readonly name: CongressSourceName; readonly state: string; readonly asOf: string;
  readonly memberIds: ReadonlySet<string>; readonly committeeIds: ReadonlySet<string>;
}): Promise<CongressStateSource> {
  const state = requireRegistryState(input.state), selected: unknown[] = [], memberships: Record<string, unknown[]> = {};
  let rows = 0, complete = true;
  for await (const block of readCongressYamlBlocks(input.path, input.name === "committee-membership-current")) {
    if (input.name === "committee-membership-current") {
      if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error("CONGRESS_FILE_SHAPE_INVALID");
      for (const [id, members] of Object.entries(block)) {
        if (!Array.isArray(members)) throw new Error("CONGRESS_FILE_SHAPE_INVALID");
        const own = members.filter(row => row && input.memberIds.has(String(row.bioguide)));
        if (own.length) memberships[id] = own;
      }
      continue;
    }
    if (!Array.isArray(block) || block.length !== 1) throw new Error("CONGRESS_FILE_SHAPE_INVALID");
    const row = block[0]; rows++;
    if (input.name === "legislators-current") {
      complete &&= congressLegislatorIsComplete(row);
      const terms = Array.isArray(row?.terms) ? row.terms : [];
      if (currentCongressTerm(terms, input.asOf)?.state === state) selected.push(row);
    } else if (input.name === "committees-current") {
      if (!row || typeof row.thomas_id !== "string") continue;
      const subcommittees = (Array.isArray(row.subcommittees) ? row.subcommittees : []).filter((sub: { thomas_id?: string }) => input.committeeIds.has(`${row.thomas_id}${sub?.thomas_id}`));
      if (input.committeeIds.has(row.thomas_id) || subcommittees.length) selected.push({ ...row, ...(Array.isArray(row.subcommittees) ? { subcommittees } : {}) });
    } else if (row && input.memberIds.has(String(row.id?.bioguide))) selected.push(row);
  }
  if (input.name === "legislators-current" && !rows) throw new Error("CONGRESS_CORE_EMPTY");
  return { value: input.name === "committee-membership-current" ? memberships : selected,
    ...(input.name === "legislators-current" ? { complete } : {}) };
}
