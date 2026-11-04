import { describe, expect, it } from 'vitest';
import { readResearchKeys } from '../../src/research/keys.js';

describe('readResearchKeys', () => {
  it('returns no keys for an empty env', () => {
    expect(readResearchKeys({})).toEqual({});
  });

  it('reads every optional key and trims values', () => {
    expect(
      readResearchKeys({
        GITHUB_TOKEN: ' gh ',
        REDDIT_CLIENT_ID: 'rid',
        REDDIT_CLIENT_SECRET: 'rsecret',
        YOUTUBE_API_KEY: 'yt',
        EUIPO_CLIENT_ID: 'eid',
        EUIPO_CLIENT_SECRET: 'esecret',
        EUIPO_ENV: 'sandbox',
      }),
    ).toEqual({
      githubToken: 'gh',
      reddit: { clientId: 'rid', clientSecret: 'rsecret' },
      youtubeApiKey: 'yt',
      euipo: { clientId: 'eid', clientSecret: 'esecret', env: 'sandbox' },
    });
  });

  it('ignores a pair when one half is missing or blank, and defaults EUIPO to production', () => {
    expect(
      readResearchKeys({
        REDDIT_CLIENT_ID: 'rid',
        REDDIT_CLIENT_SECRET: '  ',
        EUIPO_CLIENT_ID: 'eid',
        EUIPO_CLIENT_SECRET: 'esecret',
        EUIPO_ENV: 'prod',
      }),
    ).toEqual({ euipo: { clientId: 'eid', clientSecret: 'esecret', env: 'production' } });
  });
});
