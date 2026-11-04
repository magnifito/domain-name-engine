import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';
import type { EuipoEnv } from '../keys.js';

// Checked 2026-11-04: both token URLs answer 401 to bad credentials; both API bases answer 401 without a token.
export const EUIPO_ENDPOINTS: Record<EuipoEnv, { token: string; api: string }> = {
  production: {
    token: 'https://euipo.europa.eu/cas-server-webapp/oidc/accessToken',
    api: 'https://api.euipo.europa.eu/trademark-search',
  },
  sandbox: {
    token: 'https://auth-sandbox.euipo.europa.eu/oidc/accessToken',
    api: 'https://api-sandbox.euipo.europa.eu/trademark-search',
  },
};

export const EUIPO_PAGE_SIZE = 25;

export interface TrademarkMatch {
  office: 'euipo';
  mark: string;
  applicationNumber: string;
  status?: string;
  niceClasses: number[];
  applicationDate?: string;
  applicants: string[];
  url: string;
}

export type EuipoResult =
  | { kind: 'ok'; total: number; matches: TrademarkMatch[] }
  | { kind: 'error'; reason: string };

export interface EuipoClient {
  env: EuipoEnv;
  search(mark: string, niceClasses: readonly number[]): Promise<EuipoResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** RSQL "contains" query on the word element, optionally limited to Nice classes. */
export function buildEuipoQuery(mark: string, niceClasses: readonly number[]): string {
  const term = mark.trim().replace(/["\\]/g, '');
  const value = /[\s'();,=!~<>]/.test(term) ? `"*${term}*"` : `*${term}*`;
  const parts = [`wordMarkSpecification.verbalElement==${value}`];
  if (niceClasses.length > 0) parts.push(`niceClasses=in=(${niceClasses.join(',')})`);
  return parts.join(' and ');
}

function parseMatch(item: unknown): TrademarkMatch | undefined {
  if (!isRecord(item) || typeof item.applicationNumber !== 'string') return undefined;
  const spec = isRecord(item.wordMarkSpecification) ? item.wordMarkSpecification : {};
  const classes = Array.isArray(item.niceClasses) ? item.niceClasses : [];
  const applicants = Array.isArray(item.applicants) ? item.applicants : [];
  return {
    office: 'euipo',
    mark: typeof spec.verbalElement === 'string' ? spec.verbalElement : '(no word element)',
    applicationNumber: item.applicationNumber,
    status: typeof item.status === 'string' ? item.status : undefined,
    niceClasses: classes.map(Number).filter((n) => Number.isInteger(n)),
    applicationDate: typeof item.applicationDate === 'string' ? item.applicationDate : undefined,
    applicants: applicants.flatMap((a) =>
      isRecord(a) && typeof a.name === 'string' ? [a.name] : [],
    ),
    url: `https://euipo.europa.eu/eSearch/#details/trademarks/${item.applicationNumber}`,
  };
}

/** Parses a search page. Any shape change yields an error, never a guess. */
export function parseEuipoSearch(body: unknown): EuipoResult {
  if (!isRecord(body) || !Array.isArray(body.trademarks)) {
    return { kind: 'error', reason: 'EUIPO response shape not recognized' };
  }
  const matches = body.trademarks.flatMap((item) => parseMatch(item) ?? []);
  const total = typeof body.totalElements === 'number' ? body.totalElements : matches.length;
  return { kind: 'ok', total, matches };
}

export function createEuipoClient(
  http: HttpFetch,
  creds: { clientId: string; clientSecret: string; env: EuipoEnv },
  now: () => number = Date.now,
): EuipoClient {
  const endpoints = EUIPO_ENDPOINTS[creds.env];
  let token: { value: string; expiresAt: number } | undefined;

  const getToken = async (force: boolean): Promise<string> => {
    if (!force && token && token.expiresAt > now()) return token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'uid',
    });
    const res = await http(endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`EUIPO token request returned HTTP ${res.status}`);
    const payload = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string') {
      throw new Error('EUIPO token response had no access_token');
    }
    const lifetime = typeof payload.expires_in === 'number' ? payload.expires_in : 600;
    token = { value: payload.access_token, expiresAt: now() + Math.max(lifetime - 60, 0) * 1000 };
    return token.value;
  };

  const get = async (url: string, force: boolean): Promise<Response> =>
    http(url, {
      headers: {
        authorization: `Bearer ${await getToken(force)}`,
        'x-ibm-client-id': creds.clientId,
        accept: 'application/json',
      },
    });

  return {
    env: creds.env,
    async search(mark, niceClasses) {
      const params = new URLSearchParams({
        query: buildEuipoQuery(mark, niceClasses),
        page: '0',
        size: String(EUIPO_PAGE_SIZE),
      });
      const url = `${endpoints.api}/trademarks?${params.toString()}`;
      try {
        let res = await get(url, false);
        // A 401 can mean the cached token expired early; refresh once.
        if (res.status === 401) res = await get(url, true);
        if (!res.ok) return { kind: 'error', reason: `EUIPO search returned HTTP ${res.status}` };
        return parseEuipoSearch(await res.json());
      } catch (error) {
        return { kind: 'error', reason: errorMessage(error) };
      }
    },
  };
}
