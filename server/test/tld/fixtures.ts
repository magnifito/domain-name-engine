import type { PriceRow } from '../../src/tld/schema.js';
import type { TldTables } from '../../src/tld/table.js';

function row(partial: Partial<PriceRow> & Pick<PriceRow, 'registrar' | 'tld'>): PriceRow {
  return {
    firstYear: null,
    renewal: null,
    transfer: null,
    currency: null,
    source: 'unverified',
    checkedAt: '2026-11-04',
    ...partial,
  };
}

/** A small, fixed table for unit tests; it does not depend on the bundled data. */
export function testTables(): TldTables {
  return {
    registrars: {
      schemaVersion: 1,
      registrars: {
        spaceship: { coverage: 'partial', notSold: [], notListed: [], note: 'test' },
        namecheap: { coverage: 'partial', notSold: [], notListed: [], note: 'test' },
        cloudflare: {
          coverage: 'full',
          notSold: [],
          notListed: [],
          fullList: { source: 'cfdomainpricing.com/prices.json', checkedAt: '2026-10-13' },
          note: 'test',
        },
      },
      rows: [
        row({
          registrar: 'spaceship',
          tld: 'site',
          firstYear: 1.05,
          renewal: 30,
          currency: 'EUR',
          source: 'spaceship.com price list, recorded by maintainer',
        }),
        row({ registrar: 'namecheap', tld: 'site' }),
        row({
          registrar: 'cloudflare',
          tld: 'site',
          firstYear: 4.99,
          renewal: 27.7,
          currency: 'USD',
          source: 'cfdomainpricing.com/prices.json',
          checkedAt: '2026-10-13',
        }),
        row({
          registrar: 'cloudflare',
          tld: 'com',
          firstYear: 10.46,
          renewal: 10.46,
          currency: 'USD',
          source: 'cfdomainpricing.com/prices.json',
          checkedAt: '2026-10-13',
        }),
      ],
    },
    reputation: {
      schemaVersion: 1,
      rows: [
        {
          tld: 'site',
          reputation: 'mixed',
          reputationNote: 'Low-cost TLD.',
          source: 'maintainer assessment',
          checkedAt: '2026-11-04',
        },
      ],
    },
  };
}
