/**
 * G05 RULE 4e, AS A PURE FUNCTION (2026-08-17).
 *
 * *"A SINGLE instance of the Ballot/zip+Ask pill cluster: WGH open renders it
 * at the top of WGH; sidebar open and WGH closed renders it at the top of the
 * sidebar; both closed renders it as the map's top-right pill. Location is
 * determined ONLY by which of sidebar and WGH is open; a large battlecard
 * never hosts it, so with a battlecard open the cluster is on the map."*
 *
 * It lives in `lib/` rather than beside the component for one practical
 * reason: `node --test` cannot import a `.tsx`, and a rule that a test cannot
 * reach is a rule held only by a comment. The component imports it from here.
 *
 * THE BATTLECARD IS DELIBERATELY NOT A PARAMETER. That is the rule expressed
 * as a type rather than as discipline — a function that never receives the
 * battlecard's state cannot be made to answer differently because of it, and
 * a later edit wanting it to would have to change the signature in front of a
 * reviewer. The function is also TOTAL: four inputs, three placements, and no
 * combination without an answer.
 */

export type AskPillPlacement = "map" | "sidebar" | "wgh";

export function clusterPlacement(open: {
  wgh: boolean;
  sidebar: boolean;
}): AskPillPlacement {
  if (open.wgh) return "wgh";
  if (open.sidebar) return "sidebar";
  return "map";
}
