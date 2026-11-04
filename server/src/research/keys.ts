export type EuipoEnv = 'production' | 'sandbox';

/** Optional API keys for research sources. Read from env only; never logged or returned. */
export interface ResearchKeys {
  githubToken?: string;
  reddit?: { clientId: string; clientSecret: string };
  youtubeApiKey?: string;
  euipo?: { clientId: string; clientSecret: string; env: EuipoEnv };
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function readResearchKeys(env: NodeJS.ProcessEnv): ResearchKeys {
  const keys: ResearchKeys = {};
  const githubToken = read(env, 'GITHUB_TOKEN');
  if (githubToken) keys.githubToken = githubToken;

  const redditId = read(env, 'REDDIT_CLIENT_ID');
  const redditSecret = read(env, 'REDDIT_CLIENT_SECRET');
  if (redditId && redditSecret) keys.reddit = { clientId: redditId, clientSecret: redditSecret };

  const youtubeApiKey = read(env, 'YOUTUBE_API_KEY');
  if (youtubeApiKey) keys.youtubeApiKey = youtubeApiKey;

  const euipoId = read(env, 'EUIPO_CLIENT_ID');
  const euipoSecret = read(env, 'EUIPO_CLIENT_SECRET');
  if (euipoId && euipoSecret) {
    keys.euipo = {
      clientId: euipoId,
      clientSecret: euipoSecret,
      env: read(env, 'EUIPO_ENV') === 'sandbox' ? 'sandbox' : 'production',
    };
  }
  return keys;
}
