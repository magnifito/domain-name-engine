import type { RdapDomain } from '../../sources/rdap.js';

export interface RegistrationFields {
  createdAt?: string;
  expiresAt?: string;
  registrar?: string;
  nameservers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeNs(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function rdapRegistrar(entities: unknown[] | undefined): string | undefined {
  for (const entity of entities ?? []) {
    if (!isRecord(entity)) continue;
    const roles = entity.roles;
    if (!Array.isArray(roles) || !roles.includes('registrar')) continue;
    const vcard = entity.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const prop of vcard[1]) {
        if (Array.isArray(prop) && prop[0] === 'fn' && typeof prop[3] === 'string' && prop[3]) {
          return prop[3];
        }
      }
    }
    if (typeof entity.handle === 'string') return entity.handle;
  }
  return undefined;
}

export function fromRdap(record: RdapDomain): RegistrationFields {
  const event = (action: string): string | undefined =>
    record.events?.find((e) => e.eventAction === action)?.eventDate;
  return {
    createdAt: event('registration'),
    expiresAt: event('expiration'),
    registrar: rdapRegistrar(record.entities),
    nameservers: (record.nameservers ?? []).flatMap((ns) =>
      ns.ldhName ? [normalizeNs(ns.ldhName)] : [],
    ),
  };
}

const CREATED = [
  /^[ \t]*creation date:[ \t]*(\S.*)$/im,
  /^[ \t]*created(?: on)?:[ \t]*(\S.*)$/im,
  /^[ \t]*registered(?: on)?:[ \t]*(\S.*)$/im,
  /^[ \t]*registration time:[ \t]*(\S.*)$/im,
];
const EXPIRES = [
  /^[ \t]*registry expiry date:[ \t]*(\S.*)$/im,
  /^[ \t]*registrar registration expiration date:[ \t]*(\S.*)$/im,
  /^[ \t]*expir(?:y|ation) date:[ \t]*(\S.*)$/im,
  /^[ \t]*expires(?: on)?:[ \t]*(\S.*)$/im,
  /^[ \t]*paid-till:[ \t]*(\S.*)$/im,
];
const REGISTRAR = [/^[ \t]*registrar:[ \t]*(\S.*)$/im, /^[ \t]*registrar name:[ \t]*(\S.*)$/im];
const NAMESERVER = /^[ \t]*(?:name server|nserver):[ \t]*(\S+)/gim;

function firstMatch(raw: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const value = raw.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function fromWhois(raw: string): RegistrationFields {
  const nameservers = [...raw.matchAll(NAMESERVER)].map((m) => normalizeNs(m[1] ?? ''));
  return {
    createdAt: firstMatch(raw, CREATED),
    expiresAt: firstMatch(raw, EXPIRES),
    registrar: firstMatch(raw, REGISTRAR),
    nameservers: [...new Set(nameservers.filter(Boolean))],
  };
}
