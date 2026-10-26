import { createHash } from "node:crypto";
import type { Officeholder, OfficeholderSet } from "./types.ts";
import { personIdentityKeys,nativePersonIdFromUrl,memberProfileSubpageParentUrl } from "./people-identity.ts";
import { portraitBindingMatches } from "../photos/binding.ts";

const name = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const subject = (person: Officeholder) => `${person.state?.toUpperCase()}|${person.level}|${name(person.name)}`;
const collapsed = (person: Officeholder) => (person.nativeIds?.["ocd-person"]?.length ?? 0) > 1 || (person.nativeIds?.plural?.length ?? 0) > 1;
export function sourcePeople(person: Officeholder): readonly Officeholder[] {
  return person.sourceHolders?.length ? person.sourceHolders.flatMap(sourcePeople) : [person];
}
export function sourcePersonIsDocument(person:Officeholder):boolean {
  const urls=person.nativeIds?.["official-legislature"]??[];
  return !person.nativeIds?.["ocd-person"]?.length&&urls.length>0&&urls.every(value=>{
    try{return /\.(?:pdf|docx?|xlsx?)$/i.test(new URL(value).pathname);}catch{return false;}
  });
}

/** Changing a record's display ID removes no person when all previous IDs
 * still resolve once, and every native person is present under its own ID. */
