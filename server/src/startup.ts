import { engineHome } from './config.js';
import { readCredentials, redact, secretValues } from './registrars/credentials.js';
import { USER_CONFIG_PREFIX } from './util/env.js';
import { errorMessage } from './util/errors.js';
import { createKeySource, keyFilePath } from './util/key-file.js';

/** Keys of the research tools. Their values are never read here, only redacted from messages. */
const RESEARCH_KEYS = [
  'GITHUB_TOKEN',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'YOUTUBE_API_KEY',
  'EUIPO_CLIENT_ID',
  'EUIPO_CLIENT_SECRET',
] as const;

function researchSecrets(env: NodeJS.ProcessEnv): string[] {
  // Redact both the raw value and its trimmed form, since the keys are read trimmed.
  // Each key can come from the env variable or from the plugin settings form.
  return RESEARCH_KEYS.flatMap((key) => [key, `${USER_CONFIG_PREFIX}${key}`])
    .flatMap((name) => [env[name] ?? '', env[name]?.trim() ?? ''])
    .filter((v) => v.length >= 4);
}

export interface StartupIo {
  stderr: (text: string) => void;
  exit: (code: number) => void;
  env: NodeJS.ProcessEnv;
}

const processIo: StartupIo = {
  stderr: (text) => process.stderr.write(text),
  exit: (code) => process.exit(code),
  env: process.env,
};

/**
 * Runs the server start function. On failure it writes one clean line to stderr
 * (stdout belongs to the MCP protocol) and exits with code 1. Key values are redacted.
 */
export async function runStartup(
  start: () => Promise<void>,
  io: StartupIo = processIo,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    let env = io.env;
    try {
      // Keys from the key file are redacted too.
      env = createKeySource(io.env, keyFilePath(engineHome(io.env))).env();
    } catch {
      // Keep the plain env when the key file cannot be read.
    }
    const message = redact(
      errorMessage(error),
      [...secretValues(readCredentials(env)), ...researchSecrets(env)].sort(
        (a, b) => b.length - a.length,
      ),
    );
    io.stderr(`domain-name-engine: failed to start: ${message}\n`);
    io.exit(1);
  }
}
