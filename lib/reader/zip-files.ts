import type { PlaceEntry } from "../place-map/reader.ts";
import type { PlaceFile, PlaceFileSource } from "./place-file.ts";
import { stateAnswerOf } from "./state-response.ts";
import { composeState, stateDivisionId, type StateShare, type StateWide } from "./state-share.ts";

/** The state's answer for a ZIP, made from the state's statewide part and the shares in the files of the ZIP's divisions. */
export async function stateAnswerFromFiles(source: PlaceFileSource, state: string, zip: string, entry: PlaceEntry & { readonly districts: readonly string[]}) {
  const { districts, ...placed } = entry, ids = [...new Set([stateDivisionId(state), ...entry.ids, ...districts])];
  const files = (await Promise.all(ids.map(id => source.file(id)))).filter((file): file is PlaceFile => file !== null);
  const wide = files.find(file => file.id === stateDivisionId(state))?.wide as StateWide | undefined;
  if (!wide) throw new Error(`STATE_FILE_MISSING:${state}`);
  return stateAnswerOf(composeState(wide, files.flatMap(file => file.share ? [file.share as StateShare] : [])), state, zip, placed);
}
