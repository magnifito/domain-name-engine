import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ValidationError } from '../domain/name.js';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { toolError, toolJson } from './result.js';

export const PROFILE_NOTE =
  'Status comes from RDAP/WHOIS registration data, parking nameservers, and one GET of the homepage. for_sale and parked are heuristics; a site that refuses automated access is reported as live_site with low confidence and is never retried or bypassed.';

export function registerProfileDomain(
  server: McpServer,
  rt: Pick<ResearchRuntime, 'profileDomain'>,
): void {
  server.registerTool(
    'profile_domain',
    {
      title: 'Profile a taken domain',
      description:
        'For one registered domain: creation and expiry dates, registrar, nameservers, parking provider, homepage status and title, and a verdict of live_site, parked, for_sale, no_site, not_registered, or unknown, with source, checkedAt, and confidence.',
      inputSchema: {
        domain: z.string().min(3).max(253).describe('Full domain name, e.g. "acme.com"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ domain }) => {
      try {
        return toolJson({ profile: await rt.profileDomain(domain), note: PROFILE_NOTE });
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
    },
  );
}
