// Maintainer script: rebuilds server/data/registrar-tlds.json from official APIs and the
// public Cloudflare price file. Run with `pnpm refresh:tlds`. Needs network; CI never runs it.
// Key values are read from env only and are never printed.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHttp } from '../src/http/http.js';
import { HostLimiter } from '../src/limiter/limiter.js';
import { fetchCloudflarePublicPrices } from '../src/registrars/cloudflare.js';
import { readCredentials, redact, secretValues } from '../src/registrars/credentials.js';
import { fetchNamecheapTldPrices } from '../src/registrars/namecheap.js';
import { fetchSpaceshipTldPrices } from '../src/registrars/spaceship.js';
import {
  diffTables,
  type FetchedRegistrar,
  mergeTable,
  serializeTable,
} from '../src/tld/refresh.js';
import { type PriceRow, type RegistrarId, RegistrarTableSchema } from '../src/tld/schema.js';
import { errorMessage } from '../src/util/errors.js';

const TABLE_PATH = fileURLToPath(new URL('../data/registrar-tlds.json', import.meta.url));

async function main(): Promise<void> {
  const creds = readCredentials(process.env);
  const secrets = secretValues(creds);
  // Large price lists need more than the default 8 second timeout.
  const http = createHttp({ limiter: new HostLimiter(), timeoutMs: 60_000 });
  const today = new Date().toISOString().slice(0, 10);

  const { spaceship, namecheap } = creds;
  const jobs: Array<[RegistrarId, (() => Promise<PriceRow[]>) | null]> = [
    ['cloudflare', () => fetchCloudflarePublicPrices(http)],
    ['spaceship', spaceship ? () => fetchSpaceshipTldPrices(spaceship, http, today) : null],
    ['namecheap', namecheap ? () => fetchNamecheapTldPrices(namecheap, http, today) : null],
  ];

  const fetched: FetchedRegistrar[] = [];
  for (const [registrar, job] of jobs) {
    if (!job) {
      console.log(`${registrar}: keys not set, keeping current rows`);
      continue;
    }
    try {
      const rows = await job();
      if (rows.length === 0) throw new Error('no rows returned');
      fetched.push({ registrar, rows });
      console.log(`${registrar}: ${rows.length} TLDs`);
    } catch (error) {
      console.log(
        `${registrar}: failed, keeping current rows (${redact(errorMessage(error), secrets)})`,
      );
    }
  }

  const current = RegistrarTableSchema.parse(JSON.parse(await readFile(TABLE_PATH, 'utf8')));
  const next = RegistrarTableSchema.parse(mergeTable(current, fetched));
  const changes = diffTables(current, next);
  for (const line of changes) console.log(line);
  console.log(`${changes.length} changed rows`);
  await writeFile(TABLE_PATH, serializeTable(next), 'utf8');
}

main().catch((error: unknown) => {
  const secrets = secretValues(readCredentials(process.env));
  console.error(`refresh failed: ${redact(errorMessage(error), secrets)}`);
  process.exit(1);
});
