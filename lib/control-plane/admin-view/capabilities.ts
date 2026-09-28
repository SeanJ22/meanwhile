/**
 * The versioned Admin read/action surface advertised by the existing live pulse.
 *
 * An older deployment omits this field entirely. A mounted client treats that as
 * unavailable and keeps listening to the one shared pulse. Adding a compatible
 * backend route changes this manifest and therefore the pulse revision, so an
 * already-open page can retry its scoped read without a reload or fixture toggle.
 * This says code is present, not that a store read succeeded or an action is
 * authorized for the current subject.
 *
 * PURE: no I/O, clock, provider or data-plane read.
 */

export const ADMIN_CAPABILITY_NAMES = [
  "checklistDefinitions",
  "checklistInstances",
  "engineeringTasks",
  "fixHistory",
  "nationalOverview",
  "publicReaderObservation",
  "rawCapture",
  "resourceAssignments",
  "runnerProgress",
  "workerEvents",
] as const;

export type AdminCapabilityName = (typeof ADMIN_CAPABILITY_NAMES)[number];
export type AdminCapabilityStatus =
  | { readonly state: "SUPPORTED"; readonly contractVersion: number }
  | { readonly state: "UNAVAILABLE"; readonly contractVersion: null };

export interface AdminCapabilityManifest {
  readonly schemaVersion: 1;
  /** Changes only when code support or one of its compatible contracts changes. */
  readonly revision: string;
  readonly features: Readonly<Record<AdminCapabilityName, AdminCapabilityStatus>>;
}

const FEATURES: AdminCapabilityManifest["features"] = Object.freeze({
  checklistDefinitions: { state: "SUPPORTED", contractVersion: 1 },
  checklistInstances: { state: "UNAVAILABLE", contractVersion: null },
  engineeringTasks: { state: "UNAVAILABLE", contractVersion: null },
  fixHistory: { state: "UNAVAILABLE", contractVersion: null },
  nationalOverview: { state: "UNAVAILABLE", contractVersion: null },
  publicReaderObservation: { state: "SUPPORTED", contractVersion: 1 },
  rawCapture: { state: "UNAVAILABLE", contractVersion: null },
  resourceAssignments: { state: "UNAVAILABLE", contractVersion: null },
  runnerProgress: { state: "SUPPORTED", contractVersion: 1 },
  workerEvents: { state: "SUPPORTED", contractVersion: 1 },
});

/** Static and tiny; the Admin route still checks host and session first. */
export const ADMIN_CAPABILITIES: AdminCapabilityManifest = Object.freeze({
  schemaVersion: 1,
  revision: "admin-capabilities/1:checklistDefinitions/1:publicReaderObservation/1:runnerProgress/1:workerEvents/1",
  features: FEATURES,
});
