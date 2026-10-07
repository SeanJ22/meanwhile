/** Installed, reviewed platform code runs against held source bytes. */
import { readdir } from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {contentHash} from '../ids.ts';
import { pathToFileURL, fileURLToPath } from 'node:url';
const directory = new URL('../../sources/platform-adapters/', import.meta.url);
/** The implementation version travels in the existing Scout rung, so a replaced adapter can wake its work. */
export function installedAdapterVersion(name:string):string|null {
  if(!/^[a-z0-9-]+$/.test(name))return null;
  for(const extension of ['ts','mjs'])try{return contentHash(readFileSync(new URL(name+'.'+extension,directory),'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return null;
}
export async function installedAdapters(): Promise<string[]> {
  try { return (await readdir(directory)).filter(name => /\.(ts|mjs)$/.test(name) && !name.includes('.test.')).map(name => name.replace(/\.(ts|mjs)$/, '')).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export interface PlatformAdapterGuide {
  readonly summary:string;
  readonly procedure:string;
  readonly recordClasses:readonly string[];
  readonly sourceUrls:readonly string[];
}
async function loadInstalledAdapter(name:string):Promise<{module:Record<string,unknown>;file:string}> {
  if (!(await installedAdapters()).includes(name)) throw new Error('ADAPTER_NOT_INSTALLED');
  for (const extension of ['ts', 'mjs']) {
    try { return {module:await import(pathToFileURL(fileURLToPath(new URL(name + '.' + extension, directory))).href),file:`lib/sources/platform-adapters/${name}.${extension}`}; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('ADAPTER_NOT_INSTALLED');
}
/** Optional instructions shipped with the implementation, for every role's existing knowledge bank. */
export async function installedAdapterGuides():Promise<{name:string;version:string|null;file:string;guide:PlatformAdapterGuide}[]> {
  const guides:{name:string;version:string|null;file:string;guide:PlatformAdapterGuide}[]=[];
  for(const name of await installedAdapters()) {
    const adapter=await loadInstalledAdapter(name);
    if(adapter.module.guide)guides.push({name,version:installedAdapterVersion(name),file:adapter.file,guide:adapter.module.guide as PlatformAdapterGuide});
  }
  return guides;
}
export async function runInstalledAdapter(name: string, text: string, sourceUrl: string): Promise<unknown> {
  const {module:adapterModule}=await loadInstalledAdapter(name);
  if (typeof adapterModule.extract === 'function') return adapterModule.extract({text, sourceUrl});
  if (name === 'uncapped-source-links' && typeof adapterModule.uncappedSourceLinks === 'function') return adapterModule.uncappedSourceLinks(text, sourceUrl);
  if (name === 'dated-sitemap' && typeof adapterModule.inventoryStreamlineSitemap === 'function') return adapterModule.inventoryStreamlineSitemap({xml:text, publisherOrigin:new URL(sourceUrl).origin, subjectId:sourceUrl});
  throw new Error('ADAPTER_EXTRACTION_EXPORT_MISSING');
}
/** Register the feed kinds installed adapters declare (`export const feedKind`). A bad kind, or one a built-in holds, is refused by name and the rest still install. */
export async function installFeedKindsFromAdapters(): Promise<{ readonly installed: readonly string[]; readonly refused: readonly string[] }> {
  const { installFeedKinds } = await import('../../sources/feed-kinds.ts');
  const { CAPABILITIES } = await import('../../sources/composite/wiring.ts');
  const declared: unknown[] = [];
  const unreadable: string[] = [];
  for (const name of await installedAdapters()) {
    try {
      const adapter = await loadInstalledAdapter(name);
      if (adapter.module.feedKind !== undefined) declared.push(adapter.module.feedKind);
    } catch (error) {
      unreadable.push(`${name}: could not be loaded (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  const result = installFeedKinds(declared as never, new Set(CAPABILITIES.map((capability) => capability.name)));
  return { installed: result.installed, refused: [...unreadable, ...result.refused] };
}
