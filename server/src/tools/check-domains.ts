import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { joinDomain, ValidationError } from '../domain/name.js';
import type { Runtime } from '../runtime.js';
import { toolError, toolJson } from './result.js';

export const MAX_DOMAINS_PER_CALL = 200;

export const AVAILABILITY_NOTE =
  'likely_available means RDAP, WHOIS, and DNS found no registration. Premium and registry-reserved names are not visible to these free sources; confirm at a registrar before relying on it.';

export function registerCheckDomains(server: McpServer, rt: Pick<Runtime, 'checkDomains'>): void {
  server.registerTool(
    'check_domains',
    {
      title: 'Check domain availability',
      description:
        'Check every name × TLD pair with RDAP, a WHOIS fallback, and DNS. Each result is registered, likely_available, or unknown, with source, checkedAt, and confidence.',
      inputSchema: {
        names: z
          .array(z.string())
          .min(1)
          .max(100)
          .describe('Second-level labels without TLD, e.g. "acme"'),
        tlds: z
          .array(z.string())
          .min(1)
          .max(30)
          .describe(
            'TLDs with or without a leading dot, e.g. "com", ".io"; multi-label values must be registry suffixes such as "co.uk"',
          ),
      },
    },
    async ({ names, tlds }) => {
      let domains: string[];
      try {
        domains = [...new Set(names.flatMap((name) => tlds.map((tld) => joinDomain(name, tld))))];
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
      if (domains.length > MAX_DOMAINS_PER_CALL) {
        return toolError(
          `Too many domains (${domains.length}); the limit is ${MAX_DOMAINS_PER_CALL} per call.`,
        );
      }
      const results = await rt.checkDomains(domains);
      return toolJson({ results, note: AVAILABILITY_NOTE });
    },
  );
}
