import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import type { PublicBodyAttempt } from "../registry/body-attempt-read.ts";
import type { BodyFacts } from "../facts/registry-overlay.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

export type AgendaDocumentLink = Pick<MeetingsSnapshot["agendaDocuments"][number], "meetingId" | "documentUrl">;
export interface PlacePackage {
  readonly registry: RegistryRuntimeReadModel | null;
  readonly everydayRouting: EverydayRoutingProjection | null;
  readonly publicationAttempts: readonly PublicBodyAttempt[];
  readonly bodies: readonly BodyFacts[];
  readonly governments: readonly RegistrationGovernmentListing[];
  readonly divisions: readonly Division[];
  readonly registrationHeld: boolean;
  readonly meetings: readonly Meeting[];
  readonly snapshot: MeetingsSnapshot;
  /** When a held calendar was last gathered; null when this place holds none, so no reader surface shows a date. */
  readonly snapshotHeldAt: string | null;
  /** URL ownership for unopened agendas, used only within this request's publication reading. */
  readonly agendaDocumentLinks: readonly AgendaDocumentLink[];
  readonly bodySnapshots: Readonly<Record<string, MeetingsSnapshot>>;
}

export type PlaceInput = { readonly state: string; readonly divisionIds: readonly string[]; readonly bodyIds?: readonly string[]; readonly allBodies?: boolean; readonly includeHistory?: boolean; readonly includeAgenda?: boolean;
  /** Set for a typed ZIP: its answer is its places saved pages combined, and its boards keep the name facts they are published under. */
  readonly placeId?: string;
  /** Ballot reads consume only body facts; their registry and directory come from the state package. */
  readonly bodyFactsOnly?: boolean;
  /** Load these sittings and their merge/identity/URL context; ordinary body reads retain the complete calendar. */
  readonly meetingIds?: readonly string[];
  readonly neighbors?: boolean;
  /** Divisions read only for their names: the ones reaching into a ZIP where few of its residents live. */
  readonly namedDivisionIds?: readonly string[] };
