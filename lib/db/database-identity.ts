import { createHash } from "node:crypto";

/** Credential-free identity shared by pooled and direct connections to one database. */
export function databaseIdentity(connectionString:string):string {
  const url=new URL(connectionString);
  const host=url.hostname.toLowerCase().replace("-pooler.",".");
  const database=decodeURIComponent(url.pathname.replace(/^\/+/,""));
  return createHash("sha256").update(`${host}/${database}`).digest("hex").slice(0,16);
}
