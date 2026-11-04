import { describe, expect, it } from 'vitest';
import { parkingProvider } from '../../src/research/profile/parking.js';
import { fromRdap, fromWhois } from '../../src/research/profile/registration.js';
import type { RdapDomain } from '../../src/sources/rdap.js';
import googleRecord from '../fixtures/rdap-domain-google.json' with { type: 'json' };
import parkedRecord from './fixtures/rdap-domain-parked.json' with { type: 'json' };

const VERISIGN_WHOIS = `   Domain Name: EXAMPLE.NET
   Registry Domain ID: 1234_DOMAIN_NET-VRSN
   Registrar WHOIS Server: whois.example-registrar.com
   Updated Date: 2026-08-14T07:01:31Z
   Creation Date: 1995-08-14T04:00:00Z
   Registry Expiry Date: 2027-08-13T04:00:00Z
   Registrar: Example Registrar, Inc.
   Name Server: A.IANA-SERVERS.NET
   Name Server: B.IANA-SERVERS.NET
`;

const RU_STYLE_WHOIS = `domain:        EXAMPLE.RU
nserver:       ns1.example.ru.
nserver:       ns2.example.ru.
registrar:     RU-CENTER-RU
created:       2005-01-01T00:00:00Z
paid-till:     2027-01-01T00:00:00Z
`;

describe('parkingProvider', () => {
  it('matches a parking nameserver by domain suffix, ignoring case and a trailing dot', () => {
    expect(parkingProvider(['NS1.SEDOPARKING.COM.'])).toBe('sedoparking.com');
    expect(parkingProvider(['ns1.example.com', 'ns2.bodis.com'])).toBe('bodis.com');
  });

  it('does not match look-alike hosts', () => {
    expect(parkingProvider(['ns1.notbodis.com', 'ns1.google.com'])).toBeUndefined();
  });
});

describe('fromRdap', () => {
  it('reads dates, registrar name, and lower-case nameservers', () => {
    expect(fromRdap(parkedRecord as RdapDomain)).toEqual({
      createdAt: '2014-03-02T10:11:12Z',
      expiresAt: '2027-03-02T10:11:12Z',
      registrar: 'Example Registrar, LLC',
      nameservers: ['ns1.sedoparking.com', 'ns2.sedoparking.com'],
    });
  });

  it('leaves the registrar undefined when no registrar entity exists', () => {
    const fields = fromRdap(googleRecord as RdapDomain);
    expect(fields.registrar).toBeUndefined();
    expect(fields.createdAt).toBe('1997-09-15T04:00:00Z');
    expect(fields.nameservers).toEqual(['ns1.google.com', 'ns2.google.com']);
  });
});

describe('fromWhois', () => {
  it('parses a Verisign-style record', () => {
    expect(fromWhois(VERISIGN_WHOIS)).toEqual({
      createdAt: '1995-08-14T04:00:00Z',
      expiresAt: '2027-08-13T04:00:00Z',
      registrar: 'Example Registrar, Inc.',
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
    });
  });

  it('parses a RIPN-style record', () => {
    expect(fromWhois(RU_STYLE_WHOIS)).toEqual({
      createdAt: '2005-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
      registrar: 'RU-CENTER-RU',
      nameservers: ['ns1.example.ru', 'ns2.example.ru'],
    });
  });

  it('returns empty fields for text it does not understand', () => {
    expect(fromWhois('% rate limit exceeded')).toEqual({
      createdAt: undefined,
      expiresAt: undefined,
      registrar: undefined,
      nameservers: [],
    });
  });
});
