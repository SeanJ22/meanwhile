/** Installed, reviewed platform code runs against held source bytes. */
import { readdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
const directory = new URL('../../sources/platform-adapters/', import.meta.url);
export async function installedAdapters(): Promise<string[]> {
  try { return (await readdir(directory)).filter(name => /\.(ts|mjs)$/.test(name) && !name.includes('.test.')).map(name => name.replace(/\.(ts|mjs)$/, '')).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export async function runInstalledAdapter(name: string, text: string, sourceUrl: string): Promise<unknown> {
  if (!(await installedAdapters()).includes(name)) throw new Error('ADAPTER_NOT_INSTALLED');
  let adapterModule: Record<string, unknown> = {};
  for (const extension of ['ts', 'mjs']) {
    try { adapterModule = await import(pathToFileURL(fileURLToPath(new URL(name + '.' + extension, directory))).href); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  }
  if (typeof adapterModule.extract === 'function') return adapterModule.extract({text, sourceUrl});
  if (name === 'uncapped-source-links' && typeof adapterModule.uncappedSourceLinks === 'function') return adapterModule.uncappedSourceLinks(text, sourceUrl);
  if (name === 'dated-sitemap' && typeof adapterModule.inventoryStreamlineSitemap === 'function') return adapterModule.inventoryStreamlineSitemap({xml:text, publisherOrigin:new URL(sourceUrl).origin, subjectId:sourceUrl});
  throw new Error('ADAPTER_EXTRACTION_EXPORT_MISSING');
}
