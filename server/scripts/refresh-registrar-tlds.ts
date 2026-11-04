// Maintainer script: rebuilds server/data/registrar-tlds.json from official APIs and the
// public Cloudflare price file. Run with `pnpm refresh:tlds`. Needs network; CI never runs it.
// Key values are read from env only and are never printed.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHttp } from '../src/http/http.js';
import { HostLimiter } from '../src/limiter/limiter.js';
import { readCredentials, redact, secretValues } from '../src/registrars/credentials.js';
import { buildJobs, diffTables, runRefresh, saveTable } from '../src/tld/refresh.js';
import { RegistrarTableSchema } from '../src/tld/schema.js';
import { errorMessage } from '../src/util/errors.js';

const TABLE_PATH = fileURLToPath(new URL('../data/registrar-tlds.json', import.meta.url));

async function main(): Promise<void> {
  const creds = readCredentials(process.env);
  const secrets = secretValues(creds);
  // Large price lists need more than the default 8 second timeout.
  const http = createHttp({ limiter: new HostLimiter(), timeoutMs: 60_000 });
  const today = new Date().toISOString().slice(0, 10);

  const current = RegistrarTableSchema.parse(JSON.parse(await readFile(TABLE_PATH, 'utf8')));
  const merged = await runRefresh(current, buildJobs(creds, http, today), secrets, console.log);
  const next = RegistrarTableSchema.parse(merged);
  const changes = diffTables(current, next);
  for (const line of changes) console.log(line);
  console.log(`${changes.length} changed rows`);
  await saveTable(TABLE_PATH, next);
}

main().catch((error: unknown) => {
  const secrets = secretValues(readCredentials(process.env));
  console.error(`refresh failed: ${redact(errorMessage(error), secrets)}`);
  process.exit(1);
});
