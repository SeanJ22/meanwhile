import { createHash } from "node:crypto";
export function statePeopleVersion(jurisdiction: string, versions: readonly {scope:string;versionId:string}[]): string {
  if (versions.length === 1) return versions[0].versionId;
  return `state-people:${createHash("sha256").update(JSON.stringify([jurisdiction,[...versions].sort((a,b)=>a.scope.localeCompare(b.scope))])).digest("hex")}`;
}

/** The federal directory with its standing portraits laid over it: unchanged when no portraits are held. */
export function federalDirectoryVersion(directoryVersionId: string, portraitsVersionId: string | null): string {
  if (portraitsVersionId === null) return directoryVersionId;
  return `federal-directory:${createHash("sha256").update(JSON.stringify([directoryVersionId, portraitsVersionId])).digest("hex")}`;
}
