import registrarData from '../../data/registrar-tlds.json' with { type: 'json' };
import reputationData from '../../data/tld-reputation.json' with { type: 'json' };
import {
  type RegistrarTable,
  RegistrarTableSchema,
  type ReputationTable,
  ReputationTableSchema,
} from './schema.js';

export interface TldTables {
  registrars: RegistrarTable;
  reputation: ReputationTable;
}

let bundled: TldTables | undefined;

/** The tables shipped in server/data, validated once on first use. */
export function bundledTables(): TldTables {
  bundled ??= {
    registrars: RegistrarTableSchema.parse(registrarData),
    reputation: ReputationTableSchema.parse(reputationData),
  };
  return bundled;
}
