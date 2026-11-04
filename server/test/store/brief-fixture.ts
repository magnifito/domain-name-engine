import { readFile } from 'node:fs/promises';
import { type Brief, BriefSchema } from '../../src/store/brief.js';

/** Loads and validates the example brief used across store and tool tests. */
export async function loadBrief(): Promise<Brief> {
  const url = new URL('./fixtures/brief-example.json', import.meta.url);
  return BriefSchema.parse(JSON.parse(await readFile(url, 'utf8')));
}
