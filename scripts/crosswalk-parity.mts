/**
 * DB-24, read only: does the automatic meeting-body crosswalk hold what the manual one produced?
 *
 *   node --experimental-strip-types scripts/crosswalk-parity.mts --state=AZ
 *
 * Reads the two promoted crosswalk pointers and prints `crosswalkParity` (lib/civic-data/crosswalk-parity.ts). It
 * writes nothing and promotes nothing. The manual contract is retired only when `onlyManualActive` is empty and the
 * `manualWithdrawn` rows are handled.
 */
import { crosswalkParity } from "../lib/civic-data/crosswalk-parity.ts";
import { readMeetingDerivationProjection } from "../lib/civic-data/meeting-derivation-read.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { requireRegistryState } from "../lib/civic-data/state-scopes.ts";
import { readDerivedMeetingBodyCrosswalk } from "../lib/civic-data/derived-crosswalk.ts";
import type { MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

installNeonRequestDeadline();
const state = requireRegistryState(process.argv.find(argument => argument.startsWith("--state="))?.slice("--state=".length) ?? "");
const manual = await readMeetingDerivationProjection<CuratedReaderProjection>({ family: "meeting-body-crosswalk", options: { state, bypassCache: true },
  statePath: ["ocdId"], value: records => ({ kind: "meeting-body-crosswalk", records: records as CuratedReaderProjection["records"] }) });
const derived = await readDerivedMeetingBodyCrosswalk({ state, bypassCache: true });
if (manual.kind !== "PROMOTED" && manual.kind !== "NOT_RECORDED") throw new Error(`manual crosswalk unreadable: ${manual.kind}`);
if (derived.kind !== "PROMOTED") throw new Error(`automatic crosswalk unreadable: ${derived.kind}`);
const manualRows = manual.kind === "PROMOTED" ? manual.value.records as unknown as MeetingBodyCrosswalkRow[] : [];
const parity = crosswalkParity(manualRows, derived.value.records as unknown as MeetingBodyCrosswalkRow[]);
console.log(JSON.stringify({
  manualVersion: manual.metadata.versionId,
  derivedVersion: derived.metadata.versionId,
  manualRows: parity.manualRows,
  derivedRows: parity.derivedRows,
  covered: parity.covered.length,
  onlyManualActive: parity.onlyManualActive,
  manualWithdrawn: parity.manualWithdrawn,
  differs: parity.differs,
}, null, 2));
