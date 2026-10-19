import assert from "node:assert/strict";

import { heldBodyGaps, type HeldAskGap, type HeldGapMeetingLike } from "../../lib/ask/held-gaps.ts";
import type { AskGapHoldings, CarrierClock } from "../../lib/control-plane/scheduler/providers/ask-gaps.ts";
import type { RegistryPass } from "../../lib/control-plane/scheduler/registry.ts";
import type { PersistedSittingOutcomes } from "../../lib/outcomes/types.ts";
import type { AgendaDocumentLike } from "../../lib/routing/agenda-search.ts";

/** A held meeting as a fixture lists it: the fields the gaps are decided from, and the body it belongs to. */
export type AskGapMeeting = HeldGapMeetingLike & { readonly bodyId?: string | null };

/** The registered unit of one body's Ask-gap obligation for one code, or a named failure listing what the pass holds. */
export function unitOf(pass: Pick<RegistryPass, "units">, bodyId: string, code: string): RegistryPass["units"][number] {
  const unit = pass.units.find((u) => u.obligation.id === `freshness:ask-gap:${bodyId}#${code}`);
  assert.ok(unit, `no ${code} obligation for ${bodyId}; have ${pass.units.map((u) => u.obligation.id).join(", ")}`);
  return unit;
}

/** The meetings of each body, in the order a state's index would yield them. */
export function meetingsByBody(meetings: readonly AskGapMeeting[]): Map<string, AskGapMeeting[]> {
  const out = new Map<string, AskGapMeeting[]>();
  for (const meeting of meetings) {
    if (!meeting.bodyId) continue;
    out.set(meeting.bodyId, [...out.get(meeting.bodyId) ?? [], meeting]);
  }
  return out;
}

/** What `readAskGapHoldings` hands the provider, decided body by body from fixture meetings, documents and sittings. */
export function heldReading(input: {
  readonly meetings: readonly AskGapMeeting[];
  readonly documents: readonly AgendaDocumentLike[];
  readonly sittings: readonly PersistedSittingOutcomes[];
  readonly now: number;
  readonly clockOf: (contractId: string) => CarrierClock;
  readonly outcomesUnreadable?: string | null;
  readonly source?: string;
}): AskGapHoldings {
  const outcomesUnreadable = input.outcomesUnreadable ?? null;
  const byBody = meetingsByBody(input.meetings);
  const bodies: { bodyId: string; gaps: readonly HeldAskGap[] }[] = [];
  for (const [bodyId, meetings] of byBody) {
    const ids = new Set(meetings.map((m) => m.id));
    const held = heldBodyGaps({
      bodyId,
      meetings,
      documents: input.documents.filter((d) => ids.has(d.meetingId)),
      sittings: input.sittings.filter((s) => s.bodyId === bodyId),
      now: input.now,
      outcomesUnavailable: outcomesUnreadable !== null,
    });
    if (held.gaps.length > 0) bodies.push({ bodyId, gaps: held.gaps });
  }
  return {
    source: input.source ?? "the fixture holdings",
    bodies,
    meetingCountOf: (bodyId) => byBody.get(bodyId)?.length ?? 0,
    outcomesUnreadable,
    clockOf: input.clockOf,
  };
}
