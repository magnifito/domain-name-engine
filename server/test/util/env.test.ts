import { describe, expect, it } from 'vitest';
import { engineHome } from '../../src/config.js';
import { readResearchKeys } from '../../src/research/keys.js';
import { readEnv } from '../../src/util/env.js';

describe('readEnv', () => {
  it('trims values and treats blanks as unset', () => {
    expect(readEnv({ A: ' x ' }, 'A')).toBe('x');
    expect(readEnv({ A: '  ' }, 'A')).toBeUndefined();
    expect(readEnv({}, 'A')).toBeUndefined();
  });

  it('treats an unexpanded ${VAR} placeholder as unset', () => {
    expect(readEnv({ A: '${GITHUB_TOKEN}' }, 'A')).toBeUndefined();
  });
});

describe('placeholders in the shared readers (M3)', () => {
  it('ignores unexpanded placeholders for research keys', () => {
    expect(
      readResearchKeys({
        GITHUB_TOKEN: '${GITHUB_TOKEN}',
        YOUTUBE_API_KEY: '${YOUTUBE_API_KEY}',
        REDDIT_CLIENT_ID: '${A}',
        REDDIT_CLIENT_SECRET: 's',
      }),
    ).toEqual({});
  });

  it('ignores an unexpanded DOMAIN_ENGINE_HOME placeholder', () => {
    expect(engineHome({ DOMAIN_ENGINE_HOME: '${DOMAIN_ENGINE_HOME}' })).not.toContain('${');
  });
});