export function retainsPeopleBindings(before:readonly Officeholder[],after:readonly Officeholder[]):boolean {
  const owners=new Map<string,Officeholder[]>();
  for(const person of after)for(const id of personIdentityKeys(person)) {
    const matches=owners.get(id)??[];matches.push(person);owners.set(id,matches);
  }
  return before.every(person=>[...personIdentityKeys(person)].every(id=>{
    const matches=owners.get(id);
    if(matches?.length!==1||(matches[0].nativeIds?.["ocd-person"]?.length??0)>1)return false;
    const uuid=/^(?:plural:(?:[a-z]{2}:)?|ocd-person[/:](?:ocd-person\/)?|openstates:(?:ocd-person\/)?)([a-f0-9-]{36})$/i.exec(id)?.[1];
    return !uuid||[...matches[0].nativeIds?.["ocd-person"]??[],...matches[0].nativeIds?.openstates??[]].some(native=>native.replace(/^ocd-person\//,"")===uuid);
  })&&(person.nativeIds?.["ocd-person"]??[]).every(id=>after.some(current=>current.nativeIds?.["ocd-person"]?.includes(id))));
}

/** A directory URL is evidence shared by its entries, never a shared person ID.
 * Rebind earlier directory collapses from the independently held source people.
 * Their original reader IDs stay with the named entry; native aliases return to
 * the source person that owns them. No reader or candidate is read here. */
export function bindPeopleSources(sets: readonly OfficeholderSet[]): OfficeholderSet[] {
  const sources = sets.flatMap(set => set.officeholders.flatMap(sourcePeople)).filter(person => !collapsed(person)&&!sourcePersonIsDocument(person)&&
    (person.nativeIds?.["ocd-person"]?.length||!(person.nativeIds?.["official-legislature"]??[]).some(url=>{
      const parent=memberProfileSubpageParentUrl(url);return Boolean(parent&&nativePersonIdFromUrl(parent));
    })));
  const nativeIdentity=(person:Officeholder)=>person.nativeIds?.["ocd-person"]?.length===1
    ? `${person.state?.toUpperCase()}|${person.level}|${person.nativeIds["ocd-person"][0]}`:subject(person);
  const bySubject = new Map<string, Officeholder[]>(), byIdentity = new Map<string, Officeholder[]>(), owners = new Map<string, Set<string>>(), nativeOwners = new Map<string, Set<string>>();
  for (const person of sources) {
    const identity = nativeIdentity(person), rows = bySubject.get(subject(person)) ?? [], nativeRows=byIdentity.get(identity)??[];
    rows.push(person); bySubject.set(subject(person), rows);
    nativeRows.push(person);byIdentity.set(identity,nativeRows);
    for(const id of [...person.nativeIds?.["ocd-person"]??[],...person.nativeIds?.openstates??[]]) {
      const uuid=id.replace(/^ocd-person\//,"");
      const held=nativeOwners.get(uuid)??new Set<string>();held.add(identity);nativeOwners.set(uuid,held);
    }
    const keys = new Set(personIdentityKeys(person));
    // Earlier official records used either form of the member URL's hash.
    for (const url of [person.websiteUrl, ...person.profileUrls ?? []]) if (url) {
      const digest = createHash("sha256").update(url).digest("hex").slice(0, 24);
      keys.add(`official-legislature:${digest}`);
      keys.add(`official-legislature:${person.state?.toLowerCase()}:${digest}`);
      keys.add(`official-legislature:${url}`);
    }
    for (const key of keys) {
      const held = owners.get(key) ?? new Set<string>(); held.add(identity); owners.set(key, held);
    }
  }
  const namedIdentity=(named:string)=>{
    const matches=bySubject.get(named)??[],identities=new Set(matches.map(nativeIdentity));
    return identities.size===1?[...identities][0]:named;
  };
  const identityOf=(person:Officeholder)=>person.nativeIds?.["ocd-person"]?.length===1?nativeIdentity(person):namedIdentity(subject(person));
  const ownerOf = (key:string):string|undefined => {
    // Old reader aliases also contain the state-scoped Plural form, even when
    // the independently held source uses the global form of that same UUID.
    const uuid=/^(?:plural:(?:[a-z]{2}:)?|ocd-person[/:](?:ocd-person\/)?|openstates:(?:ocd-person\/)?)([a-f0-9-]{36})$/i.exec(key)?.[1];
    const native=uuid?nativeOwners.get(uuid):undefined;
    const matches=native??owners.get(key);return matches?.size===1?[...matches][0]:undefined;
  };
  const foreign=(person:Officeholder,key:string)=>Boolean(ownerOf(key)&&ownerOf(key)!==identityOf(person));
  const documentReference=(person:Officeholder)=>{
    if(person.nativeIds?.["ocd-person"]?.length)return undefined;
    const parents=new Set((person.nativeIds?.["official-legislature"]??[]).flatMap(url=>{
      const parent=memberProfileSubpageParentUrl(url),native=parent?nativePersonIdFromUrl(parent):null;
      return native?[`${native.source}:${native.id}`]:[];
    }));
    if(!sourcePersonIsDocument(person)&&!parents.size)return undefined;
    const matches=sources.filter(source=>source.nativeIds?.["ocd-person"]?.length===1&&(personIdentityKeys(source).has(person.id)||
      [source.websiteUrl,...source.profileUrls??[]].some(url=>{
        const native=url?nativePersonIdFromUrl(url):null;return Boolean(native&&parents.has(`${native.source}:${native.id}`));
      })));
    return new Set(matches.map(nativeIdentity)).size===1?matches[0]:undefined;
  };
  const needsBinding=(person:Officeholder)=>collapsed(person)||Boolean(documentReference(person))||[...personIdentityKeys(person)].some(key=>foreign(person,key));
  if(!sets.some(set=>set.officeholders.some(needsBinding)))return [...sets];
  const referenceFor = (identity:string):Officeholder|undefined => {
    const matches=byIdentity.get(identity)??[];
    return new Set(matches.flatMap(row=>row.nativeIds?.["ocd-person"]??[])).size===1
      ? matches.find(row=>row.nativeIds?.["ocd-person"]?.length===1):undefined;
  };
  const returnedAliases=new Map<string,Set<string>>();
  for(const set of sets)for(const person of set.officeholders)if(needsBinding(person))for(const key of personIdentityKeys(person)){
    const owner=ownerOf(key);if(!owner||owner===identityOf(person))continue;
    const aliases=returnedAliases.get(owner)??new Set<string>();aliases.add(key);returnedAliases.set(owner,aliases);
  }
  const photos = new Map<string, NonNullable<Officeholder["photo"]>>();
  for (const set of sets) for (const person of set.officeholders) {
    const photo=person.photo,verification=photo?.verification;
    if (!photo || !verification || !portraitBindingMatches(verification.personId,photo)) continue;
    const owner=namedIdentity(subject({...person,name:verification.name}));
    if (!referenceFor(owner)) continue;
    const held=photos.get(owner);
    if (!held || verification.checkedAt >= held.verification!.checkedAt) photos.set(owner,photo);
  }
  const withOwnedFacts = (person:Officeholder):Officeholder => {
    const identity=identityOf(person),photo=photos.get(identity),keys=personIdentityKeys(person);
    const aliases=[...returnedAliases.get(identity)??[]].filter(key=>!keys.has(key));
    return {...person,
      ...(aliases.length?{nativeIds:{...person.nativeIds,reader:[...person.nativeIds?.reader??[],...aliases]}}:{}),
      ...(photo?{photo:{...photo,verification:{...photo.verification!,personId:person.personId ?? person.id}}}:{})};
  };
  return sets.map(set => {
    const repaired = new Map<string, Officeholder>();
    const restored = new Map<string, Officeholder>();
    const officeholders = set.officeholders.map(person => {
      if (!needsBinding(person)) return withOwnedFacts(person);
      const document=documentReference(person),identity=document?identityOf(document):identityOf(person),reference=document??referenceFor(identity);
      // An unavailable source never causes the last held person to disappear.
      if (!reference) return person;
      for(const key of personIdentityKeys(person)){
        const owner=ownerOf(key),source=owner?referenceFor(owner):undefined;
        if(source&&owner!==identity)restored.set(owner!,source);
      }
      // A portrait collapse can even carry another member's canonical ID.
      const foreignKey=(key:string)=>document?Boolean(ownerOf(key)&&ownerOf(key)!==identity):foreign(person,key);
      const id=foreignKey(person.id)?reference.id:person.id;
      const personId=foreignKey(person.personId??person.id)?reference.personId??reference.id:person.personId??person.id;
      const aliases=[...personIdentityKeys(person)].filter(key=>!foreignKey(key));
      const cleanReference={...reference,nativeIds:{...reference.nativeIds,reader:(reference.nativeIds?.reader??[]).filter(key=>!foreignKey(key))}};
      const base=collapsed(person)||document?cleanReference:person;
      const rebound={...base,id,personId,
        nativeIds:{...cleanReference.nativeIds,reader:[...new Set([...cleanReference.nativeIds.reader??[],...aliases,id,personId])]},
        memberships:base.memberships?.map(row=>({...row,personId})),sourceHolders:[cleanReference]};
      const result=withOwnedFacts(rebound);
      repaired.set(person.id,result);
      return result;
    });
    const present=new Set(officeholders.map(identityOf)),added=[...restored].filter(([identity])=>!present.has(identity)).map(([,person])=>withOwnedFacts(person));
    officeholders.push(...added);
    return {...set, officeholders, divisions: [
      ...set.divisions.filter(link => !repaired.has(link.officeholderId)),
      ...[...repaired.values(),...added].flatMap(person => person.memberships?.flatMap(membership => membership.current !== false && membership.divisionId
        ? [{officeholderId: person.id, membershipId: membership.id, ocdId: membership.divisionId, bodyId: null}] : []) ?? []),
    ],unmatched:set.unmatched.map(row=>({...row,officeholderId:repaired.get(row.officeholderId)?.id??row.officeholderId}))};
  });
}
