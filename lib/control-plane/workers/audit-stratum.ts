export type AuditStratumContract = {readonly recordClass:string}&(
  {readonly schemaVersion:1;readonly publisherSlug:string}|
  {readonly schemaVersion:2;readonly sourceScope:{readonly canonicalUrls:readonly string[];readonly publisher:string}}
);

/** A record class from one publisher, without retaining extraction instructions or evidence. */
export function stratumOf(contract:AuditStratumContract):string{
  const url=contract.schemaVersion===2?contract.sourceScope.canonicalUrls[0]:undefined;
  let host=contract.schemaVersion===2?contract.sourceScope.publisher:contract.publisherSlug;
  if(url)try{host=new URL(url).host.toLowerCase();}catch{/* Keep the named publisher. */}
  return `${contract.recordClass}|${host}`;
}
