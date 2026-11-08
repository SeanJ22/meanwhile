import { sha256Text } from "../sha256-text.ts";
export function statePeopleVersion(jurisdiction: string, versions: readonly {scope:string;versionId:string}[]): string {
  if (versions.length === 1) return versions[0].versionId;
  return `state-people:${sha256Text(JSON.stringify([jurisdiction,[...versions].sort((a,b)=>a.scope.localeCompare(b.scope))]))}`;
}

/** The federal directory with its standing portraits laid over it: unchanged when no portraits are held. */
export function federalDirectoryVersion(directoryVersionId: string, portraitsVersionId: string | null): string {
  if (portraitsVersionId === null) return directoryVersionId;
  return `federal-directory:${sha256Text(JSON.stringify([directoryVersionId, portraitsVersionId]))}`;
}
