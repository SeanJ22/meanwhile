/** LegiScan datasets use the same complete, bounded source archive reader. */
import { readZipEntries } from "../archive.ts";
export interface ZipEntry { name: string; data: Buffer }
export function readZip(buf: Buffer): ZipEntry[] {
  return readZipEntries(buf);
}
